/**
 * @created 2026-11-10
 * @description 协调按标签页唤起的悬浮与固定模式，保存用户偏好
 * @author yunhungo
 */
import {
  AUTH_KEY,
  classifyAuthValue,
  validAuthValue,
  validVault,
} from './auth-session.js';

// Serialize preparation so parallel panels cannot replace one another's rules.
let embedQueue = Promise.resolve();
function prepareEmbed(tabId, remove = false) {
  const operation = embedQueue.then(async () => {
    const current = await chrome.declarativeNetRequest.getSessionRules();
    const tabs = new Set(
      current.find((rule) => rule.id === 3)?.condition.tabIds || [],
    );
    if (Number.isInteger(tabId) && tabId > 0) {
      if (remove) tabs.delete(tabId);
      else tabs.add(tabId);
    }
    const action = {
      type: 'modifyHeaders',
      responseHeaders: [
        { header: 'x-frame-options', operation: 'remove' },
        { header: 'content-security-policy', operation: 'remove' },
      ],
    };
    const condition = {
      regexFilter: '^https://chat\\.deepseek\\.com/',
      requestDomains: ['chat.deepseek.com'],
      resourceTypes: ['sub_frame'],
    };
    const desired = [
      // Initial navigation is initiated by the extension page.
      {
        id: 1,
        priority: 1,
        action,
        condition: { ...condition, initiatorDomains: [chrome.runtime.id] },
      },
      // Side-panel documents may have no browser tab; preserve their own reloads.
      {
        id: 2,
        priority: 1,
        action,
        condition: {
          ...condition,
          initiatorDomains: ['chat.deepseek.com'],
          tabIds: [-1],
        },
      },
    ];
    if (tabs.size)
      desired.push({
        id: 3,
        priority: 1,
        action,
        condition: {
          ...condition,
          initiatorDomains: ['chat.deepseek.com'],
          tabIds: [...tabs].sort((a, b) => a - b),
        },
      });
    const owned = current
      .filter((rule) => [1, 2, 3].includes(rule.id))
      .sort((a, b) => a.id - b.id);
    const signature = (rules) =>
      JSON.stringify(rules, (_key, value) =>
        value && typeof value === 'object' && !Array.isArray(value)
          ? Object.fromEntries(
              Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
            )
          : value,
      );
    if (signature(owned) === signature(desired)) return;
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: owned.map((rule) => rule.id),
      addRules: desired,
    });
  });
  embedQueue = operation.catch(() => {});
  return operation;
}
async function compareLoginScopes(reports) {
  const endpoints = [
    ...new Map(reports.map((item) => [item.tabId, item])).values(),
  ];
  if (endpoints.length < 2) return { status: 'need-two-panels' };
  const key = `__dsquick_challenge_${crypto.randomUUID()}`;
  const value = crypto.randomUUID();
  const call = (target, operation) =>
    chrome.tabs.sendMessage(
      target.tabId,
      { type: 'login-scope-challenge', operation, key, value },
      { frameId: target.frameId },
    );
  const first = endpoints[endpoints.length - 2];
  const second = endpoints[endpoints.length - 1];
  try {
    const write = await call(first, 'write');
    if (!write?.ok || !write.matched) return { status: 'write-unavailable' };
    const read = await call(second, 'read');
    if (!read?.ok) return { status: 'read-unavailable' };
    return { status: 'complete', sharedLocalStorage: read.matched === true };
  } catch {
    return { status: 'panel-changed-reopen-both' };
  } finally {
    await call(first, 'remove').catch(() => {});
  }
}
// A serialized queue prevents two newly logged-in panels from replacing each other.
let authQueue = Promise.resolve();
function authOperation(message, sender) {
  const operation = authQueue.then(async () => {
    if (
      sender.id !== chrome.runtime.id ||
      !sender.tab?.id ||
      !sender.url?.startsWith('https://chat.deepseek.com/')
    ) {
      throw new Error('无效的登录共享来源');
    }
    const saved = await chrome.storage.session.get([
      'deepseekAuthVault',
      'deepseekAuthClients',
    ]);
    const vault = validVault(saved.deepseekAuthVault)
      ? saved.deepseekAuthVault
      : null;
    const clients = Array.isArray(saved.deepseekAuthClients)
      ? saved.deepseekAuthClients
      : [];
    const endpoint = { tabId: sender.tab.id, frameId: sender.frameId || 0 };
    const others = clients.filter(
      (item) =>
        item.tabId !== endpoint.tabId || item.frameId !== endpoint.frameId,
    );
    if (message.type === 'auth-client-status') {
      const statuses = [
        'inactive',
        'unavailable',
        'signed-out',
        'connected',
        'existing-login-preserved',
        'no-shared-login',
        'active-page-preserved',
        'login-not-accepted',
        'seeded',
        'storage-unavailable',
      ];
      if (!statuses.includes(message.status))
        throw new Error('无效的登录共享状态');
      await chrome.storage.session.set({
        deepseekAuthClients: [
          ...others,
          { ...endpoint, status: message.status },
        ].slice(-32),
      });
      return {};
    }
    await chrome.storage.session.set({
      deepseekAuthClients: [...others, endpoint].slice(-32),
    });
    if (message.type === 'auth-forget') {
      if (vault && message.revision === vault.revision)
        await chrome.storage.session.remove('deepseekAuthVault');
      return {};
    }
    if (message.type !== 'auth-connect') throw new Error('未知登录操作');
    if (validAuthValue(message.value)) {
      if (
        vault &&
        (vault.value === message.value || message.revision !== vault.revision)
      ) {
        return {
          status: vault.value === message.value ? 'existing' : 'conflict',
          revision: vault.value === message.value ? vault.revision : undefined,
        };
      }
      const next = {
        key: AUTH_KEY,
        value: message.value,
        revision: crypto.randomUUID(),
      };
      await chrome.storage.session.set({ deepseekAuthVault: next });
      for (const client of others) {
        chrome.tabs
          .sendMessage(
            client.tabId,
            { type: 'auth-available' },
            { frameId: client.frameId },
          )
          .catch(() => {});
      }
      return { status: 'published', revision: next.revision };
    }
    if (classifyAuthValue(message.value) !== 'empty')
      return { status: 'unsupported-existing-login' };
    return vault ? { status: 'seed', ...vault } : { status: 'empty' };
  });
  authQueue = operation.catch(() => {});
  return operation;
}
let preferredMode = 'floating';
chrome.storage.local.get('mode').then((settings) => {
  preferredMode = settings.mode === 'fixed' ? 'fixed' : 'floating';
});
chrome.storage.onChanged.addListener((changes) => {
  if (changes.mode)
    preferredMode = changes.mode.newValue === 'fixed' ? 'fixed' : 'floating';
});
chrome.runtime.onInstalled.addListener(() =>
  chrome.sidePanel.setOptions({ enabled: false }),
);
async function activate(tab, mode = preferredMode, toggle = false) {
  if (!tab?.id || !/^https?:/.test(tab.url || ''))
    throw new Error('请先打开网页');
  if (mode === 'fixed') {
    const configured = chrome.sidePanel.setOptions({
      tabId: tab.id,
      path: `panel.html?source=${tab.id}`,
      enabled: true,
    });
    const opened = chrome.sidePanel.open({ tabId: tab.id });
    await Promise.all([configured, opened, prepareEmbed(tab.id)]);
    await chrome.tabs
      .sendMessage(tab.id, { type: 'hide-floating' })
      .catch(() => {});
    return;
  }
  await prepareEmbed(tab.id);
  if (chrome.sidePanel.close)
    await chrome.sidePanel.close({ tabId: tab.id }).catch(() => {});
  await chrome.sidePanel.setOptions({ tabId: tab.id, enabled: false });
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['source.js'],
  });
  await chrome.tabs.sendMessage(tab.id, {
    type: 'show-floating',
    tabId: tab.id,
    toggle,
  });
}
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await activate(tab, preferredMode, true).catch(console.error);
});
const trustedPanel = (sender) =>
  sender.id === chrome.runtime.id &&
  sender.url?.split('?')[0] === chrome.runtime.getURL('panel.html');
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type === 'capture') return;
  const run = async () => {
    if (
      ['auth-connect', 'auth-forget', 'auth-client-status'].includes(
        message?.type,
      )
    )
      return authOperation(message, sender);
    if (['login-probe-start', 'login-probe-result'].includes(message?.type)) {
      if (
        sender.id !== chrome.runtime.id ||
        !sender.url?.startsWith('https://chat.deepseek.com/') ||
        !sender.tab?.id ||
        !sender.frameId
      ) {
        throw new Error('无效的登录诊断来源');
      }
      const saved = await chrome.storage.session.get([
        'loginProbeKey',
        'loginProbeReports',
      ]);
      if (message.type === 'login-probe-start') {
        const key =
          saved.loginProbeKey || `__dsquick_probe_${crypto.randomUUID()}`;
        if (!saved.loginProbeKey)
          await chrome.storage.session.set({ loginProbeKey: key });
        return { key };
      }
      const result = message.result;
      if (
        !result ||
        typeof result.local?.available !== 'boolean' ||
        typeof result.local.sharedMarkerSeen !== 'boolean' ||
        !['unknown', 'granted', 'not-granted', 'unavailable'].includes(
          result.cookieAccess,
        )
      )
        throw new Error('无效的诊断结果');
      const reports = Array.isArray(saved.loginProbeReports)
        ? saved.loginProbeReports
        : [];
      const report = {
        tabId: sender.tab.id,
        frameId: sender.frameId,
        localAvailable: result.local.available,
        sharedMarkerSeen: result.local.sharedMarkerSeen,
        cookieAccess: result.cookieAccess,
      };
      const filtered = reports.filter((item) => item.tabId !== report.tabId);
      await chrome.storage.session.set({
        loginProbeReports: [...filtered, report].slice(-16),
      });
      return {};
    }

    const controls =
      sender.id === chrome.runtime.id &&
      sender.url?.split('?')[0] === chrome.runtime.getURL('controls.html');
    if (!trustedPanel(sender) && !controls) throw new Error('无效的面板请求');
    if (message.type === 'login-probe-status' && controls) {
      const { loginProbeReports = [], deepseekAuthClients = [] } =
        await chrome.storage.session.get([
          'loginProbeReports',
          'deepseekAuthClients',
        ]);
      return {
        reports: loginProbeReports,
        comparison: await compareLoginScopes(loginProbeReports),
        auth: deepseekAuthClients,
      };
    }
    if (message.type === 'prepare') {
      const source = Number(new URL(sender.url).searchParams.get('source'));
      if (!Number.isInteger(source) || source <= 0)
        throw new Error('无效的面板来源');
      await prepareEmbed(source);
      return {};
    }
    const tabId = controls
      ? message.tabId
      : Number(new URL(sender.url).searchParams.get('source'));
    if (!Number.isInteger(tabId) || tabId <= 0)
      throw new Error('请在目标网页点击 DSQuick 图标');
    const tab = await chrome.tabs.get(tabId);
    if (message.type === 'show') {
      await activate(tab, message.mode === 'fixed' ? 'fixed' : 'floating');
      return {};
    }
    if (message.type === 'source') return { tabId };
    if (message.type === 'screenshot') {
      const [active] = await chrome.tabs.query({
        active: true,
        windowId: tab.windowId,
      });
      if (active?.id !== tabId) throw new Error('网页已切换，请重新选择图片');
      return {
        image: await chrome.tabs.captureVisibleTab(tab.windowId, {
          format: 'png',
        }),
      };
    }
    if (
      ![
        'pick',
        'page',
        'cancel-pick',
        'hide-floating',
        'restore',
        'move-floating',
        'frame-scheme',
      ].includes(message.type)
    )
      throw new Error('未知操作');
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['source.js'],
    });
    if (message.type === 'pick')
      await chrome.windows.update(tab.windowId, { focused: true });
    return await chrome.tabs.sendMessage(tabId, message);
  };
  run().then(
    (value) => reply({ ok: true, ...value }),
    (error) => reply({ ok: false, error: error.message }),
  );
  return true;
});

// Source-tab metadata has the same lifetime as its browser tab.
chrome.tabs.onRemoved.addListener((tabId) => {
  prepareEmbed(tabId, true).catch(() => {});
  chrome.storage.session.remove(`route:${tabId}`).catch(() => {});
});
