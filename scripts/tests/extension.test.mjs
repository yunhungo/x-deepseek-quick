/**
 * @created 2026-11-10
 * @description 验证扩展的消息信任边界、嵌入规则和附件重试幂等性
 * @author yunhungo
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const panelOpening = await import('../../extension/panel-opening.js');
const authContract = await import('../../extension/auth-session.js');
const workerSource = (
  await readFile(new URL('../../extension/worker.js', import.meta.url), 'utf8')
)
  .replace(/^import[\s\S]*?from '\.\/auth-session\.js';\s*/m, '')
  .replace(/^import .*panel-opening.js';\s*/m, '');
const uploadSource = await readFile(
  new URL('../../extension/upload.js', import.meta.url),
  'utf8',
);
function worker() {
  const handlers = {},
    calls = [];
  const state = { windowsByTab: {} };
  const rules = new Map();
  const chrome = {
    storage: {
      local: { get: async () => ({}) },
      onChanged: {
        addListener: (fn) => {
          handlers.settings = fn;
        },
      },
      session: {
        get: async () => state,
        set: async (value) => Object.assign(state, value),
        remove: async (key) => {
          delete state[key];
        },
      },
    },
    windows: {
      get: async (id) =>
        id === 3 ? { id, left: 0, top: 0 } : { id, state: 'normal' },
      create: async (options) => {
        calls.push(['window', options]);
        return { id: 22 };
      },
      update: async (...args) => {
        calls.push(['window-update', ...args]);
      },
      remove: async () => {},
    },
    runtime: {
      onInstalled: {
        addListener: (fn) => {
          handlers.install = fn;
        },
      },
      id: 'test-id',
      getURL: (path) => `chrome-extension://test-id/${path}`,
      onMessage: {
        addListener: (fn) => {
          handlers.message = fn;
        },
      },
    },
    action: {
      onClicked: {
        addListener: (fn) => {
          handlers.action = fn;
        },
      },
    },
    commands: {
      onCommand: {
        addListener: (fn) => {
          handlers.command = fn;
        },
      },
    },
    tabs: {
      onRemoved: {
        addListener: (fn) => {
          handlers.remove = fn;
        },
      },
      query: async () => [{ id: 7, windowId: 3 }],
      get: async (id) => ({ id, windowId: 3, url: 'https://example.com/' }),
      sendMessage: async (...args) => {
        calls.push(['send', ...args]);
        return {};
      },
      create: async (options) => {
        calls.push(['create', options]);
      },
      captureVisibleTab: async () => 'data:image/png;base64,AAAA',
    },
    scripting: {
      executeScript: async (options) => {
        calls.push(['inject', options]);
      },
    },
    sidePanel: {
      setOptions: async (options) => {
        calls.push(['panel-options', options]);
      },
      open: async (options) => {
        calls.push(['open', options]);
      },
    },
    declarativeNetRequest: {
      getSessionRules: async () => [...rules.values()],
      updateSessionRules: async (options) => {
        calls.push(['rules', options]);
        for (const id of options.removeRuleIds) rules.delete(id);
        for (const rule of options.addRules) rules.set(rule.id, rule);
      },
    },
  };
  vm.runInNewContext(workerSource, {
    chrome,
    console,
    URL,
    crypto,
    ...authContract,
    ...panelOpening,
  });
  const message = (body, sender) =>
    new Promise((resolve) => handlers.message(body, sender, resolve));
  return { calls, handlers, message, state, rules };
}
const panel = {
  id: 'test-id',
  url: 'chrome-extension://test-id/panel.html?source=7',
  tab: { id: 7, url: 'https://example.com' },
};
test('web page and DeepSeek frames cannot invoke privileged panel commands', async () => {
  const context = worker();
  const result = await context.message(
    { type: 'screenshot' },
    { id: 'test-id', url: 'https://chat.deepseek.com', tab: { id: 7 } },
  );
  assert.equal(result.ok, false);
  assert.equal(context.calls.length, 0);
});
test('embedding exceptions are limited to own initiator, DeepSeek and child documents', async () => {
  const context = worker();
  assert.equal((await context.message({ type: 'prepare' }, panel)).ok, true);
  const condition = context.calls[0][1].addRules[0].condition;
  assert.deepEqual(Array.from(condition.initiatorDomains), ['test-id']);
  assert.deepEqual(Array.from(condition.requestDomains), ['chat.deepseek.com']);
  assert.deepEqual(Array.from(condition.resourceTypes), ['sub_frame']);
});
test('selection commands inject only into the originating tab', async () => {
  const context = worker();
  assert.equal((await context.message({ type: 'pick' }, panel)).ok, true);
  assert.equal(context.calls[0][1].target.tabId, 7);
  const send = context.calls.find((call) => call[0] === 'send');
  assert.equal(send[1], 7);
  assert.equal(send[2].type, 'pick');
});
test('page events are left for the requesting panel rather than treated as commands', () => {
  const context = worker();
  assert.equal(
    context.handlers.message({ type: 'capture' }, {}, () => assert.fail()),
    undefined,
  );
});
function upload(hasInput = true) {
  const handlers = {},
    replies = [],
    events = [];
  const parent = { postMessage: (message) => replies.push(message) };
  const input = {
    disabled: false,
    accept: '.txt',
    dispatchEvent: (event) => events.push(event),
  };
  class Transfer {
    files = [];
    items = { add: (file) => this.files.push(file) };
  }
  const window = {
    top: {},
    addEventListener: (type, fn) => {
      handlers[type] = fn;
    },
  };
  vm.runInNewContext(uploadSource, {
    window,
    parent,
    chrome: {
      runtime: {
        getURL: () => 'chrome-extension://test-id/',
        sendMessage: async () => ({ ok: false }),
      },
    },
    location: { href: 'https://chat.deepseek.com/' },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    document: {
      documentElement: {},
      querySelectorAll: () => (hasInput ? [input] : []),
    },
    DataTransfer: Transfer,
    File,
    Event,
    Set,
    URL,
    fetch,
  });
  const send = (data, origin = 'chrome-extension://test-id', source = parent) =>
    handlers.message({ data, origin, source });
  return { send, input, replies, events };
}
const attachment = {
  type: 'dsquick-upload',
  id: 'uuid',
  files: [{ name: 'uuid.txt', type: 'text/plain', text: '# public example' }],
};
test('foreign origins cannot attach content even with a matching message shape', async () => {
  const context = upload();
  await context.send(attachment, 'https://example.com');
  assert.equal(context.events.length, 0);
});
test('attachment retries dispatch once and preserve UUID file contents', async () => {
  const context = upload();
  await context.send(attachment);
  await context.send(attachment);
  assert.equal(context.events.length, 1);
  assert.equal(context.events[0].type, 'change');
  assert.equal(context.input.files[0].name, 'uuid.txt');
  assert.equal(await context.input.files[0].text(), '# public example');
  assert.equal(context.replies.at(-1).ok, true);
});
test('missing or incompatible official upload controls fail explicitly', async () => {
  const context = upload(false);
  await context.send(attachment);
  assert.equal(context.replies.at(-1).ok, false);
  const other = upload();
  other.input.accept = 'image/*';
  await other.send(attachment);
  assert.equal(other.events.length, 0);
  assert.equal(other.replies.at(-1).ok, false);
});

test('fixed panels are scoped to an explicitly requested tab, without creating windows', async () => {
  const context = worker();
  const controls = {
    id: 'test-id',
    url: 'chrome-extension://test-id/controls.html',
  };
  assert.equal(
    (await context.message({ type: 'show', mode: 'fixed', tabId: 7 }, controls))
      .ok,
    true,
  );
  assert.equal(
    (await context.message({ type: 'show', mode: 'fixed', tabId: 8 }, controls))
      .ok,
    true,
  );
  assert.equal(context.calls.filter((call) => call[0] === 'window').length, 0);
  const options = context.calls.filter((call) => call[0] === 'panel-options');
  assert.equal(options[0][1].path, 'panel.html?source=7');
  assert.equal(options[1][1].path, 'panel.html?source=8');
  assert.ok(options.every((call) => Number.isInteger(call[1].tabId)));
});
test('install disables the global panel instead of enabling it across all websites', async () => {
  const context = worker();
  await context.handlers.install();
  assert.equal(context.calls[0][0], 'panel-options');
  assert.equal(context.calls[0][1].enabled, false);
});

const sourceScript = await readFile(
  new URL('../../extension/source.js', import.meta.url),
  'utf8',
);
test('Escape removes selection interceptors and selection can start again', async () => {
  const listeners = new Map();
  let receive;
  class FakeElement {
    style = {};
    dataset = {};
    attributes = new Map();
    children = [];
    textContent = '';
    append(...nodes) {
      this.children.push(...nodes);
    }
    attachShadow() {
      return new FakeElement();
    }
    remove() {
      this.removed = true;
    }
    setAttribute(key, value) {
      this.attributes.set(key, value);
    }
    getAttribute(key) {
      return this.attributes.get(key) || null;
    }
  }
  const window = {
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      listeners.get(type)?.delete(handler);
    },
  };
  const document = {
    createElement: () => new FakeElement(),
    documentElement: new FakeElement(),
  };
  vm.runInNewContext(sourceScript, {
    window,
    document,
    Element: FakeElement,
    innerWidth: 1200,
    innerHeight: 800,
    chrome: {
      storage: { local: { get: async () => ({}), set: async () => {} } },
      runtime: {
        id: 'test-id',
        getURL: (value) => `chrome-extension://test-id/${value}`,
        onMessage: {
          addListener: (fn) => {
            receive = fn;
          },
        },
      },
    },
    ResizeObserver: class {
      observe() {}
    },
    cancelAnimationFrame() {},
    requestAnimationFrame() {},
    clearTimeout,
    setTimeout,
  });
  const message = (type) => receive({ type }, { id: 'test-id' }, () => {});
  message('pick');
  assert.equal(listeners.get('click').size, 1);
  assert.equal(listeners.get('pointerdown').size, 1);
  let prevented = false;
  for (const handler of [...listeners.get('keydown')])
    handler({
      key: 'Escape',
      preventDefault() {
        prevented = true;
      },
      stopImmediatePropagation() {},
    });
  assert.equal(prevented, true);
  for (const type of [
    'click',
    'pointerdown',
    'pointermove',
    'keydown',
    'scroll',
  ])
    assert.equal(listeners.get(type)?.size || 0, 0);
  message('pick');
  assert.equal(listeners.get('click').size, 1);
  message('cancel-pick');
  assert.equal(listeners.get('click').size, 0);
});

