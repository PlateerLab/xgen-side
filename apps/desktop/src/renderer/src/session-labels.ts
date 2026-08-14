import type { BrowserTabState } from '../../shared/contracts';

export function promptTitle(prompt: string): string {
  const normalized = prompt.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 32) return normalized;
  return `${normalized.slice(0, 31).trimEnd()}…`;
}

export function browserTabTitle(tab: BrowserTabState): string {
  if (tab.url === 'about:blank') return 'New tab';
  try {
    const url = new URL(tab.url);
    const continuedUrl = url.searchParams.get('continue');
    const query = continuedUrl ? new URL(continuedUrl).searchParams.get('q') : url.searchParams.get('q');
    if (query && url.hostname.includes('google.')) return query;
    if (!tab.title || tab.title === tab.url || tab.title.startsWith('http')) return url.hostname.replace(/^www\./, '');
  } catch {
    // Use the browser-provided title below when the URL is not parseable.
  }
  return tab.title || 'New tab';
}
