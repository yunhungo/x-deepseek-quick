/**
 * @created 2026-11-11
 * @description 验证选区优先提取会排除可编辑草稿
 * @author yunhungo
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readPageSelection } from '../../extension/page-selection.js';
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
