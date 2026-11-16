/**
 * @created 2026-11-10
 * @description 通过父扩展页面握手启用共享玻璃适配，不依赖可能为空的 Referrer
 * @author yunhungo
 */
(() => {
  if (window === window.top) return;
  const origin = chrome.runtime.getURL('').slice(0, -1);
  let adapter;
  let authorized = false;
  let installed = false;
  let scheme;
  function syncTheme() {
    if (!scheme) return;
    const root = document.documentElement;
    for (const element of [root, document.body]) {
      if (!element) continue;
      element.classList.toggle('dark', scheme === 'dark');
      element.classList.toggle('light', scheme === 'light');
      if (element.dataset.theme !== scheme) element.dataset.theme = scheme;
    }
    if (root.style.getPropertyValue('color-scheme') !== scheme) {
      root.style.setProperty('color-scheme', scheme, 'important');
    }
  }
  function install() {
    if (!authorized || !adapter || installed) return;
    installed = true;
    // Only a non-secret diagnostic marker is shared; authentication data is never read.
    chrome.runtime
      .sendMessage({ type: 'login-probe-start' })
      .then(async (response) => {
        if (
          !response?.ok ||
          typeof response.key !== 'string' ||
          !response.key.startsWith('__dsquick_probe_')
        )
          return;
        const result = await globalThis.__DSQUICK_LOGIN_SCOPE__.inspect(
          globalThis,
          response.key,
        );
        await chrome.runtime.sendMessage({
          type: 'login-probe-result',
          result,
        });
        window.addEventListener(
          'pagehide',
          () => {
            try {
              localStorage.removeItem(response.key);
            } catch {
              /* Storage may become unavailable. */
            }
          },
          { once: true },
        );
      })
      .catch(() => {});

    globalThis.__DEEPSEEK_GLASS__ = {
      enabled: true,
      allowedHosts: ['chat.deepseek.com'],
      imeConfirmation: false,
    };
    adapter.install(globalThis);
    globalThis.__DSQUICK_PLUGIN_NOTICE__?.activate();
    // Login reuse must never prevent the independently installed visual adapter.
    try {
      globalThis.__DSQUICK_AUTH__?.activate();
    } catch {
      /* Reported separately by the login client. */
    }
    const root = document.documentElement;
    function tint() {
      syncTheme();
      const dark = root.hasAttribute('data-dsq-dark');
      const tintValue = dark ? 'rgba(0,0,0,.42)' : 'rgba(255,255,255,.32)';
      if (root.style.getPropertyValue('--dsq-backdrop-tint') !== tintValue) {
        root.style.setProperty('--dsq-backdrop-tint', tintValue, 'important');
      }
      // Website theme classes and the canvas color scheme are different facts.
      const schemes = getComputedStyle(root).colorScheme.split(/\s+/);
      const scheme =
        schemes.includes('dark') &&
        (!schemes.includes('light') ||
          matchMedia('(prefers-color-scheme: dark)').matches)
          ? 'dark'
          : 'light';
      parent.postMessage({ type: 'dsquick-glass-ready', scheme }, origin);
    }
    const observer = new MutationObserver(tint);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ['data-dsq-dark', 'class', 'style', 'data-theme'],
    });
    tint();
    window.addEventListener('pagehide', () => observer.disconnect(), {
      once: true,
    });
  }
  globalThis.__DSQUICK_REGISTER_ADAPTER__ = (value) => {
    adapter = value;
    install();
  };
  window.addEventListener('message', (event) => {
    if (
      event.source !== parent ||
      event.origin !== origin ||
      event.data?.type !== 'dsquick-configure'
    )
      return;
    authorized = true;
    if (['light', 'dark'].includes(event.data.scheme)) {
      scheme = event.data.scheme;
      syncTheme();
    }
    install();
  });
})();
