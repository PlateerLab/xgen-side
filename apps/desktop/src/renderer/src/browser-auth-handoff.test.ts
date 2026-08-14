import assert from 'node:assert/strict';
import test from 'node:test';
import type { AgentRunEvent, BrowserTabState, SkillRoute } from '../../shared/contracts';
import { isAuthenticationTab, shouldRevealAgentBrowser } from './browser-auth-handoff';

const loginRoute: SkillRoute = {
  id: 'login-route',
  resolvedMode: 'browser-agent',
  reason: 'Login requires the visible browser.',
  browserVisible: true,
  agentBrowserRequired: true,
  browserActionCategories: ['navigate'],
  skills: [{
    id: 'xgen.login-assistant',
    settingKey: 'global:login-assistant',
    name: 'Login Assistant',
    description: 'Secure login',
    domain: 'Visible browser',
    risk: 'consequential',
    runtime: { kind: 'agent-browser', capability: 'secure-browser-authentication', tools: [] },
    permissions: { risk: 'consequential', allowActions: [], confirmActions: [], denyActions: [] },
    progress: { label: 'Secure login', detail: 'Waits for device verification' },
  }],
  steps: [],
};

test('reveals the run-owned browser when a login route attaches its tab', () => {
  const event: AgentRunEvent = {
    type: 'browser-tab-attached',
    sessionId: 'session-1',
    at: '2026-08-14T00:00:00Z',
    tab: {
      id: 'tab-1', title: 'Agent browser', url: 'about:blank', active: true, loading: true,
      canGoBack: false, canGoForward: false, owner: 'agent', agentRunId: 'run-1', agentStatus: 'running',
    },
  };

  assert.equal(shouldRevealAgentBrowser(loginRoute, event), true);
  assert.equal(shouldRevealAgentBrowser({ ...loginRoute, skills: [] }, event), false);
});

test('shows an interaction handoff only for an agent-owned authentication page', () => {
  const tab: BrowserTabState = {
    id: 'tab-1', title: 'NAVER 로그인', url: 'https://nid.naver.com/nidlogin.login', active: true, loading: false,
    canGoBack: true, canGoForward: false, owner: 'agent', agentRunId: 'run-1', agentStatus: 'running',
  };

  assert.equal(isAuthenticationTab(tab), true);
  assert.equal(isAuthenticationTab({ ...tab, agentRunId: undefined }), false);
  assert.equal(isAuthenticationTab({ ...tab, url: 'https://www.naver.com/' }), false);
});