const bootstrapScript = await readFile(
  new URL('../../extension/bootstrap.js', import.meta.url),
  'utf8',
);
test('glass activation works without Referrer and requires the extension parent handshake', () => {
  const handlers = {},
    notices = [],
    styles = new Map();
  const parent = { postMessage: (message) => notices.push(message) };
  const window = {
    top: {},
    addEventListener: (type, fn) => {
      handlers[type] = fn;
    },
  };
  const context = vm.createContext({
    window,
    parent,
    getComputedStyle: () => ({ colorScheme: 'normal' }),
    matchMedia: () => ({ matches: false }),
    chrome: {
      runtime: {
        getURL: () => 'chrome-extension://test-id/',
        sendMessage: async () => ({ ok: false }),
      },
    },
    document: {
      referrer: '',
      documentElement: {
        hasAttribute: () => false,
        style: {
          getPropertyValue: (name) => styles.get(name),
          setProperty: (name, value) => styles.set(name, value),
        },
      },
    },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
  });
  vm.runInContext(bootstrapScript, context);
  let installs = 0;
  context.__DSQUICK_REGISTER_ADAPTER__({ install: () => installs++ });
  const message = { type: 'dsquick-configure' };
  handlers.message({
    source: parent,
    origin: 'https://example.com',
    data: message,
  });
  assert.equal(installs, 0);
  handlers.message({
    source: {},
    origin: 'chrome-extension://test-id',
    data: message,
  });
  assert.equal(installs, 0);
  handlers.message({
    source: parent,
    origin: 'chrome-extension://test-id',
    data: message,
  });
  handlers.message({
    source: parent,
    origin: 'chrome-extension://test-id',
    data: message,
  });
  assert.equal(installs, 1);
  assert.equal(context.__DEEPSEEK_GLASS__.enabled, true);
  assert.equal(context.__DEEPSEEK_GLASS__.imeConfirmation, false);
  assert.equal(styles.get('--dsq-backdrop-tint'), 'rgba(255,255,255,.32)');
  assert.equal(notices.at(-1).type, 'dsquick-glass-ready');
  assert.equal(notices.at(-1).scheme, 'light');
});

