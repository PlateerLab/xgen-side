export function normalizeBrowserAddress(input: string): string {
  const value = input.trim();
  if (!value || value === 'about:blank') return 'about:blank';

  try {
    const parsed = new URL(value.includes('://') ? value : `https://${value}`);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.toString();
  } catch {
    // Fall through to search.
  }

  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
}
