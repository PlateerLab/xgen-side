interface CdpTarget {
  type?: string;
  url?: string;
}

export function selectBrowserCdpEndpoint(
  cdpPort: number,
  activeUrl: string,
  targets: CdpTarget[],
): string | undefined {
  const exact = targets.some((target) => target.type === 'page' && target.url === activeUrl);
  const fallback = targets.some((target) => target.type === 'page' && target.url && !target.url.startsWith('http://localhost:'));
  // agent-browser must connect at browser scope to discover and switch tabs.
  // A /devtools/page/* endpoint cannot service Target.* lifecycle commands.
  return exact || fallback ? String(cdpPort) : undefined;
}