const { resolveScheme } = await import('../../extension/appearance.js');
test('frame canvas scheme follows explicit theme and resolves system preference', () => {
  assert.equal(resolveScheme('light', true), 'light');
  assert.equal(resolveScheme('dark', false), 'dark');
  assert.equal(resolveScheme('system', true), 'dark');
  assert.equal(resolveScheme('system', false), 'light');
  assert.equal(resolveScheme('invalid', true), 'dark');
});

const loginModule = { exports: {} };
vm.runInNewContext(
  await readFile(
    new URL('../../extension/login-scope.js', import.meta.url),
    'utf8',
  ),
  { module: loginModule },
);
test('login probe distinguishes shared versus isolated storage without reading other keys', async () => {
  function storage() {
    const values = new Map();
    return {
      getItem(key) {
        assert.equal(key, '__dsquick_probe_test');
        return values.get(key) ?? null;
      },
      setItem(key, value) {
        assert.equal(key, '__dsquick_probe_test');
        values.set(key, value);
      },
    };
  }
  const shared = storage();
  const inspect = (value) =>
    loginModule.exports.inspect(
      {
        localStorage: value,
        document: { hasStorageAccess: async () => false },
      },
      '__dsquick_probe_test',
    );
  assert.equal((await inspect(shared)).local.sharedMarkerSeen, false);
  assert.equal((await inspect(shared)).local.sharedMarkerSeen, true);
  const isolated = await inspect(storage());
  assert.equal(isolated.local.sharedMarkerSeen, false);
  assert.equal(isolated.cookieAccess, 'not-granted');
});
test('login probe reports storage denial rather than treating it as logged out', async () => {
  const w = {
    get localStorage() {
      throw new Error('denied');
    },
    document: {},
  };
  const report = await loginModule.exports.inspect(w, '__dsquick_probe_test');
  assert.equal(report.local.available, false);
  assert.equal(report.cookieAccess, 'unknown');
});

