import type { BrowserTabState, ProviderStatus, RoutedSkill, SkillCatalogEntry, XgenSideApi } from '../../shared/contracts';

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
    supportsReasoningEffort: true,
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

function previewRoutedSkill(id: string, settingKey: string, name: string, description: string, risk: RoutedSkill['risk'], kind: RoutedSkill['runtime']['kind']): RoutedSkill {
  return {
    id,
    settingKey,
    name,
    description,
    domain: kind === 'agent-browser' ? 'Visible XGEN browser' : 'Every request',
    risk,
    runtime: { kind, capability: id, toolProfiles: kind === 'agent-browser' ? ['core', 'tabs'] : undefined, tools: [] },
    permissions: { risk, allowActions: [], confirmActions: [], denyActions: [] },
    progress: { label: name, detail: description },
  };
}

function previewCatalogEntry(
  id: string,
  name: string,
  description: string,
  category: string,
  domain: string,
  kind: SkillCatalogEntry['runtime']['kind'],
  risk: SkillCatalogEntry['permissions']['risk'],
): SkillCatalogEntry {
  const folder = id.replace('.', '-');
  return {
    id,
    settingKey: `global:${id.replace('xgen.', '')}`,
    name,
    description,
    category,
    domain,
    enabledByDefault: true,
    source: `${folder}/SKILL.md`,
    markdown: `---\nname: ${folder}\ndescription: ${description}\n---\n\n# ${name}\n\n${description}\n\n## Runtime\n\n- Kind: \`${kind}\`\n- Risk: \`${risk}\`\n`,
    runtime: { kind, capability: id, toolProfiles: kind === 'agent-browser' ? ['core', 'tabs'] : undefined, tools: [] },
    permissions: { risk, allowActions: [], confirmActions: [], denyActions: [] },
    progress: { label: name, detail: description },
  };
}

const previewCatalog: SkillCatalogEntry[] = [
  previewCatalogEntry('xgen.conversation', 'Conversation', 'Answer without web or browser tools.', 'Core', 'Every request', 'llm', 'read'),
  previewCatalogEntry('xgen.web-research', 'Web Research', 'Research current information with cited sources.', 'Research', 'Public web', 'provider-web', 'read'),
  previewCatalogEntry('xgen.multi-page-research', 'Multi-page Research', 'Compare independent sources with a bounded source ledger.', 'Research', 'Public web', 'provider-web', 'read'),
  previewCatalogEntry('xgen.page-reader', 'Page Reader', 'Read and answer from the attached page.', 'Research', 'Active browser page', 'page-context', 'read'),
  previewCatalogEntry('xgen.browser-navigation', 'Browser Navigation', 'Open pages and navigate browser tabs safely.', 'Browser', 'Visible XGEN browser', 'agent-browser', 'write'),
  previewCatalogEntry('xgen.browser-interaction', 'Browser Interaction', 'Click, type, and select visible controls.', 'Browser', 'Visible XGEN browser', 'agent-browser', 'write'),
  previewCatalogEntry('xgen.structured-extraction', 'Structured Extraction', 'Extract structured data with provenance.', 'Research', 'Attached or visible browser page', 'agent-browser', 'read'),
  previewCatalogEntry('xgen.form-guard', 'Form Guard', 'Guard consequential browser form actions.', 'Safety', 'Consequential browser actions', 'policy', 'consequential'),
];

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
      start: (request, listener) => {
        const id = crypto.randomUUID();
        const sessionId = 'preview-session';
        const at = new Date().toISOString();
        listener?.({ type: 'run-started', sessionId, at });
        listener?.({ type: 'provider-started', sessionId, at, providerId: request.providerId, model: request.model, sandbox: 'preview' });
        listener?.({ type: 'text', sessionId, at, text: 'Preview response', mode: 'replace' });
        listener?.({ type: 'run-finished', sessionId, at, state: 'completed', durationMs: 0 });
        return {
          id,
          result: Promise.resolve({ sessionId, state: 'completed', answer: 'Preview response', durationMs: 0, logDirectory: 'preview' }),
          cancel: async () => false,
        };
      },
    },
    skills: {
      list: async () => previewCatalog,
      route: async (request) => {
        const matchedUrl = request.prompt.match(/https?:\/\/[^\s]+/)?.[0];
        const resolvedMode = request.mode === 'auto'
          ? (/latest|today|search|find|최신|오늘|검색|찾아/i.test(request.prompt) ? 'search' : 'chat')
          : request.mode;
        const browserVisible = resolvedMode === 'search' || resolvedMode === 'browser-agent';
        if (!browserVisible) {
          return {
            id: crypto.randomUUID(),
            resolvedMode: resolvedMode === 'page' ? 'page' : 'chat',
            reason: 'Conversation Skill이 요청에 가장 적합합니다.',
            browserVisible: false,
            agentBrowserRequired: false,
            browserActionCategories: [],
            skills: [previewRoutedSkill('xgen.conversation', 'global:conversation', 'Conversation', '브라우저나 외부 도구 없이 요청에 답합니다.', 'read', 'llm')],
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
          resolvedMode: resolvedMode === 'search' ? 'search' : 'browser-agent',
          reason: `${host} 작업이 필요해 Browser navigation, Structured extraction Skill을 선택했습니다.`,
          browserVisible: true,
          agentBrowserRequired: resolvedMode !== 'search',
          targetUrl: url,
          targetHost: host,
          browserActionCategories: ['navigate', 'snapshot', 'scroll', 'wait', 'read', 'get'],
          skills: [
            previewRoutedSkill('xgen.browser-navigation', 'global:browser-navigation', 'Browser navigation', '탭을 열고 URL로 이동하며 페이지 상태를 확인합니다.', 'write', 'agent-browser'),
            previewRoutedSkill('xgen.structured-extraction', 'global:structured-extraction', 'Structured extraction', '페이지에서 요청한 정보를 구조화합니다.', 'read', 'agent-browser'),
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
      status: async () => ({ root: 'C:\\Users\\USER\\AppData\\Roaming\\xgen-side\\agent-data', sessionsRoot: 'preview', memoryRoot: 'preview\\memory' }),
      open: async () => '',
      listMarkdown: async () => [{ id: 'MEMORY.md', name: 'MEMORY.md', relativePath: 'MEMORY.md', category: 'root', updatedAt: new Date().toISOString(), size: 180 }],
      readMarkdown: async () => '# Browser Agent Memory\n\nBrowser history and task results appear here.',
      writeMarkdown: async () => undefined,
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
