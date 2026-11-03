/*
 * @created 2026-11-03
 * @description 按保守结构契约适配网页背景，隔离原生窗口与站点内容
 * @author yunhungo
 */
(function (root, factory) {
  const adapter = factory();
  if (typeof module === 'object' && module.exports) module.exports = adapter;
  else adapter.install(root);
})(globalThis, function () {
  const POLICY = Object.freeze({
    version: 1,
    maxDepth: 6,
    maxNodes: 160,
    protectedSelector: 'pre, code, textarea, input, button, select, [contenteditable], [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [aria-modal="true"], [data-message-role], [data-testid*="message"]',
    interactiveSelector: 'button, a, input, textarea, select, [role="button"], [contenteditable]',
  });

  // Unknown structures stay untouched. Size alone never identifies a surface.
  function classifySurface(node) {
    if (node.protected || node.rounded || node.overlay || !node.neutral) return null;
    if (node.toolbar && node.widthRatio >= 0.6 && node.heightRatio <= 0.15) return 'shell';
    if (node.layoutRoot && node.widthRatio >= 0.8 && node.heightRatio >= 0.8) return 'shell';
    if (node.edge && node.widthRatio >= 0.8 && node.heightRatio <= 0.4) return 'edge';
    return null;
  }

  function install(w) {
    const d = w.document;
    const cfg = w.__DEEPSEEK_GLASS__;
    if (!cfg) return;
    const hosts = new Set((cfg.allowedHosts || []).map((host) => String(host).toLowerCase()));
    if (!hosts.has(w.location.hostname)) return;
    let observer;
    let timer;
    let disposed = false;
    const marked = new Set();
    const codeFrames = new Set();
    const observation = { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'data-theme'] };

    function start() {
      if (!d.body || d.documentElement.hasAttribute('data-dsq-installed')) return;
      const root = d.documentElement;
      root.setAttribute('data-dsq-installed', String(POLICY.version));
      const style = d.createElement('style');
      style.id = 'dsquick-adapter';
      style.textContent = `
        html[data-dsq-glass]{--dsq-tint:rgba(255,255,255,.14);--dsq-edge:rgba(242,242,242,.86);background:var(--dsq-tint)!important;border-radius:20px;overflow:hidden;}
        html[data-dsq-dark]{--dsq-tint:rgba(24,24,24,.18);--dsq-edge:rgba(30,30,30,.86);}
        html[data-dsq-glass] body,[data-dsq-surface="shell"]{background-color:transparent!important;background-image:none!important;}
        [data-dsq-surface="edge"]{background:var(--dsq-edge)!important;backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);}
        [data-dsq-code-frame]{border-radius:12px!important;overflow:hidden!important;}
      `;
      (d.head || root).appendChild(style);
      d.addEventListener('mousedown', drag, { capture: true });
      observer = new w.MutationObserver(schedule);
      observer.observe(root, observation);
      w.addEventListener('resize', schedule, { passive: true });
      w.addEventListener('pagehide', onPageHide);
      w.addEventListener('pageshow', schedule);
      if (cfg.enabled === true) {
        root.setAttribute('data-dsq-glass', '');
        refresh();
      }
    }

    function drag(event) {
      if (event.button !== 0 || event.clientY > 24) return;
      if (event.target.closest?.(POLICY.interactiveSelector)) return;
      const invoke = w.__TAURI_INTERNALS__?.invoke;
      if (!invoke) return;
      event.preventDefault();
      invoke('plugin:window|start_dragging', { label: 'main' }).catch(() => {});
    }

    function schedule() {
      if (disposed || timer || cfg.enabled !== true) return;
      timer = w.setTimeout(() => {
        timer = undefined;
        refresh();
      }, 200);
    }

    function neutral(color) {
      const match = /^rgba?\(([^)]+)\)$/.exec(color);
      const modern = /^color\(srgb\s+([^)]*)\)$/.exec(color);
      if (!match && !modern) return false;
      const parts = (match || modern)[1].split(/[\s,/]+/).map(Number);
      if (modern) for (let i = 0; i < 3; i++) parts[i] *= 255;
      return parts.length >= 3 && (parts[3] ?? 1) >= 0.96 &&
        Math.max(...parts.slice(0, 3)) - Math.min(...parts.slice(0, 3)) < 24;
    }

    function refresh() {
      observer.disconnect();
      try {
        for (const el of marked) el.removeAttribute('data-dsq-surface');
        marked.clear();
        for (const el of codeFrames) el.removeAttribute('data-dsq-code-frame');
        codeFrames.clear();
        const root = d.documentElement;
        root.toggleAttribute('data-dsq-dark', root.classList.contains('dark') ||
          root.dataset.theme === 'dark' || d.body.classList.contains('dark') ||
          w.getComputedStyle(root).colorScheme === 'dark');
        // Only shallow layout ancestors and semantic edge regions are eligible.
        const candidates = new Set();
        const queue = [...d.body.children].map((el) => [el, 0]);
        let visited = 0;
        while (queue.length && visited++ < POLICY.maxNodes) {
          const [el, depth] = queue.shift();
          if (el.matches(POLICY.protectedSelector)) continue;
          const rect = el.getBoundingClientRect();
          const style = w.getComputedStyle(el);
          const rounded = [style.borderTopLeftRadius, style.borderTopRightRadius,
            style.borderBottomLeftRadius, style.borderBottomRightRadius]
            .some((radius) => Number.parseFloat(radius) >= 8);
          if (rounded) continue;
          const covers = rect.width >= w.innerWidth * 0.8 && rect.height >= w.innerHeight * 0.8;
          if (!covers) continue;
          candidates.add(el);
          if (depth < POLICY.maxDepth) for (const child of el.children) queue.push([child, depth + 1]);
        }
        for (const el of d.querySelectorAll('main, [role="main"], header, footer, [role="banner"], [role="contentinfo"]')) candidates.add(el);
        for (const editor of d.querySelectorAll('textarea, [contenteditable], [role="textbox"]')) {
          let ancestor = editor.parentElement;
          for (let depth = 0; ancestor && depth < 6; depth++, ancestor = ancestor.parentElement) candidates.add(ancestor);
        }
        // A top toolbar may have a separately positioned share action. Clear
        // only its painted bar; never resize or reposition website controls.
        const toolbars = new Set();
        for (const button of [...d.querySelectorAll('button, [role="button"]')].slice(0, 64)) {
          const bounds = button.getBoundingClientRect();
          if (bounds.top < 0 || bounds.bottom > 96) continue;
          let ancestor = button.parentElement;
          for (let depth = 0; ancestor && depth < 4; depth++, ancestor = ancestor.parentElement) {
            const rect = ancestor.getBoundingClientRect();
            if (rect.top > 24 || rect.height > 96 || rect.height < 24 || rect.width < w.innerWidth * 0.6) continue;
            if (ancestor.querySelector('pre, textarea, [contenteditable]') ||
              ancestor.querySelectorAll('button, [role="button"]').length < 2) continue;
            toolbars.add(ancestor);
            candidates.add(ancestor);
          }
        }
        for (const hit of d.elementsFromPoint(w.innerWidth * 0.25, 24)) {
          let ancestor = hit;
          for (let depth = 0; ancestor && depth < 4; depth++, ancestor = ancestor.parentElement) {
            const rect = ancestor.getBoundingClientRect();
            if (rect.top > 24 || rect.height < 24 || rect.height > 96 || rect.width < w.innerWidth * 0.6) continue;
            if (ancestor.querySelector('pre, textarea, [contenteditable]') || (ancestor.querySelectorAll('svg').length === 0 && !ancestor.parentElement?.querySelector('svg'))) continue;
            toolbars.add(ancestor);
            candidates.add(ancestor);
          }
        }
        for (const el of candidates) {
          const rect = el.getBoundingClientRect();
          const style = w.getComputedStyle(el);
          const fixed = ['fixed', 'sticky'].includes(style.position);
          const semanticEdge = el.matches('header, footer, [role="banner"], [role="contentinfo"]');
          const composerFooter = fixed && rect.bottom >= w.innerHeight - 2 &&
            Boolean(el.querySelector('textarea, [contenteditable], [role="textbox"]'));
          const edge = (semanticEdge || composerFooter) && (rect.top <= 2 || rect.bottom >= w.innerHeight - 2);
          const kind = classifySurface({
            protected: Boolean(el.closest(POLICY.protectedSelector)),
            rounded: Number.parseFloat(style.borderTopLeftRadius) >= 8 || Number.parseFloat(style.borderBottomLeftRadius) >= 8,
            overlay: fixed && Number.parseInt(style.zIndex, 10) > 1 && !semanticEdge && !composerFooter && !toolbars.has(el),
            neutral: neutral(style.backgroundColor) || (edge && style.backgroundImage.includes('gradient')),
            toolbar: toolbars.has(el),
            layoutRoot: !semanticEdge,
            edge,
            widthRatio: rect.width / w.innerWidth,
            heightRatio: rect.height / w.innerHeight,
          });
          if (kind) {
            el.setAttribute('data-dsq-surface', kind);
            marked.add(el);
          }
        }
        // Clip the whole code card, not only its inner pre element.
        for (const pre of d.querySelectorAll('pre')) {
          let frame = pre;
          let parent = pre.parentElement;
          for (let depth = 0; depth < 4 && parent; depth++, parent = parent.parentElement) {
            if (parent.querySelectorAll('pre').length !== 1 ||
              parent.getBoundingClientRect().height > pre.getBoundingClientRect().height + 100) break;
            const style = w.getComputedStyle(parent);
            if (neutral(style.backgroundColor) || Number.parseFloat(style.borderTopLeftRadius) >= 8) frame = parent;
          }
          frame.setAttribute('data-dsq-code-frame', '');
          codeFrames.add(frame);
        }
      } catch {
        // Fail closed: restore website surfaces if its structure is unexpected.
        for (const el of marked) el.removeAttribute('data-dsq-surface');
        marked.clear();
      } finally {
        if (!disposed) observer.observe(d.documentElement, observation);
      }
    }

    function onPageHide(event) {
      if (!event.persisted) dispose();
    }

    function dispose() {
      disposed = true;
      observer?.disconnect();
      w.clearTimeout(timer);
      d.removeEventListener('mousedown', drag, { capture: true });
      w.removeEventListener('resize', schedule);
      w.removeEventListener('pagehide', onPageHide);
      w.removeEventListener('pageshow', schedule);
    }

    if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }

  return { POLICY, classifySurface, install };
});
