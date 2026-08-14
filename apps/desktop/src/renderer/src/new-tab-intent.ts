import type { NewTabMode } from './screens/new-tab-surface';

export type NewTabIntent =
  | { kind: 'none' }
  | { kind: 'search'; query: string }
  | { kind: 'ask'; prompt: string };

export function resolveNewTabIntent(mode: NewTabMode, value: string): NewTabIntent {
  const normalized = value.trim();
  if (!normalized) return { kind: 'none' };
  if (mode === 'ask') return { kind: 'ask', prompt: normalized };
  return { kind: 'search', query: normalized };
}
