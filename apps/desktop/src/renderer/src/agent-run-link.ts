import type { BrowserTabState } from '../../shared/contracts';

export interface RunLinkedMessage {
  runId?: string;
  overview?: { runId?: string };
}

export function messagesForAgentTab<T extends RunLinkedMessage>(
  messages: T[],
  tab?: BrowserTabState,
): T[] {
  if (!tab?.agentRunId) return [];
  return messages.filter((message) => message.runId === tab.agentRunId || message.overview?.runId === tab.agentRunId);
}

export function isRunLinkedTab(tab?: BrowserTabState): boolean {
  return Boolean(tab?.agentRunId);
}
