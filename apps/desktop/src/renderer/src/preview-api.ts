import type { BrowserTabState, ProviderStatus, XgenSideApi } from '../../shared/contracts';

const previewProviders: ProviderStatus[] = [
  {
    id: 'codex',
    label: 'ChatGPT · Codex',
    description: 'ChatGPT 구독으로 공식 Codex CLI를 로컬 실행합니다.',
    installed: true,
    authenticated: true,
    available: true,
    subscriptionAuth: true,
    version: 'codex 1.0.0',
    models: [{ id: 'gpt-5.6-sol', label: '5.6 Sol' }],
  },
  {
    id: 'claude',
    label: 'Claude Code',
    description: 'Claude 구독으로 공식 Claude Code CLI를 로컬 실행합니다.',
    installed: true,
    authenticated: false,
    available: false,
    subscriptionAuth: true,
    version: 'claude 2.1.0',
    models: [{ id: 'sonnet', label: 'Claude Sonnet' }],
    error: 'Claude 로그인이 필요합니다.',
  },
];

const previewWindow = window as unknown as { xgenSide?: XgenSideApi };

if (!previewWindow.xgenSide) {
  let tabs: BrowserTabState[] = [];
  const api: XgenSideApi = {
    engine: { status: async () => ({ available: true, version: 'preview' }) },
    browser: {
      listTabs: async () => tabs,
      newTab: async () => tabs,
      activateTab: async () => tabs,
      closeTab: async () => tabs,
      navigate: async () => tabs,
      back: async () => tabs,
      forward: async () => tabs,
      reload: async () => tabs,
      setLayout: async () => undefined,
      getPageContext: async () => undefined,
      onTabsChanged: () => () => undefined,
    },
    providers: {
      list: async () => previewProviders,
      authenticate: async () => ({ launched: false, message: '데스크톱 앱에서 공식 CLI 로그인을 실행할 수 있습니다.' }),
    },
    agent: {
      run: async () => ({ sessionId: 'preview-session', state: 'completed', answer: 'Preview response', durationMs: 0, logDirectory: 'preview' }),
    },
    skills: {
      route: async (request) => {
        const matchedUrl = request.prompt.match(/https?:\/\/[^\s]+/)?.[0];
        const browserRequired = Boolean(matchedUrl || /브라우저|사이트|페이지.*열|추출|수집|\b(open|navigate|extract|scrape)\b/i.test(request.prompt));
        if (!browserRequired) {
          return {
            id: crypto.randomUUID(),
            reason: 'Conversation Skill이 요청에 가장 적합합니다.',
            browserRequired: false,
            browserActionCategories: [],
            skills: [{ id: 'xgen.chat-answer', settingKey: 'global:chat-answer', name: 'Conversation', description: '브라우저나 외부 도구 없이 요청에 답합니다.', domain: 'Every website', risk: 'read' }],
            steps: [
              { id: 'route', label: 'Select skills', detail: 'Conversation', kind: 'route' },
              { id: 'result', label: 'Return result', detail: 'Save the run trace locally', kind: 'result' },
            ],
          };
        }
        const url = matchedUrl || 'https://example.com';
        let host = 'example.com';
        try { host = new URL(url).hostname; } catch { /* Keep the preview host. */ }
        return {
          id: crypto.randomUUID(),
          reason: `${host} 작업이 필요해 Browser navigation, Structured extraction Skill을 선택했습니다.`,
          browserRequired: true,
          targetUrl: url,
          targetHost: host,
          browserActionCategories: ['navigate', 'snapshot', 'scroll', 'wait', 'read', 'get'],
          skills: [
            { id: 'xgen.browser-navigate', settingKey: 'global:browser-navigation', name: 'Browser navigation', description: '탭을 열고 URL로 이동하며 페이지 상태를 확인합니다.', domain: 'Every website', risk: 'write' },
            { id: 'xgen.data-extract', settingKey: 'global:data-extraction', name: 'Structured extraction', description: '페이지에서 요청한 정보를 구조화합니다.', domain: 'Every website', risk: 'read' },
          ],
          steps: [
            { id: 'route', label: 'Select skills', detail: 'Browser navigation, Structured extraction', kind: 'route' },
            { id: 'browser', label: `Open ${host}`, detail: 'XGEN Browser MCP · guarded local tab', kind: 'browser' },
            { id: 'extract', label: 'Extract requested data', detail: 'Read-only page content with provenance boundaries', kind: 'extract' },
            { id: 'result', label: 'Return result', detail: 'Save the run trace and artifacts locally', kind: 'result' },
          ],
        };
      },
    },
    localData: {
      status: async () => ({ root: 'C:\\Users\\USER\\AppData\\Roaming\\xgen-side\\agent-data', sessionsRoot: 'preview' }),
      open: async () => '',
    },
    settings: {
      load: async () => ({
        schemaVersion: 1,
        general: { guard: true, localLogs: true, compact: false },
        mcpEnabled: { browser: true, xgen: true, filesystem: false },
        skillEnabled: {},
      }),
      save: async (settings) => settings,
    },
    command: {
      run: async () => ({ state: 'denied', decision: 'deny', reason: '브라우저 미리보기에서는 명령을 실행하지 않습니다.' }),
      approve: async () => ({ state: 'denied', decision: 'deny', reason: '브라우저 미리보기에서는 명령을 실행하지 않습니다.' }),
    },
  };
  previewWindow.xgenSide = api;
}
