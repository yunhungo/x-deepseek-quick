/**
 * @created 2026-11-11
 * @description 验证原生无障碍提取的内容边界、连接清理与选区优先规则
 * @author yunhungo
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {
  serializeAccessibility,
  captureAccessibility,
  readPageSelection,
} from '../../extension/accessibility.js';
const node = (id, role, name, childIds = [], properties = []) => ({
  nodeId: id,
  role: { value: role },
  name: { value: name },
  childIds,
  properties,
});
const nodes = [
  node('r', 'RootWebArea', 'Title', ['h', 'p', 'e', 'f']),
  node('h', 'heading', 'Article title', ['ht']),
  node('ht', 'StaticText', 'Article title'),
  node('p', 'StaticText', 'Published article content'),
  node('e', 'textbox', 'Draft', ['secret']),
  node('secret', 'StaticText', 'Private draft content'),
  node('f', 'Iframe', 'DSQuick', ['chat']),
  node('chat', 'StaticText', 'Private chat content'),
];
test('AX includes article once and excludes editable content and embedded chat', () => {
  const result = serializeAccessibility(nodes);
  assert.match(result.text, /Published article content/);
  assert.equal(result.text.match(/Article title/g).length, 1);
  assert.doesNotMatch(result.text, /Private/);
  assert.throws(() => serializeAccessibility([]), /没有可读取/);
});
test('AX capture detaches after success, failure and navigation', async () => {
  for (const failure of ['none', 'read', 'navigation', 'attach']) {
    const calls = [];
    const api = {
      tabs: {
        get: async () => ({
          url:
            failure === 'navigation'
              ? 'https://other.example/'
              : 'https://example.com/',
        }),
      },
      debugger: {
        attach: async () => {
          calls.push('attach');
          if (failure === 'attach') throw Error('busy');
        },
        sendCommand: async () => {
          if (failure === 'read') throw Error('read');
          return { nodes };
        },
        detach: async () => {
          calls.push('detach');
        },
      },
    };
    const promise = captureAccessibility(api, {
      id: 1,
      url: 'https://example.com/',
    });
    if (failure === 'none') assert.match((await promise).text, /Chrome 原生/);
    else await assert.rejects(promise);
    assert.equal(calls.includes('detach'), failure !== 'attach');
  }
});
test('selection returns only selected content, excludes drafts and bounds size', () => {
  for (const [text, editable, expected] of [
    ['Chosen words', false, 'Chosen words'],
    ['Draft', true, ''],
  ]) {
    const element = {
      nodeType: 1,
      isContentEditable: editable,
      closest: () => null,
    };
    const result = vm.runInNewContext(`(${readPageSelection.toString()})()`, {
      window: {
        getSelection: () => ({
          isCollapsed: false,
          rangeCount: 1,
          getRangeAt: () => ({
            startContainer: element,
            endContainer: element,
            commonAncestorContainer: element,
          }),
          toString: () => text,
        }),
      },
    });
    assert.equal(result, expected);
  }
});
