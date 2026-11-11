/**
 * @created 2026-11-10
 * @description 按用户操作读取浏览器原生无障碍树并输出有界的非编辑内容
 * @author yunhungo
 */
const MAX_NODES = 12000;
const MAX_TEXT = 180000;
const captures = new Set();

export function serializeAccessibility(nodes) {
  if (!Array.isArray(nodes)) throw new Error('浏览器未返回无障碍树');
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const children = new Set(nodes.flatMap((node) => node.childIds || []));
  const visited = new Set();
  const lines = [];
  let size = 0;
  let truncated = false;
  function walk(node, depth) {
    if (!node || visited.has(node.nodeId)) return;
    if (visited.size >= MAX_NODES || depth > 80 || size >= MAX_TEXT) {
      truncated = true;
      return;
    }
    visited.add(node.nodeId);
    const role = node.role?.value || '';
    const name = typeof node.name?.value === 'string' ? node.name.value : '';
    const properties = new Map(
      (node.properties || []).map((p) => [p.name, p.value?.value]),
    );
    // Never emit input values, editable descendants, or our embedded chat.
    if (
      ['textbox', 'searchbox', 'combobox'].includes(role) ||
      [true, 'richtext', 'plaintext'].includes(properties.get('editable')) ||
      properties.get('protected') === true ||
      (['Iframe', 'IframePresentational'].includes(role) && name === 'DSQuick')
    )
      return;
    if (!node.ignored && name && role !== 'InlineTextBox') {
      const textRole = [
        'StaticText',
        'heading',
        'link',
        'image',
        'button',
        'listitem',
        'cell',
        'columnheader',
        'rowheader',
      ].includes(role);
      if (textRole) {
        const hasStaticText = (node.childIds || []).some(
          (id) => byId.get(id)?.role?.value === 'StaticText',
        );
        // Container names often repeat their descendant text; emit it once.
        if (!hasStaticText || ['heading', 'link', 'image'].includes(role)) {
          const url = properties.get('url');
          const line = `${role === 'StaticText' ? '' : `[${role}] `}${name}${role === 'link' && /^https?:\/\//.test(url || '') ? ` (${url})` : ''}`;
          const remaining = MAX_TEXT - size;
          lines.push(line.slice(0, remaining));
          size += Math.min(line.length, remaining);
          if (line.length > remaining) truncated = true;
          if (['heading', 'link'].includes(role)) return;
        }
      }
    }
    for (const id of node.childIds || []) walk(byId.get(id), depth + 1);
  }
  for (const node of nodes) if (!children.has(node.nodeId)) walk(node, 0);
  if (!lines.some((line) => line.trim()))
    throw new Error('无障碍树中没有可读取的正文');
  return { text: lines.join('\n'), truncated };
}

export async function captureAccessibility(api, tab) {
  if (!Number.isInteger(tab?.id) || !/^https?:\/\//.test(tab.url || ''))
    throw new Error('仅支持当前 HTTP 或 HTTPS 网页');
  if (captures.has(tab.id)) throw new Error('此页面正在提取，请稍后重试');
  captures.add(tab.id);
  const target = { tabId: tab.id };
  let attached = false;
  try {
    await api.debugger.attach(target, '1.3');
    attached = true;
    const result = await api.debugger.sendCommand(
      target,
      'Accessibility.getFullAXTree',
      { depth: 80 },
    );
    const current = await api.tabs.get(tab.id);
    if (current.url !== tab.url) throw new Error('网页已跳转，请重新提取');
    const content = serializeAccessibility(result?.nodes);
    return {
      text: `标题: ${tab.title || ''}\n来源: ${tab.url}\n提取方式: Chrome 原生无障碍树（当前主文档，不含未加载内容）\n\n${content.text}${content.truncated ? '\n[内容达到提取上限，已截断]' : ''}`,
      images: [],
      truncated: content.truncated,
    };
  } finally {
    try {
      if (attached) await api.debugger.detach(target);
    } finally {
      captures.delete(tab.id);
    }
  }
}

// This function is serialized by chrome.scripting; keep it self-contained.
export function readPageSelection() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return '';
  for (let index = 0; index < selection.rangeCount; index++) {
    const range = selection.getRangeAt(index);
    for (const node of [
      range.startContainer,
      range.endContainer,
      range.commonAncestorContainer,
    ]) {
      const element = node.nodeType === 1 ? node : node.parentElement;
      if (
        element?.isContentEditable ||
        element?.closest('input,textarea,select,[data-dsquick]')
      )
        return '';
    }
  }
  const text = selection.toString().trim();
  if (text.length > 180000)
    throw new Error('选中文字超过 180000 字符，请缩小范围');
  return text;
}
