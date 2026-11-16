/**
 * @created 2026-11-10
 * @description 隔离悬浮面板与语义采集，提供随滚动更新的元素高亮
 * @author yunhungo
 */
(() => {
  if (globalThis.__dsquickSource) return;
  globalThis.__dsquickSource = true;
  const host = document.createElement('div');
  host.dataset.dsquick = '';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = '__DSQUICK_SOURCE_STYLE__';
  shadow.append(style);
  document.documentElement.append(host);
  const box = document.createElement('div');
  box.className = 'floating';
  box.hidden = true;
  const frame = document.createElement('iframe');
  frame.title = 'DSQuick';
  // Keep media queries independent of the last explicit panel theme.
  frame.style.setProperty('color-scheme', 'light dark', 'important');
  box.append(frame);
  shadow.append(box);
  let focusTimer;
  function setInactive(inactive) {
    box.dataset.inactive = String(inactive);
  }
  function insidePanel(event) {
    return (
      event.composedPath?.().includes(host) ||
      [host, box, frame].includes(event.target)
    );
  }
  function focusChanged(event) {
    if (box.hidden || selecting) return;
    setInactive(!insidePanel(event));
  }
  window.addEventListener(
    'pointerdown',
    (event) => {
      // Native page scrollbar drags count as scrolling, not leaving the panel.
      if (
        event.clientX >= document.documentElement.clientWidth ||
        event.clientY >= document.documentElement.clientHeight
      )
        return;
      focusChanged(event);
    },
    true,
  );
  window.addEventListener('focusin', focusChanged, true);
  window.addEventListener(
    'pointerover',
    (event) => {
      if (insidePanel(event)) setInactive(false);
    },
    true,
  );
  window.addEventListener('focus', () => {
    clearTimeout(focusTimer);
    if (document.activeElement === host || document.activeElement === frame)
      setInactive(false);
  });
  window.addEventListener('blur', () => {
    clearTimeout(focusTimer);
    // Entering either nested iframe also blurs this window; document.hasFocus
    // stays true in that case. No scroll/wheel listener changes this state.
    focusTimer = setTimeout(() => {
      if (!box.hidden && !selecting && !document.hasFocus()) setInactive(true);
    }, 0);
  });
  const LAYOUT_VERSION = 2;
  let saveBoundsTimer;
  let defaultLayout = true;
  let boundsTouched = false;
  let resizeStart;
  function viewportBounds() {
    const viewport = window.visualViewport;
    return {
      left: Number.isFinite(viewport?.offsetLeft) ? viewport.offsetLeft : 0,
      top: Number.isFinite(viewport?.offsetTop) ? viewport.offsetTop : 0,
      width: viewport?.width > 0 ? viewport.width : innerWidth,
      height: viewport?.height > 0 ? viewport.height : innerHeight,
    };
  }
  function applyBounds(bounds) {
    const viewport = viewportBounds();
    const width = Math.max(
      Math.min(300, viewport.width),
      Math.min(viewport.width, bounds.width),
    );
    const height = Math.max(
      Math.min(280, viewport.height),
      Math.min(viewport.height, bounds.height),
    );
    Object.assign(box.style, {
      left: `${Math.max(viewport.left, Math.min(viewport.left + viewport.width - width, bounds.left))}px`,
      top: `${Math.max(viewport.top, Math.min(viewport.top + viewport.height - height, bounds.top))}px`,
      width: `${width}px`,
      height: `${height}px`,
    });
  }
  function syncViewport() {
    const viewport = viewportBounds();
    for (const key of ['left', 'top', 'width', 'height'])
      box.style.setProperty(`--dsq-viewport-${key}`, `${viewport[key]}px`);
    if (!defaultLayout && !box.hidden) applyBounds(box.getBoundingClientRect());
  }
  syncViewport();
  chrome.storage.local
    .get('floatingBounds')
    .then(({ floatingBounds: bounds }) => {
      if (boundsTouched || !bounds) return;
      // Legacy rectangles may be automatic viewport snapshots, not user resizing.
      // Migrate them once so the new full-height default actually takes effect.
      if (bounds.version !== LAYOUT_VERSION)
        return chrome.storage.local.set({ floatingBounds: null });
      if (
        !['left', 'top', 'width', 'height'].every((key) =>
          Number.isFinite(bounds[key]),
        )
      )
        return;
      defaultLayout = false;
      applyBounds(bounds);
    })
    .catch(() => {});
  function saveBounds() {
    clearTimeout(saveBoundsTimer);
    saveBoundsTimer = setTimeout(() => {
      if (box.hidden) return;
      const bounds = box.getBoundingClientRect();
      chrome.storage.local
        .set({
          floatingBounds: defaultLayout
            ? null
            : {
                version: LAYOUT_VERSION,
                left: bounds.left,
                top: bounds.top,
                width: bounds.width,
                height: bounds.height,
              },
        })
        .catch(() => {});
    }, 250);
  }
  function rememberUserResize() {
    if (!resizeStart || box.hidden) return;
    const bounds = box.getBoundingClientRect();
    if (
      Math.abs(bounds.width - resizeStart.width) > 1 ||
      Math.abs(bounds.height - resizeStart.height) > 1
    ) {
      defaultLayout = false;
      boundsTouched = true;
    }
  }
  function resetBounds() {
    boundsTouched = true;
    defaultLayout = true;
    resizeStart = undefined;
    clearTimeout(saveBoundsTimer);
    for (const property of ['left', 'top', 'width', 'height'])
      box.style.removeProperty(property);
    syncViewport();
    setInactive(false);
    return chrome.storage.local.set({ floatingBounds: null });
  }
  const boundsObserver = new ResizeObserver(() => {
    rememberUserResize();
    saveBounds();
  });
  boundsObserver.observe(box);
  window.addEventListener(
    'pointerdown',
    (event) => {
      if (
        box.hidden ||
        selecting ||
        (event.button ?? 0) !== 0 ||
        !insidePanel(event)
      )
        return;
      const bounds = box.getBoundingClientRect();
      const right = bounds.left + bounds.width;
      const bottom = bounds.top + bounds.height;
      if (
        event.clientX >= right - 18 &&
        event.clientX <= right &&
        event.clientY >= bottom - 18 &&
        event.clientY <= bottom
      )
        resizeStart = bounds;
    },
    true,
  );
  for (const type of ['pointerup', 'pointercancel']) {
    window.addEventListener(
      type,
      () => {
        rememberUserResize();
        resizeStart = undefined;
      },
      true,
    );
  }
  function viewportChanged() {
    syncViewport();
    saveBounds();
  }
  window.addEventListener('resize', viewportChanged);
  window.visualViewport?.addEventListener('resize', viewportChanged);
  window.visualViewport?.addEventListener('scroll', viewportChanged);
  let selecting = false,
    target,
    pointer,
    raf;
  const mark = document.createElement('div');
  mark.className = 'mark';
  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.textContent = '点击添加此元素及其内容 · Esc 取消';
  const blocked =
    'script,style,noscript,template,input,textarea,select,[hidden],[aria-hidden="true"]';
  function visible(element) {
    const css = getComputedStyle(element);
    return (
      css.display !== 'none' &&
      css.visibility !== 'hidden' &&
      element.getClientRects().length > 0
    );
  }
  function snapshot(root) {
    const lines = [],
      images = [];
    let visited = 0,
      size = 0,
      truncated = false;
    function emit(text) {
      if (!text) return;
      const remaining = 180000 - size;
      if (remaining <= 0) {
        truncated = true;
        return;
      }
      const part = text.slice(0, remaining);
      lines.push(part);
      size += part.length;
      if (part.length < text.length) truncated = true;
    }
    function walk(node, depth) {
      if (++visited > 12000 || depth > 60 || size >= 180000) {
        truncated = true;
        return;
      }
      if (node.nodeType === Node.TEXT_NODE) {
        emit(node.textContent.replace(/\s+/g, ' ').trim());
        return;
      }
      if (
        !(node instanceof Element) ||
        node === host ||
        node.matches(blocked) ||
        node.isContentEditable ||
        !visible(node)
      )
        return;
      const tag = node.tagName.toLowerCase();
      if (tag === 'img') {
        const url = node.currentSrc || node.src;
        if (images.length < 30 && /^https?:/.test(url))
          images.push({ url, alt: node.alt || '' });
        emit(`[图片: ${node.alt || '未命名'}] ${url}`);
        return;
      }
      if (tag === 'iframe') {
        emit(`[嵌入页面，未读取] ${node.getAttribute('src') || ''}`);
        return;
      }
      const role = node.getAttribute('role');
      if (/^h[1-6]$/.test(tag)) emit('\n' + '#'.repeat(Number(tag[1])));
      if (tag === 'li' || role === 'listitem') emit('\n-');
      if (tag === 'tr') emit('\n[表格行]');
      if (tag === 'pre') {
        emit('\n```\n' + node.innerText + '\n```');
        return;
      }
      if (['button', 'summary'].includes(tag) || role === 'button')
        emit(`[${role || tag}: ${node.getAttribute('aria-label') || ''}]`);
      if (
        node.getAttribute('aria-label') &&
        !['button', 'summary'].includes(tag)
      )
        emit(`[${role || tag}: ${node.getAttribute('aria-label')}]`);
      for (const child of node.shadowRoot?.childNodes || node.childNodes)
        walk(child, depth + 1);
      if (tag === 'a' && /^https?:/.test(node.href || ''))
        emit(`(${node.href})`);
      if (['p', 'div', 'section', 'article', 'tr', 'li'].includes(tag))
        emit('\n');
    }
    walk(root, 0);
    const text = `标题: ${document.title}\n来源: ${location.href}\n范围: ${root === document.body ? '整页' : root.tagName.toLowerCase()}\n时间: ${new Date().toISOString()}\n\n${lines.join(' ').replace(/ *\n */g, '\n')}${truncated ? '\n[内容达到提取上限，已截断]' : ''}`;
    return { text, images, truncated };
  }
  function stop() {
    selecting = false;
    setInactive(false);
    box.style.visibility = '';
    cancelAnimationFrame(raf);
    mark.remove();
    hint.remove();
    window.removeEventListener('pointermove', move, true);
    window.removeEventListener('click', choose, true);
    window.removeEventListener('pointerdown', suppress, true);
    window.removeEventListener('keydown', key, true);
    window.removeEventListener('scroll', refresh, true);
    window.removeEventListener('resize', refresh);
  }
  function refresh() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      if (!selecting || !pointer) return;
      target = document.elementFromPoint(pointer.x, pointer.y);
      if (!target || target === host || target.closest(blocked)) {
        mark.hidden = true;
        return;
      }
      // Text wrappers become meaningful blocks, images remain individually selectable.
      if (['SPAN', 'B', 'STRONG', 'EM'].includes(target.tagName))
        target = target.closest('p,li,td,th,article,section,div') || target;
      const r = target.getBoundingClientRect();
      mark.hidden = false;
      Object.assign(mark.style, {
        left: `${r.left}px`,
        top: `${r.top}px`,
        width: `${r.width}px`,
        height: `${r.height}px`,
      });
    });
  }
  function suppress(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  function move(event) {
    pointer = { x: event.clientX, y: event.clientY };
    refresh();
  }
  function key(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      stop();
    }
  }
  async function choose(event) {
    if (!target || mark.hidden) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const selected = target,
      rect = selected.getBoundingClientRect();
    const payload = snapshot(selected);
    stop();
    if (selected.tagName === 'IMG') box.style.visibility = 'hidden';
    chrome.runtime
      .sendMessage({
        type: 'capture',
        payload,
        imageRect:
          selected.tagName === 'IMG'
            ? {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
                viewportWidth: innerWidth,
                viewportHeight: innerHeight,
              }
            : null,
      })
      .catch(() => {});
    // Restored after capture acknowledgement, not a timing assumption.
  }
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message.type === 'show-floating') {
      if (!frame.getAttribute('src'))
        frame.src = chrome.runtime.getURL(
          `panel.html?floating=1&source=${message.tabId}`,
        );
      box.hidden = message.toggle ? !box.hidden : false;
      if (!box.hidden) {
        syncViewport();
        setInactive(false);
      }
    }
    if (message.type === 'hide-floating') {
      stop();
      box.hidden = true;
    }
    if (
      message.type === 'frame-scheme' &&
      ['light', 'dark'].includes(message.scheme)
    )
      frame.style.setProperty('color-scheme', 'light dark', 'important');
    if (message.type === 'restore') box.style.visibility = '';
    if (message.type === 'cancel-pick') stop();
    if (message.type === 'reset-floating') {
      resetBounds().then(
        () => reply({}),
        () => reply({ ok: false, error: '无法保存默认窗口大小，请重试' }),
      );
      return true;
    }
    if (message.type === 'move-floating') {
      boundsTouched = true;
      defaultLayout = false;
      const bounds = box.getBoundingClientRect();
      applyBounds({
        left: bounds.left + (Number.isFinite(message.dx) ? message.dx : 0),
        top: bounds.top + (Number.isFinite(message.dy) ? message.dy : 0),
        width: bounds.width,
        height: bounds.height,
      });
      saveBounds();
    }
    if (message.type === 'pick') {
      stop();
      selecting = true;
      box.style.visibility = 'hidden';
      shadow.append(mark, hint);
      window.addEventListener('pointermove', move, true);
      window.addEventListener('click', choose, true);
      window.addEventListener('pointerdown', suppress, true);
      window.addEventListener('keydown', key, true);
      window.addEventListener('scroll', refresh, true);
      window.addEventListener('resize', refresh);
    }
    if (message.type === 'page') {
      const root =
        document.querySelector('main,[role="main"],article') || document.body;
      const payload = snapshot(root);
      chrome.runtime.sendMessage({ type: 'capture', payload }).catch(() => {});
    }
    reply({});
  });
  window.addEventListener('pagehide', () => {
    stop();
    clearTimeout(saveBoundsTimer);
    clearTimeout(focusTimer);
  });
})();
