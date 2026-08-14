import assert from 'node:assert/strict';
import test from 'node:test';
import type { PersistedChatMessage, SkillRoute } from '../../shared/contracts';
import { messagesForPersistence } from './persisted-chat';

test('preserves attachment and artifact metadata across app restarts', () => {
  const messages: Record<string, PersistedChatMessage[]> = {
    chat: [
      {
        id: 'user',
        role: 'user',
        content: 'edit this',
        attachments: [{ id: 'source', kind: 'pdf', name: 'source.pdf', size: 100 }],
      },
      {
        id: 'assistant',
        role: 'assistant',
        content: 'done',
        artifacts: [{ id: 'result', kind: 'pdf', name: 'result.pdf', relativePath: 'artifacts/result.pdf', sessionId: 'session', size: 120 }],
      },
    ],
  };

  const persisted = messagesForPersistence(messages);
  assert.equal(persisted.chat?.[0]?.attachments?.[0]?.name, 'source.pdf');
  assert.equal(persisted.chat?.[1]?.artifacts?.[0]?.name, 'result.pdf');
});

test('marks an interrupted run as cancelled before persistence', () => {
  const route = { skills: [] } as unknown as SkillRoute;
  const persisted = messagesForPersistence({ chat: [{ id: 'run', role: 'assistant', content: '', overview: { prompt: 'work', route, status: 'running' } }] });
  assert.equal(persisted.chat?.[0]?.overview?.status, 'cancelled');
});
