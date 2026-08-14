import type { AgentRunEvent, BrowserTabState, SkillRoute } from '../../shared/contracts';

export function shouldRevealAgentBrowser(route: SkillRoute, event: AgentRunEvent): event is Extract<AgentRunEvent, { type: 'browser-tab-attached' }> {
  return event.type === 'browser-tab-attached'
    && route.skills.some((skill) => skill.id === 'xgen.login-assistant');
}

export function isAuthenticationTab(tab?: BrowserTabState): boolean {
  if (!tab?.agentRunId || tab.url === 'about:blank') return false;
  return /(?:login|signin|auth|passkey|webauthn|qrcode|nid\.naver\.com)/i.test(tab.url);
}
