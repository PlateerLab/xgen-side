import type { PersistedChatMessage } from '../../shared/contracts';

export function messagesForPersistence(messagesByChat: Record<string, PersistedChatMessage[]>): Record<string, PersistedChatMessage[]> {
  return Object.fromEntries(Object.entries(messagesByChat).map(([chatId, messages]) => [
    chatId,
    messages.map(({ id, role, content, meta, overview, attachments, artifacts }): PersistedChatMessage => ({
      id,
      role,
      content,
      meta,
      overview: overview ? { ...overview, status: overview.status === 'running' ? 'cancelled' : overview.status } : undefined,
      attachments,
      artifacts,
    })),
  ]));
}
