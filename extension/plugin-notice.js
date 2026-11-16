/**
 * @created 2026-11-13
 * @description 记住用户确认过的官网插件提醒，仅在获准面板中避免重复展示
 * @author yunhungo
 */
(() => {
  if (window === window.top) return;
  const preference = 'pluginNoticeAcknowledged';
  const title = '请检查浏览器插件';
  let active = false;
  let acknowledged = false;
  let queued = false;
  const handled = new WeakSet();

  function isKnownNotice(button) {
    if (!button || button.textContent.trim() !== '知道了') return false;
    let container = button.parentElement;
    for (let depth = 0; container && depth < 6; depth++) {
      if (container === document.body || container === document.documentElement)
        return false;
      const text = container.textContent || '';
      if (text.length > 1200) return false;
      if (
        text.includes(title) &&
        text.includes('DeepSeek') &&
        text.includes('广告拦截') &&
        text.includes('必要请求') &&
        !container.querySelector('input,textarea,[contenteditable="true"]')
      )
        return true;
      container = container.parentElement;
    }
    return false;
  }

  function inspect() {
    queued = false;
    if (!active || !acknowledged) return;
    for (const button of document.querySelectorAll('button,[role="button"]')) {
      if (
        handled.has(button) ||
        button.disabled ||
        button.getAttribute('aria-disabled') === 'true' ||
        !button.getClientRects().length ||
        !isKnownNotice(button)
      )
        continue;
      handled.add(button);
      button.click();
    }
  }

  function schedule() {
    if (queued || !active || !acknowledged) return;
    queued = true;
    Promise.resolve().then(inspect);
  }

  function recordAcknowledgement(event) {
    if (!event.isTrusted) return;
    const button = event.target.closest?.('button,[role="button"]');
    if (!isKnownNotice(button)) return;
    acknowledged = true;
    // Store only the explicit acknowledgement, never notice or conversation text.
    chrome.storage.local.set({ [preference]: true }).catch(() => {});
  }

  function preferenceChanged(changes, area) {
    if (area !== 'local' || !changes[preference]) return;
    acknowledged = changes[preference].newValue === true;
    schedule();
  }

  function activate() {
    if (active) return;
    active = true;
    document.addEventListener('click', recordAcknowledgement, true);
    chrome.storage.onChanged.addListener(preferenceChanged);
    const observer = new MutationObserver((records) => {
      // The site can detach and reuse a dialog instead of creating new buttons.
      // A WeakSet must not permanently suppress that later presentation.
      for (const record of records) {
        for (const node of record.removedNodes || []) {
          handled.delete(node);
          for (const button of node.querySelectorAll?.('button,[role="button"]') || [])
            handled.delete(button);
        }
      }
      // Chat streaming does not need a page-wide scan on every token.
      if (
        records.some((record) =>
          [...record.addedNodes].some((node) => {
            const text = node.textContent || '';
            return text.includes(title) || text.trim() === '知道了';
          }),
        )
      )
        schedule();
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    chrome.storage.local
      .get(preference)
      .then((saved) => {
        if (!active) return;
        acknowledged ||= saved[preference] === true;
        schedule();
      })
      .catch(() => {});
    window.addEventListener(
      'pagehide',
      () => {
        active = false;
        observer.disconnect();
        document.removeEventListener('click', recordAcknowledgement, true);
        chrome.storage.onChanged.removeListener(preferenceChanged);
      },
      { once: true },
    );
  }

  // The bootstrap calls this only after verifying the extension parent handshake.
  globalThis.__DSQUICK_PLUGIN_NOTICE__ = { activate };
})();
