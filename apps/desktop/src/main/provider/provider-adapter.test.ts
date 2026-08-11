import assert from 'node:assert/strict';
import test from 'node:test';
import { ClaudeCodeAdapter } from './claude-code-adapter';
import { CodexAdapter } from './codex-adapter';
import type { LocalRunStore } from '../storage/local-run-store';

const unusedStore = {} as LocalRunStore;

test('Codex adapter extracts the final agent message from JSONL', () => {
  const adapter = new CodexAdapter(unusedStore);
  const output = [
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'first' } }),
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'final answer' } }),
  ].join('\n');
  assert.equal(adapter.parseAnswer(output), 'final answer');
});

test('Codex adapter normalizes live text and MCP activity events', () => {
  const adapter = new CodexAdapter(unusedStore);
  assert.deepEqual(adapter.parseStreamLine(JSON.stringify({
    type: 'item.started',
    item: { type: 'mcp_tool_call', server: 'xgen_browser', tool: 'navigate' },
  })), [{ type: 'activity', name: 'xgen_browser.navigate', phase: 'started', detail: undefined }]);
  assert.deepEqual(adapter.parseStreamLine(JSON.stringify({
    type: 'item.completed',
    item: { type: 'agent_message', text: 'live answer' },
  })), [{ type: 'text', text: 'live answer', mode: 'replace' }]);
});

test('Claude adapter prefers the final result from stream JSON', () => {
  const adapter = new ClaudeCodeAdapter(unusedStore);
  const output = [
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'draft answer' }] } }),
    JSON.stringify({ type: 'result', result: 'final answer' }),
  ].join('\n');
  assert.equal(adapter.parseAnswer(output), 'final answer');
});

test('Claude adapter falls back to assistant text when no result event is present', () => {
  const adapter = new ClaudeCodeAdapter(unusedStore);
  const output = JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'text', text: 'answer from assistant event' }] },
  });
  assert.equal(adapter.parseAnswer(output), 'answer from assistant event');
});

test('Claude adapter normalizes partial text deltas', () => {
  const adapter = new ClaudeCodeAdapter(unusedStore);
  assert.deepEqual(adapter.parseStreamLine(JSON.stringify({
    type: 'stream_event',
    event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'partial' } },
  })), [{ type: 'text', text: 'partial', mode: 'append' }]);
});
