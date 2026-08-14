import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveNewTabIntent } from './new-tab-intent';

test('routes Search input to the active browser tab', () => {
  assert.deepEqual(resolveNewTabIntent('search', '  OpenAI Codex  '), { kind: 'search', query: 'OpenAI Codex' });
});

test('routes Ask AI input to a new chat prompt', () => {
  assert.deepEqual(resolveNewTabIntent('ask', '  현재 페이지를 설명해줘  '), { kind: 'ask', prompt: '현재 페이지를 설명해줘' });
});

test('ignores blank new-tab input', () => {
  assert.deepEqual(resolveNewTabIntent('search', '   '), { kind: 'none' });
});
