// @created 2026-11-03
// @description 验证网站适配器在布局变化时保护内容卡片并保守降级
// @author yunhungo
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const sandbox = { module: { exports: {} } };
runInNewContext(readFileSync(new URL('../../src-tauri/scripts/glass.js', import.meta.url), 'utf8'), sandbox);
const { classifySurface, isComposerBacking, isComposerDecoration, install } = sandbox.module.exports;
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
