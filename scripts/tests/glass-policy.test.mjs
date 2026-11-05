// @created 2026-11-03
// @description 验证网站适配器在布局变化时保护内容卡片并保守降级
// @author yunhungo
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const sandbox = { module: { exports: {} } };
runInNewContext(readFileSync(new URL('../../src-tauri/scripts/glass.js', import.meta.url), 'utf8'), sandbox);
const { classifySurface, isComposerBacking, isComposerDecoration, createRefreshScheduler, installImeGuard, install } = sandbox.module.exports;
const shell = { layoutRoot: true, neutral: true, widthRatio: 1, heightRatio: 1 };

test('only a verified layout root can be cleared', () => {
  assert.equal(classifySurface(shell), 'shell');
  assert.equal(classifySurface({ ...shell, layoutRoot: false }), null);
});
test('long messages, code cards and drawers retain surfaces at every width', () => {
  for (const widthRatio of [0.6, 0.85, 1]) {
    for (const protection of ['rounded', 'protected', 'overlay']) {
      assert.equal(classifySurface({ ...shell, widthRatio, [protection]: true }), null);
    }
  }
});
test('unknown colors and narrow layout fragments fail closed', () => {
  assert.equal(classifySurface({ ...shell, neutral: false }), null);
  assert.equal(classifySurface({ ...shell, widthRatio: 0.3 }), null);
});
test('semantic footer uses a readable surface rather than clearing it', () => {
  assert.equal(classifySurface({ ...shell, layoutRoot: false, edge: true, heightRatio: 0.15 }), 'edge');
});

test('unapproved origins never access or mutate the page', () => {
  const document = new Proxy({}, { get() { throw new Error('unexpected DOM access'); } });
  assert.doesNotThrow(() => install({ document,
    __DEEPSEEK_GLASS__: { enabled: true, allowedHosts: ['chat.deepseek.com'] },
    location: { hostname: 'unapproved.example' },
  }));
});

test('verified top toolbar clears its bar without changing button geometry', () => {
  const toolbar = { neutral: true, toolbar: true, widthRatio: 0.9, heightRatio: 0.06 };
  assert.equal(classifySurface(toolbar), 'shell');
  assert.equal(classifySurface({ ...toolbar, toolbar: false }), null);
  assert.equal(classifySurface({ ...toolbar, protected: true }), null);
  assert.equal(classifySurface({ ...toolbar, heightRatio: 0.5 }), null);
});

test('composer backing is limited to the aligned card footprint', () => {
  const frame = { top: 800, width: 600, height: 120 };
  assert.equal(isComposerBacking(frame, { ...frame, height: 144 }), true);
  assert.equal(isComposerBacking(frame, { ...frame, width: 700 }), false);
  assert.equal(isComposerBacking(frame, { ...frame, top: 760 }), false);
  assert.equal(isComposerBacking(frame, { ...frame, height: 300 }), false);
  assert.equal(isComposerBacking(frame, { ...frame, height: 80 }), false);
});

test('only empty noninteractive composer fades are removed across widths', () => {
  for (const width of [360, 600, 1100]) {
    const fade = { content: '\'\'', position: 'absolute', pointerEvents: 'none',
      width: `${width}px`, height: '152px', backgroundImage: 'linear-gradient(white, transparent)', filter: 'none' };
    assert.equal(isComposerDecoration(fade, { width, height: 124 }), true);
    for (const change of [{ content: '"help"' }, { pointerEvents: 'auto' },
      { position: 'static' }, { height: '300px' }, { width: '20px' },
      { backgroundImage: 'none' }]) {
      assert.equal(isComposerDecoration({ ...fade, ...change }, { width, height: 124 }), false);
    }
  }
});

test('adaptation waits until native momentum scrolling is quiet and cancels on disposal', () => {
  let now = 0;
  let id = 0;
  const jobs = new Map();
  const clock = {
    performance: { now: () => now },
    setTimeout(fn, delay) { jobs.set(++id, { at: now + delay, fn }); return id; },
    clearTimeout(key) { jobs.delete(key); },
  };
  function advance(to) {
    while (true) {
      const next = [...jobs].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > to) break;
      now = next[1].at; jobs.delete(next[0]); next[1].fn();
    }
    now = to;
  }
  let refreshes = 0;
  const scheduler = createRefreshScheduler(clock, () => refreshes++);
  scheduler.schedule();
  for (const time of [100, 200, 300, 400, 500]) {
    advance(time); scheduler.onScroll(); scheduler.schedule();
    assert.equal(refreshes, 0);
  }
  advance(659); assert.equal(refreshes, 0);
  advance(660); assert.equal(refreshes, 1);
  scheduler.schedule(); scheduler.dispose(); advance(1000);
  assert.equal(refreshes, 1);
  assert.equal(jobs.size, 0);
});

test('IME confirmation never reaches send handlers but ordinary Enter and native defaults survive', () => {
  const listeners = new Map();
  const window = {
    addEventListener(type, fn, capture) { assert.equal(capture, true); listeners.set(type, fn); },
    removeEventListener(type, fn, capture) {
      assert.equal(capture, true);
      assert.equal(listeners.get(type), fn);
      listeners.delete(type);
    },
  };
  const editor = { closest: () => editor };
  const other = { closest: () => null };
  const dispose = installImeGuard(window);
  function dispatch(type, props = {}) {
    let stopped = false;
    let prevented = false;
    const event = { type, target: editor, key: 'Enter', keyCode: 13, isComposing: false,
      ...props, stopImmediatePropagation() { stopped = true; },
      preventDefault() { prevented = true; } };
    listeners.get(type)?.(event);
    assert.equal(prevented, false, 'native IME confirmation must remain enabled');
    return stopped;
  }
  // Chromium ordering: confirmation arrives while composition is active.
  dispatch('compositionstart');
  assert.equal(dispatch('keydown'), true);
  dispatch('compositionend');
  assert.equal(dispatch('keypress'), true);
  assert.equal(dispatch('keyup'), true);
  assert.equal(dispatch('keydown'), false, 'next intentional Enter must send normally');
  // WebKit ordering: compositionend precedes keydown with keyCode 229.
  dispatch('compositionstart'); dispatch('compositionend');
  assert.equal(dispatch('keydown', { keyCode: 229 }), true);
  assert.equal(dispatch('keyup'), true);
  assert.equal(dispatch('keydown', { shiftKey: true }), false);
  assert.equal(dispatch('keydown', { isComposing: true }), true);
  assert.equal(dispatch('keydown', { key: 'a', keyCode: 229 }), false);
  assert.equal(dispatch('keyup'), false, 'a new key sequence clears the prior confirmation');
  assert.equal(dispatch('keydown', { target: other, keyCode: 229 }), false);
  dispatch('compositionstart'); dispatch('blur');
  assert.equal(dispatch('keydown'), false, 'losing focus clears composition state');
  dispose();
  assert.equal(listeners.size, 0);
});