test('sequential login challenge reads another context without creating a marker there', () => {
  const challenge = loginModule.exports.challenge;
  const store = () => {
    const data = new Map();
    return {
      data,
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => data.set(key, value),
      removeItem: (key) => data.delete(key),
    };
  };
  const a = store(),
    b = store();
  const message = {
    key: '__dsquick_challenge_test',
    value: 'public-test-marker',
  };
  assert.equal(challenge(a, { ...message, operation: 'write' }).matched, true);
  assert.equal(challenge(a, { ...message, operation: 'read' }).matched, true);
  assert.equal(challenge(b, { ...message, operation: 'read' }).matched, false);
  assert.equal(b.data.size, 0);
  challenge(a, { ...message, operation: 'remove' });
  assert.equal(a.data.size, 0);
  assert.equal(
    challenge(a, { ...message, key: 'unrelated-key', operation: 'read' }).ok,
    false,
  );
});

test('auth vault shares only the allowlisted login item across approved DeepSeek frames', async () => {
  const context = worker();
  const a = {
    id: 'test-id',
    url: 'https://chat.deepseek.com/',
    tab: { id: 7 },
    frameId: 1,
  };
  const b = { ...a, tab: { id: 8 }, frameId: 2 };
  const value = JSON.stringify({ value: 'fixture-token-one', __version: '0' });
  const published = await context.message({ type: 'auth-connect', value }, a);
  assert.equal(published.ok, true);
  assert.equal(published.status, 'published');
  const seeded = await context.message(
    { type: 'auth-connect', value: null },
    b,
  );
  assert.equal(seeded.status, 'seed');
  assert.equal(seeded.key, 'userToken');
  assert.equal(seeded.value, value);
  const denied = await context.message(
    { type: 'auth-connect', value: null },
    { ...b, url: 'https://example.com/' },
  );
  assert.equal(denied.ok, false);
  assert.equal(Object.hasOwn(denied, 'value'), false);
});
test('different existing login is preserved and logout clears the matching vault', async () => {
  const context = worker();
  const a = {
    id: 'test-id',
    url: 'https://chat.deepseek.com/',
    tab: { id: 7 },
    frameId: 1,
  };
  const b = { ...a, tab: { id: 8 }, frameId: 2 };
  const first = await context.message(
    { type: 'auth-connect', value: 'fixture-token-one' },
    a,
  );
  const conflict = await context.message(
    { type: 'auth-connect', value: 'fixture-token-two' },
    b,
  );
  assert.equal(conflict.status, 'conflict');
  assert.equal(Object.hasOwn(conflict, 'value'), false);
  await context.message({ type: 'auth-forget', revision: first.revision }, a);
  const empty = await context.message({ type: 'auth-connect', value: null }, b);
  assert.equal(empty.status, 'empty');
});
test('credential refresh replaces only a matching vault revision', async () => {
  const context = worker();
  const sender = {
    id: 'test-id',
    url: 'https://chat.deepseek.com/',
    tab: { id: 7 },
    frameId: 1,
  };
  const first = await context.message(
    { type: 'auth-connect', value: 'fixture-token-one' },
    sender,
  );
  const refreshed = await context.message(
    {
      type: 'auth-connect',
      value: 'fixture-token-renewed',
      revision: first.revision,
    },
    sender,
  );
  assert.equal(refreshed.status, 'published');
  assert.notEqual(refreshed.revision, first.revision);
  const seeded = await context.message(
    { type: 'auth-connect', value: null },
    { ...sender, frameId: 2 },
  );
  assert.equal(seeded.value, 'fixture-token-renewed');
});

