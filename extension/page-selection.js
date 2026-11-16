/**
 * @created 2026-11-10
 * @description 读取用户主动选中的非编辑网页内容
 * @author yunhungo
 */
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
