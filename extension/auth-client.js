/**
 * @created 2026-11-10
 * @description 在获准的官网上下文与扩展会话内存之间复用登录，保留每个面板的聊天状态
 * @author yunhungo
 */
(() => {
  const { AUTH_KEY: key, classifyAuthValue } =
    globalThis.__DSQUICK_AUTH_CONTRACT__;
  const seedKey = '__dsquick_auth_seed_revision';
  let active = false;
  let running = false;
  let timer;
  let lastValue;
  let revision;
  let status = 'inactive';
  function read() {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  function report(next) {
    status = next;
    chrome.runtime
      .sendMessage({ type: 'auth-client-status', status })
      .catch(() => {});
  }
  async function sync() {
    if (!active || running) return;
    running = true;
    try {
      const current = read();
      if (current === lastValue) return;
      // A missing key after a previously observed credential is a logout/expiry,
      // not an invitation to silently restore it from the vault.
      if (
        classifyAuthValue(lastValue) === 'valid' &&
        classifyAuthValue(current) === 'empty'
      ) {
        await chrome.runtime.sendMessage({ type: 'auth-forget', revision });
        lastValue = null;
        report('signed-out');
        return;
      }
      const result = await chrome.runtime.sendMessage({
        type: 'auth-connect',
        value: current,
        revision,
      });
      if (!result?.ok) {
        report('unavailable');
        return;
      }
      if (result.status === 'existing' || result.status === 'published') {
        lastValue = current;
        revision = result.revision;
        report('connected');
        return;
      }
      if (result.status === 'conflict') {
        lastValue = current;
        report('existing-login-preserved');
        return;
      }
      if (
        result.status !== 'seed' ||
        result.key !== key ||
        typeof result.value !== 'string' ||
        typeof result.revision !== 'string'
      ) {
        report('no-shared-login');
        return;
      }
      // Do not modify an editor or reload a chat that already has content.
      const loginPage = /^\/(sign_in|login)(\/|$)/.test(location.pathname);
      const hasDraft = [
        ...document.querySelectorAll('textarea, [contenteditable="true"]'),
      ].some(
        (editor) =>
          (editor.value || editor.textContent || '').trim().length > 0,
      );
      if (!loginPage && hasDraft) {
        report('active-page-preserved');
        return;
      }
      if (sessionStorage.getItem(seedKey) === result.revision) {
        report('login-not-accepted');
        return;
      }
      sessionStorage.setItem(seedKey, result.revision);
      localStorage.setItem(key, result.value);
      lastValue = result.value;
      revision = result.revision;
      report('seeded');
      location.reload();
    } catch {
      report('storage-unavailable');
    } finally {
      running = false;
    }
  }
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(sync, 300);
  }
  function activate() {
    if (active) return;
    active = true;
    sync();
    const observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    window.addEventListener('storage', (event) => {
      if (event.key === key) schedule();
    });
    window.addEventListener(
      'pagehide',
      () => {
        active = false;
        observer.disconnect();
        clearTimeout(timer);
      },
      { once: true },
    );
  }
  globalThis.__DSQUICK_AUTH__ = { activate };
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id) return;
    if (
      message?.type === 'auth-available' &&
      active &&
      classifyAuthValue(read()) === 'empty'
    )
      schedule();
    if (message?.type === 'auth-status') reply({ status });
  });
  // A normal official-site tab is also an approved source for Chrome login reuse.
  if (window === window.top) activate();
})();
