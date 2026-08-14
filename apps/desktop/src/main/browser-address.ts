export function normalizeBrowserAddress(input: string): string {
  const value = input.trim();
  if (!value || value === 'about:blank') return 'about:blank';

  if (isLikelyWebAddress(value)) {
    try {
      const parsed = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.toString();
    } catch {
      // Invalid address-like input falls through to Google Search.
    }
  }

  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
}

function isLikelyWebAddress(value: string): boolean {
  if (/\s/.test(value)) return false;
  if (/^https?:\/\//i.test(value)) return true;
  if (value.includes('@')) return false;

  const [hostValue = ''] = value.split(/[/?#]/, 1);
  const host = hostValue.replace(/:\d+$/, '');
  if (/^localhost$/i.test(host)) return true;
  if (/^\[[0-9a-f:]+\]$/i.test(host)) return true;
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)) return true;
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]+)$/i.test(host);
}
