/**
 * @created 2026-11-11
 * @description 验证悬浮窗默认布局、尺寸记忆和标题栏恢复操作
 * @author yunhungo
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(
  new URL('../../extension/source.js', import.meta.url),
  'utf8',
);
function layout({ saved, deferred = false, visual } = {}) {
  const viewport = { width: 1200, height: 800 };
  const listeners = new Map();
  const timers = new Map();
  const writes = [];
  let nextTimer = 0;
  let receive;
  let resize;
  let resolveSettings;
  const settings = deferred
    ? new Promise((resolve) => {
        resolveSettings = resolve;
      })
    : Promise.resolve({ floatingBounds: saved });
  class Element {
    style = {
      setProperty(key, value) {
        this[key] = value;
      },
      removeProperty(key) {
        delete this[key];
      },
    };
    dataset = {};
    children = [];
    append(...nodes) {
      this.children.push(...nodes);
    }
    attachShadow() {
      return (this.shadow = new Element());
    }
    getAttribute(key) {
      return this[key] || null;
    }
    remove() {}
    getBoundingClientRect() {
      return {
        left:
          Number.parseFloat(
            this.style.left ?? this.style['--dsq-viewport-left'],
          ) || 0,
        top:
          Number.parseFloat(
            this.style.top ?? this.style['--dsq-viewport-top'],
          ) || 0,
        width: Math.min(
          Number.parseFloat(this.style.width) || 460,
          Number.parseFloat(this.style['--dsq-viewport-width']) ||
            viewport.width,
        ),
        height: Math.min(
          Number.parseFloat(this.style.height) ||
            Number.parseFloat(this.style['--dsq-viewport-height']) ||
            viewport.height,
          Number.parseFloat(this.style['--dsq-viewport-height']) ||
            viewport.height,
        ),
      };
    }
  }
  const root = new Element();
  const context = {
    window: {
      addEventListener(type, handler) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(handler);
      },
      removeEventListener(type, handler) {
        listeners.get(type)?.delete(handler);
      },
    },
    document: {
      documentElement: root,
      createElement: () => new Element(),
      hasFocus: () => true,
    },
    innerWidth: viewport.width,
    innerHeight: viewport.height,
    ResizeObserver: class {
      constructor(callback) {
        resize = callback;
      }
      observe() {}
    },
    chrome: {
      storage: {
        local: {
          get: () => settings,
          set: async (value) => {
            writes.push(value);
          },
        },
      },
      runtime: {
        id: 'test-id',
        getURL: (value) => `chrome-extension://test-id/${value}`,
        onMessage: {
          addListener: (handler) => {
            receive = handler;
          },
        },
      },
    },
    setTimeout(callback) {
      const id = ++nextTimer;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    cancelAnimationFrame() {},
  };
  const visualListeners = new Map();
  if (visual)
    context.window.visualViewport = {
      ...visual,
      addEventListener(type, callback) {
        visualListeners.set(type, callback);
      },
    };
  vm.createContext(context);
  vm.runInContext(source, context);
  const box = root.children[0].shadow.children.find(
    (node) => node.className === 'floating',
  );
  return {
    box,
    writes,
    beginResize() {
      const bounds = box.getBoundingClientRect();
      const event = {
        target: root.children[0],
        button: 0,
        clientX: bounds.left + bounds.width - 2,
        clientY: bounds.top + bounds.height - 2,
      };
      for (const callback of listeners.get('pointerdown') || [])
        callback(event);
    },
    endResize() {
      for (const callback of listeners.get('pointerup') || []) callback({});
    },
    resizeVisualViewport(values) {
      Object.assign(context.window.visualViewport, values);
      visualListeners.get('resize')();
      resize();
    },
    message(type, extra = {}) {
      return new Promise((reply) =>
        receive({ type, ...extra }, { id: 'test-id' }, reply),
      );
    },
    loadSettings() {
      resolveSettings({ floatingBounds: saved });
    },
    observeResize() {
      resize();
    },
    flush() {
      const callbacks = [...timers.values()];
      timers.clear();
      callbacks.forEach((callback) => callback());
    },
    resizeViewport(width, height) {
      viewport.width = context.innerWidth = width;
      viewport.height = context.innerHeight = height;
      for (const callback of listeners.get('resize') || []) callback();
      resize();
    },
  };
}

test('default layout remains full-height as the viewport changes instead of storing a frozen size', async () => {
  const state = layout();
  await state.message('show-floating');
  state.observeResize();
  state.flush();
  assert.equal(state.writes.at(-1).floatingBounds, null);
  state.resizeViewport(240, 200);
  state.flush();
  assert.deepEqual(state.box.getBoundingClientRect(), {
    left: 0,
    top: 0,
    width: 240,
    height: 200,
  });
  assert.equal(state.writes.at(-1).floatingBounds, null);
});

test('saved custom dimensions fit the current viewport without leaving the title bar offscreen', async () => {
  const state = layout({
    saved: { version: 2, left: 1100, top: 750, width: 600, height: 500 },
  });
  await state.message('show-floating');
  assert.deepEqual(state.box.getBoundingClientRect(), {
    left: 600,
    top: 300,
    width: 600,
    height: 500,
  });
  await state.message('hide-floating');
  state.resizeViewport(320, 240);
  state.flush();
  await state.message('show-floating');
  assert.deepEqual(state.box.getBoundingClientRect(), {
    left: 0,
    top: 0,
    width: 320,
    height: 240,
  });
});

test('reset clears custom geometry, persists default mode, and survives a late settings response', async () => {
  const state = layout({
    saved: { version: 2, left: 80, top: 90, width: 600, height: 500 },
    deferred: true,
  });
  await state.message('show-floating');
  Object.assign(state.box.style, {
    left: '80px',
    top: '90px',
    width: '600px',
    height: '500px',
  });
  await state.message('reset-floating');
  state.loadSettings();
  await Promise.resolve();
  assert.deepEqual(state.box.getBoundingClientRect(), {
    left: 0,
    top: 0,
    width: 460,
    height: 800,
  });
  assert.equal(state.writes.at(-1).floatingBounds, null);
  state.resizeViewport(1500, 1000);
  state.flush();
  assert.equal(state.box.getBoundingClientRect().height, 1000);
  assert.equal(state.writes.at(-1).floatingBounds, null);
});

test('manual resize still saves custom dimensions after returning to default mode', async () => {
  const state = layout();
  await state.message('show-floating');
  await state.message('reset-floating');
  state.beginResize();
  Object.assign(state.box.style, { width: '640px', height: '500px' });
  state.observeResize();
  state.flush();
  state.endResize();
  const saved = state.writes.at(-1).floatingBounds;
  assert.equal(saved.version, 2);
  assert.equal(saved.width, 640);
  assert.equal(saved.height, 500);
});

test('title-bar double-click restores only a floating panel and leaves toolbar buttons alone', async () => {
  const panel = await readFile(
    new URL('../../extension/panel.js', import.meta.url),
    'utf8',
  );
  const start = panel.indexOf("toolbar.addEventListener('dblclick'");
  const end = panel.indexOf("toolbar.addEventListener('pointerdown'", start);
  const handlerSource = panel.slice(start, end);
  for (const floating of [true, false]) {
    let handler;
    const requests = [];
    vm.runInNewContext(`let pointer; ${handlerSource}`, {
      floating,
      toolbar: {
        addEventListener(_type, callback) {
          handler = callback;
        },
      },
      act: (callback) => callback(),
      request: (type) => requests.push(type),
    });
    let prevented = false;
    handler({
      target: { closest: () => ({}) },
      preventDefault() {
        prevented = true;
      },
    });
    assert.equal(requests.length, 0);
    handler({
      target: { closest: () => null },
      preventDefault() {
        prevented = true;
      },
    });
    assert.equal(requests.length, floating ? 1 : 0);
    if (floating) assert.equal(requests[0], 'reset-floating');
    assert.equal(prevented, floating);
  }
});

test('legacy automatic rectangles cannot override the full-height default', async () => {
  const state = layout({
    saved: { left: 80, top: 72, width: 600, height: 700 },
  });
  await state.message('show-floating');
  assert.deepEqual(state.box.getBoundingClientRect(), {
    left: 0,
    top: 0,
    width: 460,
    height: 800,
  });
  assert.equal(state.writes.at(-1).floatingBounds, null);
});

test('default bottom follows visual viewport changes even when layout viewport is taller', async () => {
  const state = layout({
    visual: { width: 1100, height: 640, offsetLeft: 0, offsetTop: 20 },
  });
  await state.message('show-floating');
  let bounds = state.box.getBoundingClientRect();
  assert.equal(bounds.top + bounds.height, 660);
  state.resizeVisualViewport({ height: 550, offsetTop: 0 });
  state.flush();
  bounds = state.box.getBoundingClientRect();
  assert.equal(bounds.top + bounds.height, 550);
  assert.equal(state.writes.at(-1).floatingBounds, null);
});

test('automatic resize observations do not turn default mode into a frozen custom height', async () => {
  const state = layout();
  await state.message('show-floating');
  const original = state.box.getBoundingClientRect.bind(state.box);
  state.box.getBoundingClientRect = () => ({ ...original(), height: 780 });
  state.observeResize();
  state.flush();
  assert.equal(state.writes.at(-1).floatingBounds, null);
  state.box.getBoundingClientRect = original;
  state.resizeViewport(1200, 900);
  state.flush();
  assert.equal(state.box.getBoundingClientRect().height, 900);
  assert.equal(state.writes.at(-1).floatingBounds, null);
});
