import assert from 'node:assert/strict';
import test from 'node:test';
import type { BrowserTabState } from '../../shared/contracts';
import { chatIdForAgentTab, isRunLinkedTab, messagesForAgentTab } from './agent-run-link';

function tab(agentRunId?: string): BrowserTabState {
  return {
    id: 'tab-a',
    title: 'Agent browser',
    url: 'about:blank',
    active: true,
    loading: false,
    canGoBack: false,
    canGoForward: false,
    owner: agentRunId ? 'agent' : 'user',
    agentRunId,
  };
}

test('selects the same run messages for a linked Agent browser tab', () => {
  const overview = { id: 'overview', overview: { runId: 'run-1' } };
  const answer = { id: 'answer', runId: 'run-1' };
  const unrelated = { id: 'other', runId: 'run-2' };
  const selected = messagesForAgentTab([overview, answer, unrelated], tab('run-1'));
  assert.deepEqual(selected, [overview, answer]);
});

test('does not associate ordinary browser tabs with an Agent Run', () => {
  assert.equal(isRunLinkedTab(tab()), false);
  assert.deepEqual(messagesForAgentTab([{ id: 'answer', runId: 'run-1' }], tab()), []);
});

test('keeps renderer run identity separate from provider session identity', () => {
  const message = { id: 'overview', overview: { runId: 'renderer-1' }, sessionId: 'session-99' };
  assert.deepEqual(messagesForAgentTab([message], tab('renderer-1')), [message]);
  assert.deepEqual(messagesForAgentTab([message], tab('session-99')), []);
});

test('finds the owning chat before a linked Agent tab accepts a follow-up', () => {
  assert.equal(chatIdForAgentTab({
    'chat-a': [{ runId: 'run-a' }],
    'chat-b': [{ overview: { runId: 'run-b' } }],
  }, tab('run-b')), 'chat-b');
  assert.equal(chatIdForAgentTab({ 'chat-a': [{ runId: 'run-a' }] }, tab('missing')), undefined);
});