const authClientSource = await readFile(
  new URL('../../extension/auth-client.js', import.meta.url),
  'utf8',
);
async function runAuthClient({
  value = null,
  revision = null,
  draft = false,
} = {}) {
  const local = new Map(value === null ? [] : [['userToken', value]]);
  const session = new Map(
    revision ? [['__dsquick_auth_seed_revision', revision]] : [],
  );
  const calls = [];
  let reloads = 0;
  const window = { addEventListener() {} };
  window.top = window;
  const storage = (data) => ({
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, next) => data.set(key, next),
  });
  vm.runInNewContext(authClientSource, {
    window,
    __DSQUICK_AUTH_CONTRACT__: authContract,
    document: {
      documentElement: {},
      querySelectorAll: () =>
        draft ? [{ value: 'unsent fixture draft' }] : [],
    },
    location: { pathname: draft ? '/' : '/sign_in', reload: () => reloads++ },
    localStorage: storage(local),
    sessionStorage: storage(session),
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    setTimeout,
    clearTimeout,
    chrome: {
      runtime: {
        id: 'test-id',
        onMessage: { addListener() {} },
        sendMessage: async (message) => {
          calls.push(message);
          return message.type === 'auth-connect'
            ? {
                ok: true,
                status:
                  authContract.classifyAuthValue(value) === 'valid'
                    ? 'conflict'
                    : 'seed',
                key: 'userToken',
                value: 'fixture-shared-token',
                revision: 'fixture-revision',
              }
            : { ok: true };
        },
      },
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  return { local, session, calls, reloads };
}
test('missing login is seeded once and only the website frame reloads', async () => {
  const context = await runAuthClient();
  assert.equal(context.local.get('userToken'), 'fixture-shared-token');
  assert.equal(context.local.size, 1);
  assert.equal(
    context.session.get('__dsquick_auth_seed_revision'),
    'fixture-revision',
  );
  assert.equal(context.reloads, 1);
});
test('invalid login cannot cause repeated seed reloads and nonempty drafts stay intact', async () => {
  const rejected = await runAuthClient({ revision: 'fixture-revision' });
  assert.equal(rejected.reloads, 0);
  assert.equal(rejected.local.size, 0);
  assert.ok(
    rejected.calls.some((call) => call.status === 'login-not-accepted'),
  );
  const editing = await runAuthClient({ draft: true });
  assert.equal(editing.reloads, 0);
  assert.equal(editing.local.size, 0);
  assert.ok(
    editing.calls.some((call) => call.status === 'active-page-preserved'),
  );
});
test('client never replaces an existing different login', async () => {
  const context = await runAuthClient({ value: 'fixture-existing-token' });
  assert.equal(context.local.get('userToken'), 'fixture-existing-token');
  assert.equal(context.reloads, 0);
});

test('signed-out JSON wrappers are empty login, not a conflicting account', async () => {
  for (const value of [
    'null',
    '{"value":null,"__version":"0"}',
    '{"value":"","__version":"0"}',
  ]) {
    assert.equal(authContract.classifyAuthValue(value), 'empty');
    const context = worker();
    const sender = {
      id: 'test-id',
      url: 'https://chat.deepseek.com/',
      tab: { id: 7 },
      frameId: 1,
    };
    await context.message(
      { type: 'auth-connect', value: 'fixture-token-one' },
      sender,
    );
    const result = await context.message(
      { type: 'auth-connect', value },
      { ...sender, frameId: 2 },
    );
    assert.equal(result.status, 'seed');
    const client = await runAuthClient({ value });
    assert.equal(client.local.get('userToken'), 'fixture-shared-token');
    assert.equal(client.reloads, 1);
  }
  assert.equal(
    authContract.classifyAuthValue('{"unknown":"fixture"}'),
    'unsupported',
  );
});

test('dark website styling does not force a dark canvas, and auth failure cannot stop glass', () => {
  const handlers = {},
    posts = [];
  let refresh,
    installs = 0,
    writes = 0;
  const styles = new Map();
  const parent = { postMessage: (value) => posts.push(value) };
  const context = vm.createContext({
    parent,
    window: {
      top: {},
      addEventListener: (type, fn) => {
        handlers[type] = fn;
      },
    },
    document: {
      documentElement: {
        hasAttribute: () => true,
        style: {
          getPropertyValue: (key) => styles.get(key),
          setProperty: (key, value) => {
            writes++;
            styles.set(key, value);
          },
        },
      },
    },
    getComputedStyle: () => ({ colorScheme: 'normal' }),
    matchMedia: () => ({ matches: false }),
    MutationObserver: class {
      constructor(callback) {
        refresh = callback;
      }
      observe() {}
      disconnect() {}
    },
    chrome: {
      runtime: {
        getURL: () => 'chrome-extension://test-id/',
        sendMessage: async () => ({ ok: false }),
      },
    },
    __DSQUICK_AUTH__: {
      activate() {
        throw new Error('fixture unavailable');
      },
    },
  });
  vm.runInContext(bootstrapScript, context);
  context.__DSQUICK_REGISTER_ADAPTER__({ install: () => installs++ });
  assert.doesNotThrow(() =>
    handlers.message({
      source: parent,
      origin: 'chrome-extension://test-id',
      data: { type: 'dsquick-configure' },
    }),
  );
  assert.equal(installs, 1);
  assert.equal(posts.at(-1).scheme, 'light');
  assert.equal(styles.get('--dsq-backdrop-tint'), 'rgba(0,0,0,.42)');
  refresh();
  assert.equal(writes, 1);
});

function allowsEmbeddedRequest(
  rules,
  {
    initiator,
    tabId,
    type = 'sub_frame',
    url = 'https://chat.deepseek.com/sign_in',
  },
) {
  return [...rules.values()].some(
    ({ condition }) =>
      condition.resourceTypes.includes(type) &&
      condition.initiatorDomains.includes(initiator) &&
      (!condition.tabIds || condition.tabIds.includes(tabId)) &&
      new RegExp(condition.regexFilter).test(url),
  );
}
test('first embedded load and website-initiated login reload both match, other pages do not', async () => {
  const context = worker();
  assert.equal((await context.message({ type: 'prepare' }, panel)).ok, true);
  assert.equal(
    allowsEmbeddedRequest(context.rules, { initiator: 'test-id', tabId: 7 }),
    true,
  );
  assert.equal(
    allowsEmbeddedRequest(context.rules, {
      initiator: 'chat.deepseek.com',
      tabId: 7,
    }),
    true,
  );
  assert.equal(
    allowsEmbeddedRequest(context.rules, {
      initiator: 'chat.deepseek.com',
      tabId: -1,
    }),
    true,
  );
  assert.equal(
    allowsEmbeddedRequest(context.rules, {
      initiator: 'chat.deepseek.com',
      tabId: 8,
    }),
    false,
  );
  assert.equal(
    allowsEmbeddedRequest(context.rules, {
      initiator: 'example.com',
      tabId: 7,
    }),
    false,
  );
  assert.equal(
    allowsEmbeddedRequest(context.rules, {
      initiator: 'chat.deepseek.com',
      tabId: 7,
      type: 'main_frame',
    }),
    false,
  );
  assert.equal(
    allowsEmbeddedRequest(context.rules, {
      initiator: 'chat.deepseek.com',
      tabId: 7,
      url: 'https://chat.deepseek.com.example.org/',
    }),
    false,
  );
});
test('concurrent panel preparation keeps both tab scopes and reuses existing rules', async () => {
  const context = worker();
  await Promise.all([
    context.message({ type: 'prepare' }, panel),
    context.message(
      { type: 'prepare' },
      { ...panel, url: 'chrome-extension://test-id/panel.html?source=8' },
    ),
  ]);
  assert.deepEqual(Array.from(context.rules.get(3).condition.tabIds), [7, 8]);
  const count = context.calls.filter((call) => call[0] === 'rules').length;
  await context.message({ type: 'prepare' }, panel);
  assert.equal(
    context.calls.filter((call) => call[0] === 'rules').length,
    count,
  );
});

test('browser property ordering does not cause rules to be repeatedly replaced', async () => {
  const context = worker();
  await context.message({ type: 'prepare' }, panel);
  for (const rule of context.rules.values()) {
    rule.condition = Object.fromEntries(
      Object.entries(rule.condition).reverse(),
    );
  }
  const before = context.calls.filter((call) => call[0] === 'rules').length;
  await context.message({ type: 'prepare' }, panel);
  assert.equal(
    context.calls.filter((call) => call[0] === 'rules').length,
    before,
  );
});

test('manifest exposes invocation, local selection and whole-page text commands', async () => {
  const manifest = JSON.parse(
    await readFile(
      new URL('../../extension/manifest.json', import.meta.url),
      'utf8',
    ),
  );
  assert.deepEqual(Object.keys(manifest.commands).sort(), [
    'capture-page',
    'capture-selection',
    'toggle',
  ]);
  assert.equal(manifest.commands.toggle.suggested_key.mac, 'Command+Shift+D');
  assert.equal(manifest.commands['capture-selection'].suggested_key, undefined);
  assert.equal(manifest.commands['capture-page'].suggested_key, undefined);
});
test('capture shortcuts queue the existing actions and open without toggling the panel closed', async () => {
  for (const [command, action] of [
    ['capture-selection', 'pick'],
    ['capture-page', 'page'],
  ]) {
    const context = worker();
    await context.handlers.command(command, {
      id: 7,
      windowId: 3,
      url: 'https://example.com/',
    });
    assert.equal(context.state['capture:7'].action, action);
    assert.equal(context.state['capture:7'].mode, 'floating');
    const show = context.calls.find(
      (call) => call[0] === 'send' && call[2].type === 'show-floating',
    );
    assert.equal(show[2].toggle, false);
  }
});
test('popup capture and shortcut capture use the same queue contract', async () => {
  const context = worker();
  const controls = {
    id: 'test-id',
    url: 'chrome-extension://test-id/controls.html',
  };
  const response = await context.message(
    { type: 'capture-request', tabId: 7, action: 'page', mode: 'fixed' },
    controls,
  );
  assert.equal(response.ok, true);
  assert.equal(context.state['capture:7'].action, 'page');
  assert.equal(context.state['capture:7'].mode, 'fixed');
  assert.ok(context.calls.some((call) => call[0] === 'open'));
});

test('popup opens fixed panels inside the click before settings or worker messages', async () => {
  const source = (
    await readFile(
      new URL('../../extension/controls.js', import.meta.url),
      'utf8',
    )
  ).replace(/^import[\s\S]*?from '[^']+';\s*/gm, '');
  const elements = new Map();
  const element = (key) => {
    if (!elements.has(key))
      elements.set(key, {
        value: '',
        querySelector: () => ({ textContent: '' }),
      });
    return elements.get(key);
  };
  const calls = [];
  let gesture = false;
  const chrome = {
    tabs: { query: async () => [{ id: 7, url: 'https://example.com/' }] },
    storage: {
      local: {
        get: async () => ({ mode: 'fixed', theme: 'system' }),
        set: async () => {
          calls.push('save');
          await Promise.resolve();
        },
      },
    },
    sidePanel: {
      setOptions: async () => {
        calls.push('configure');
      },
      open: async () => {
        assert.equal(gesture, true);
        calls.push('open');
      },
    },
    runtime: {
      sendMessage: async (message) => {
        calls.push(message);
        return { ok: true };
      },
    },
  };
  await vm.runInNewContext(`(async () => { ${source} })()`, {
    chrome,
    document: { querySelector: element },
    window: { addEventListener() {} },
    location: { search: '' },
    URLSearchParams,
    normalizeTheme: (theme) => theme,
    applyAppearance() {},
    saveAppearance: async () => {},
    ...panelOpening,
    setTimeout,
    clearTimeout,
  });
  for (const selector of ['#open', '#select', '#whole', '#mode']) {
    calls.length = 0;
    gesture = true;
    const target = element(selector);
    (selector === '#mode' ? target.onchange : target.onclick)();
    gesture = false;
    await new Promise((resolve) => setImmediate(resolve));
    const opened = calls.indexOf('open');
    const dispatched = calls.findIndex((call) => typeof call === 'object');
    assert.ok(opened >= 0 && dispatched > opened);
    if (selector === '#mode') assert.ok(calls.indexOf('save') > opened);
    assert.equal(calls[dispatched].panelOpened, true);
  }
});

test('popup completion never reopens a side panel from the worker', async () => {
  for (const type of ['show', 'capture-request']) {
    const context = worker();
    const response = await context.message(
      { type, tabId: 7, mode: 'fixed', panelOpened: true, action: 'page' },
      { id: 'test-id', url: 'chrome-extension://test-id/controls.html' },
    );
    assert.equal(response.ok, true);
    assert.equal(
      context.calls.some((call) => call[0] === 'open'),
      false,
    );
    assert.ok(context.calls.some((call) => call[0] === 'rules'));
  }
});
