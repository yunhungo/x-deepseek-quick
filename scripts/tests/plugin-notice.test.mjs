/**
 * @created 2026-11-13
 * @description 验证官网插件提醒仅在用户确认后记忆，且不影响其他提示
 * @author yunhungo
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(
  new URL('../../extension/plugin-notice.js', import.meta.url),
  'utf8',
);
const knownText =
  '请检查浏览器插件 广告拦截、隐私保护等浏览器插件可能会拦截 DeepSeek 的必要请求，影响正常使用。知道了';
function notice({
  saved = false,
  topLevel = false,
  activate = true,
  text = knownText,
  editable = false,
} = {}) {
  const clickListeners = new Set();
  const storageListeners = new Set();
  const windowListeners = new Map();
  const buttons = [];
  const writes = [];
  let mutation;
  let disconnected = false;
  let scans = 0;
  let reads = 0;
  const document = {
    body: {},
    documentElement: {},
    addEventListener(_type, callback) {
      clickListeners.add(callback);
    },
    removeEventListener(_type, callback) {
      clickListeners.delete(callback);
    },
    querySelectorAll() {
      scans++;
      return buttons;
    },
  };
  function addButton(content = knownText, hasEditor = false) {
    const card = {
      textContent: content,
      parentElement: document.body,
      querySelector: () => (hasEditor ? {} : null),
    };
    const button = {
      textContent: '知道了',
      parentElement: card,
      disabled: false,
      visible: true,
      clicks: 0,
      getAttribute() {
        return null;
      },
      getClientRects() {
        return this.visible ? [1] : [];
      },
      closest() {
        return this;
      },
      click() {
        this.clicks++;
        for (const callback of clickListeners)
          callback({ isTrusted: false, target: this });
        this.visible = false;
      },
    };
    buttons.push(button);
    return button;
  }
  const button = addButton(text, editable);
  const window = {
    top: {},
    addEventListener(type, callback) {
      windowListeners.set(type, callback);
    },
  };
  if (topLevel) window.top = window;
  const context = vm.createContext({
    window,
    document,
    chrome: {
      storage: {
        local: {
          get: async () => {
            reads++;
            return { pluginNoticeAcknowledged: saved };
          },
          set: async (value) => {
            writes.push(value);
          },
        },
        onChanged: {
          addListener(callback) {
            storageListeners.add(callback);
          },
          removeListener(callback) {
            storageListeners.delete(callback);
          },
        },
      },
    },
    MutationObserver: class {
      constructor(callback) {
        mutation = callback;
      }
      observe() {}
      disconnect() {
        disconnected = true;
      }
    },
  });
  vm.runInContext(source, context);
  if (activate) context.__DSQUICK_PLUGIN_NOTICE__?.activate();
  return {
    button,
    writes,
    addButton,
    get scans() {
      return scans;
    },
    get reads() {
      return reads;
    },
    userClick() {
      for (const callback of clickListeners)
        callback({ isTrusted: true, target: button });
      button.click();
    },
    changePreference(value) {
      for (const callback of storageListeners)
        callback({ pluginNoticeAcknowledged: { newValue: value } }, 'local');
    },
    mutate(text) {
      mutation?.([{ addedNodes: [{ textContent: text }] }]);
    },
    showAgain() {
      mutation?.([{ addedNodes: [], removedNodes: [button] }]);
      button.visible = true;
      mutation?.([{ addedNodes: [button], removedNodes: [] }]);
    },
    hide() {
      windowListeners.get('pagehide')?.();
    },
    get disconnected() {
      return disconnected;
    },
    get listenerCount() {
      return storageListeners.size + clickListeners.size;
    },
  };
}
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

test('new users see the notice until they explicitly acknowledge it', async () => {
  const state = notice();
  await settle();
  assert.equal(state.button.clicks, 0);
  state.userClick();
  assert.equal(state.writes.length, 1);
  assert.equal(state.writes[0].pluginNoticeAcknowledged, true);
  assert.deepEqual(Object.keys(state.writes[0]), ['pluginNoticeAcknowledged']);
  const next = notice({ saved: true });
  await settle();
  assert.equal(next.button.clicks, 1);
  assert.equal(next.writes.length, 0);
});

test('synthetic website clicks are not treated as user acknowledgement', async () => {
  const state = notice();
  state.button.click();
  await settle();
  assert.equal(state.writes.length, 0);
});

test('similar warnings and dialogs with editable fields are preserved', async () => {
  for (const options of [
    { text: '请检查浏览器插件 网络请求失败，请稍后重试。知道了' },
    { text: '请重新登录 DeepSeek。知道了' },
    { editable: true },
  ]) {
    const state = notice({ saved: true, ...options });
    await settle();
    assert.equal(state.button.clicks, 0);
  }
});

test('ordinary site tabs and unauthorized frames never activate notice handling', async () => {
  for (const options of [{ topLevel: true }, { activate: false }]) {
    const state = notice({ saved: true, ...options });
    await settle();
    assert.equal(state.reads, 0);
    assert.equal(state.button.clicks, 0);
    assert.equal(state.listenerCount, 0);
  }
});

test('repeated chat mutations do not scan the entire page and new known notices close once', async () => {
  const state = notice({ saved: true });
  await settle();
  const initialScans = state.scans;
  for (let index = 0; index < 100; index++) state.mutate('普通聊天片段');
  await settle();
  assert.equal(state.scans, initialScans);
  const nextButton = state.addButton();
  state.mutate('请检查浏览器插件');
  state.mutate('知道了');
  await settle();
  assert.equal(nextButton.clicks, 1);
  assert.equal(state.button.clicks, 1);
  state.hide();
  assert.equal(state.disconnected, true);
  assert.equal(state.listenerCount, 0);
});

test('acknowledgement from another panel is observed without storing notice text', async () => {
  const state = notice();
  await settle();
  state.changePreference(true);
  await settle();
  assert.equal(state.button.clicks, 1);
  assert.equal(state.writes.length, 0);
});


test('a detached notice button reused by the site can be dismissed again', async () => {
  const state = notice({ saved: true });
  await settle();
  assert.equal(state.button.clicks, 1);
  state.showAgain();
  await settle();
  assert.equal(state.button.clicks, 2);
  assert.equal(state.writes.length, 0);
});
