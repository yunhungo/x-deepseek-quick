// @created 2026-11-03
// @description 验证网站适配器在布局变化时保护内容卡片并保守降级
// @author yunhungo
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const sandbox = { module: { exports: {} } };
runInNewContext(readFileSync(new URL('../../src-tauri/scripts/glass.js', import.meta.url), 'utf8'), sandbox);
const { classifySurface, install } = sandbox.module.exports;
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
