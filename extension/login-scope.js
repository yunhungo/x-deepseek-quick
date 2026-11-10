/**
 * @created 2026-11-10
 * @description 使用无账号信息的临时标记检查跨面板存储上下文
 * @author yunhungo
 */
(function (root, factory) {
  const scope = factory();
  if (typeof module === 'object' && module.exports) module.exports = scope;
  else {
    root.__DSQUICK_LOGIN_SCOPE__ = scope;
    if (root.location.hostname === 'chat.deepseek.com') {
      chrome.runtime.onMessage.addListener((message, sender, reply) => {
        if (
          sender.id !== chrome.runtime.id ||
          message?.type !== 'login-scope-challenge'
        )
          return;
        try {
          reply(scope.challenge(root.localStorage, message));
        } catch {
          reply({ ok: false });
        }
      });
    }
  }
})(globalThis, function () {
  function probe(storage, key) {
    try {
      const sharedMarkerSeen = storage.getItem(key) === '1';
      storage.setItem(key, '1');
      return { available: storage.getItem(key) === '1', sharedMarkerSeen };
    } catch {
      return { available: false, sharedMarkerSeen: false };
    }
  }
  async function inspect(w, key) {
    const result = {
      local: { available: false, sharedMarkerSeen: false },
      cookieAccess: 'unknown',
    };
    try {
      result.local = probe(w.localStorage, key);
    } catch {
      /* Storage can be denied at getter access. */
    }
    if (typeof w.document.hasStorageAccess === 'function') {
      try {
        result.cookieAccess = (await w.document.hasStorageAccess())
          ? 'granted'
          : 'not-granted';
      } catch {
        result.cookieAccess = 'unavailable';
      }
    }
    return result;
  }
  function challenge(storage, message) {
    if (
      typeof message.key !== 'string' ||
      !/^__dsquick_challenge_[a-z0-9-]+$/.test(message.key) ||
      typeof message.value !== 'string' ||
      !/^[a-z0-9-]{1,80}$/.test(message.value)
    )
      return { ok: false };
    try {
      if (message.operation === 'write')
        storage.setItem(message.key, message.value);
      else if (message.operation === 'remove') {
        storage.removeItem(message.key);
        return { ok: true };
      } else if (message.operation !== 'read') return { ok: false };
      return {
        ok: true,
        matched: storage.getItem(message.key) === message.value,
      };
    } catch {
      return { ok: false };
    }
  }
  return { probe, inspect, challenge };
});
