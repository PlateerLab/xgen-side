import {
  Add24Regular,
  ArrowClockwise24Regular,
  ArrowLeft24Regular,
  ArrowRight24Regular,
  Attach24Regular,
  BotSparkle24Filled,
  Chat24Filled,
  Chat24Regular,
  CheckmarkCircle24Regular,
  ChevronDown24Regular,
  ChevronRight24Regular,
  Circle24Regular,
  Database24Regular,
  Dismiss24Regular,
  Document24Regular,
  Globe24Regular,
  History24Regular,
  Mic24Regular,
  Open24Regular,
  PanelLeftContract24Regular,
  PanelLeftExpand24Regular,
  PanelRightContract24Regular,
  PlugConnected24Regular,
  PuzzlePiece24Regular,
  Search24Regular,
  Settings24Regular,
  ShieldLock24Regular,
  Sparkle24Filled,
  TabDesktop24Regular,
  WeatherMoon24Regular,
  WeatherSunny24Regular,
  Window24Regular,
} from '@fluentui/react-icons';
import { type FormEvent, type KeyboardEvent, type ReactElement, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
  AgentMode,
  AgentRunEvent,
  AgentRunHandle,
  AppSettings,
  BrowserSnapshot,
  BrowserTabState,
  EngineStatus,
  LocalDataStatus,
  LocalMarkdownFile,
  ProviderId,
  ProviderStatus,
  ReasoningEffort,
  SkillCatalogEntry,
  SkillRoute,
} from '../../shared/contracts';

type Theme = 'light' | 'dark';
type Surface = 'home' | 'browser' | 'settings';
type SettingsSection = 'general' | 'providers' | 'mcp' | 'skills' | 'data';

interface SkillDefinition extends SkillCatalogEntry {
  enabled: boolean;
}

interface SkillDomain {
  id: string;
  label: string;
  host: string;
  accent: string;
  expanded: boolean;
  skills: SkillDefinition[];
}

interface ChatSession {
  id: string;
  title: string;
  time: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  meta?: string;
  overview?: {
    route: SkillRoute;
    status: 'running' | 'completed' | 'failed' | 'cancelled';
    prompt: string;
    activity?: string;
    snapshots?: BrowserSnapshot[];
  };
}

const initialChats: ChatSession[] = [
  { id: 'chat-1', title: '새로운 AI 브라우저 구조 정리', time: '방금' },
  { id: 'chat-2', title: '고속도로 교통 상황 요약', time: '오전 9:18' },
  { id: 'chat-3', title: '문서 비교와 핵심 차이', time: '어제' },
  { id: 'chat-4', title: 'Windows 자동화 계획', time: '5월 30일' },
];

const homeModes: Array<{ id: AgentMode; label: string }> = [
  { id: 'auto', label: 'Auto' },
  { id: 'chat', label: 'No web' },
  { id: 'search', label: 'Research' },
  { id: 'browser-agent', label: 'Browser work' },
];

const pageModes: Array<{ id: AgentMode; label: string }> = [
  { id: 'auto', label: 'Auto' },
  { id: 'page', label: 'Ask page' },
  { id: 'search', label: 'Research' },
  { id: 'browser-agent', label: 'Browser agent' },
];

const reasoningOptions: Array<{ id: ReasoningEffort; label: string }> = [
  { id: 'auto', label: 'Reasoning: Auto' },
  { id: 'low', label: 'Fast' },
  { id: 'medium', label: 'Balanced' },
  { id: 'high', label: 'Deep' },
  { id: 'xhigh', label: 'Very Deep' },
];

const initialPreferences: AppSettings['general'] = { guard: true, localLogs: true, compact: false };

const mcpDefinitions: McpDefinition[] = [
  { id: 'browser', name: 'XGEN Browser', command: 'agent-browser mcp --tools core,tabs', transport: 'stdio', tools: ['tabs', 'open', 'snapshot', 'click', 'fill', 'read'], permissions: ['Loopback CDP only', 'Session action policy', 'No upload or download'], status: 'Connected' },
  { id: 'xgen', name: 'XGEN Tools', command: 'xgen tools mcp --scope local', transport: 'stdio', tools: ['task_status', 'local_artifacts'], permissions: ['Local workspace only', 'Redacted run metadata'], status: 'Connected' },
  { id: 'filesystem', name: 'Local Files', command: 'filesystem --roots selected', transport: 'stdio', tools: ['read_file', 'list_directory'], permissions: ['Selected roots only', 'Writes require approval'], status: 'Needs scope' },
];

function groupSkillCatalog(catalog: SkillCatalogEntry[], enabled: Record<string, boolean>): SkillDomain[] {
  const accents: Record<string, string> = { Core: '#305eeb', Research: '#0f766e', Browser: '#7c3aed', Safety: '#b45309' };
  const categories = new Map<string, SkillDomain>();
  for (const skill of catalog) {
    const id = skill.category.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-');
    const current = categories.get(id) ?? {
      id,
      label: skill.category,
      host: skill.domain,
      accent: accents[skill.category] ?? '#305eeb',
      expanded: true,
      skills: [],
    };
    if (!current.host.split(' · ').includes(skill.domain)) current.host = `${current.host} · ${skill.domain}`;
    current.skills.push({ ...skill, enabled: enabled[skill.settingKey] ?? skill.enabledByDefault });
    categories.set(id, current);
  }
  return [...categories.values()];
}

export function App(): ReactElement {
  const [tabs, setTabs] = useState<BrowserTabState[]>([]);
  const [surface, setSurface] = useState<Surface>('home');
  const [theme, setTheme] = useState<Theme>('light');
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(false);
  const [address, setAddress] = useState('');
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [authenticatingProviderId, setAuthenticatingProviderId] = useState<ProviderId | null>(null);
  const [providerId, setProviderId] = useState<ProviderId>('codex');
  const [model, setModel] = useState('gpt-5.6-sol');
  const [homeMode, setHomeMode] = useState<AgentMode>('auto');
  const [pageMode, setPageMode] = useState<AgentMode>('auto');
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>('auto');
  const [homePrompt, setHomePrompt] = useState('');
  const [pagePrompt, setPagePrompt] = useState('');
  const [homeBusy, setHomeBusy] = useState(false);
  const [pageBusy, setPageBusy] = useState(false);
  const [homeMessages, setHomeMessages] = useState<ChatMessage[]>([]);
  const [pageMessages, setPageMessages] = useState<ChatMessage[]>([
    {
      id: 'page-answer-1',
      role: 'assistant',
      content: '현재 탭을 첨부해 페이지에 질문하거나, Browser agent로 실제 브라우저 작업을 실행할 수 있습니다.',
    },
  ]);
  const [chats, setChats] = useState(initialChats);
  const [activeChatId, setActiveChatId] = useState('chat-1');
  const [engine, setEngine] = useState<EngineStatus>();
  const [localData, setLocalData] = useState<LocalDataStatus>();
  const [settingsMessage, setSettingsMessage] = useState('');
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('general');
  const [settingsSearch, setSettingsSearch] = useState('');
  const [skillSearch, setSkillSearch] = useState('');
  const [skillDomains, setSkillDomains] = useState<SkillDomain[]>([]);
  const [mcpEnabled, setMcpEnabled] = useState<Record<string, boolean>>({ browser: true, xgen: true, filesystem: false });
  const [preferences, setPreferences] = useState(initialPreferences);
  const [settingsReady, setSettingsReady] = useState(false);
  const homeRunRef = useRef<AgentRunHandle | null>(null);
  const pageRunRef = useRef<AgentRunHandle | null>(null);
  const activeTab = useMemo(() => tabs.find((tab) => tab.active), [tabs]);
  const selectedProvider = providers.find((provider) => provider.id === providerId);
  const homeOverview = [...homeMessages].reverse().find((message) => message.overview)?.overview;
  const leftWidth = leftOpen ? 300 : 0;
  const homeSnapshotVisible = surface === 'home' && Boolean(homeOverview?.route.browserVisible);
  const homeDockWidth = homeSnapshotVisible ? 540 : 0;
  const rightWidth = surface === 'browser' && rightOpen ? 372 : 0;

  useEffect(() => {
    void window.xgenSide.browser.listTabs().then(setTabs);
    void window.xgenSide.engine.status().then(setEngine);
    void refreshProviders();
    void window.xgenSide.localData.status().then(setLocalData);
    void Promise.all([window.xgenSide.settings.load(), window.xgenSide.skills.list()]).then(([saved, catalog]) => {
      setPreferences(saved.general);
      setMcpEnabled(saved.mcpEnabled);
      setSkillDomains(groupSkillCatalog(catalog, saved.skillEnabled));
      setSettingsReady(true);
    }).catch(() => undefined);
    return window.xgenSide.browser.onTabsChanged(setTabs);
  }, []);

  useEffect(() => {
    if (!settingsReady) return;
    const skillEnabled = Object.fromEntries(skillDomains.flatMap((domain) => domain.skills.map((skill) => [skill.settingKey, skill.enabled])));
    const timer = window.setTimeout(() => {
      void window.xgenSide.settings.save({ schemaVersion: 1, general: preferences, mcpEnabled, skillEnabled });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [mcpEnabled, preferences, settingsReady, skillDomains]);

  useEffect(() => setAddress(activeTab?.url ?? ''), [activeTab?.url]);

  useEffect(() => {
    void window.xgenSide.browser.setLayout({
      visible: surface === 'browser',
      leftWidth,
      rightWidth,
      chromeHeight: 76,
      placement: 'workspace',
      dockInset: 10,
    });
  }, [leftWidth, rightWidth, surface]);

  useEffect(() => {
    if (!authenticatingProviderId) return;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async (): Promise<void> => {
      try {
        const next = await refreshProviders();
        if (cancelled) return;
        const connected = next.find((provider) => provider.id === authenticatingProviderId && provider.authenticated);
        if (connected) {
          setSettingsMessage(`${connected.label} 연결이 완료되었습니다.`);
          setAuthenticatingProviderId(null);
          return;
        }
      } catch {
        // A transient status failure should not interrupt login completion polling.
      }
      if (!cancelled) timer = window.setTimeout(() => void poll(), 2_000);
    };
    timer = window.setTimeout(() => void poll(), 750);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [authenticatingProviderId]);

  async function refreshProviders(): Promise<ProviderStatus[]> {
    const next = await window.xgenSide.providers.list();
    setProviders(next);
    const current = next.find((provider) => provider.id === providerId) ?? next[0];
    if (current) {
      setProviderId(current.id);
      setModel((value) => current.models.some((item) => item.id === value) ? value : (current.models[0]?.id ?? ''));
    }
    return next;
  }

  function changeProvider(nextId: ProviderId): void {
    const next = providers.find((provider) => provider.id === nextId);
    setProviderId(nextId);
    setModel(next?.models[0]?.id ?? '');
  }

  function createChat(): void {
    const id = crypto.randomUUID();
    setChats((current) => [{ id, title: '새 대화', time: '방금' }, ...current]);
    setActiveChatId(id);
    setHomeMessages([]);
    setSurface('home');
    setRightOpen(false);
  }

  async function createBrowserTab(): Promise<void> {
    setTabs(await window.xgenSide.browser.newTab());
    setSurface('browser');
    setRightOpen(false);
  }

  async function openBrowserTab(id: string): Promise<void> {
    setTabs(await window.xgenSide.browser.activateTab(id));
    setSurface('browser');
  }

  async function closeBrowserTab(id: string): Promise<void> {
    const nextTabs = await window.xgenSide.browser.closeTab(id);
    setTabs(nextTabs);
    if (nextTabs.length === 0) setSurface('home');
  }

  async function navigate(event: FormEvent): Promise<void> {
    event.preventDefault();
    setTabs(await window.xgenSide.browser.navigate(address));
  }

  async function sendHomeMessage(event: FormEvent): Promise<void> {
    event.preventDefault();
    const value = homePrompt.trim();
    if (!value || homeBusy) return;
    setHomeMessages((current) => [...current, { id: crypto.randomUUID(), role: 'user', content: value }]);
    setHomePrompt('');
    setHomeBusy(true);
    const request = {
      providerId,
      model,
      mode: homeMode,
      reasoningEffort,
      prompt: value,
      history: homeMessages.filter((message) => !message.overview).map(({ role, content }) => ({ role, content })),
    };
    let overviewId: string | undefined;
    const responseId = crypto.randomUUID();
    let activeRunId: string | undefined;
    let route: SkillRoute | undefined;
    try {
      const routed = await window.xgenSide.skills.route(request);
      route = routed;
      const showOverview = routed.browserVisible || routed.skills.some((skill) => skill.id !== 'xgen.conversation');
      overviewId = showOverview ? crypto.randomUUID() : undefined;
      const overviewMessages: ChatMessage[] = overviewId ? [{
        id: overviewId,
        role: 'assistant',
        content: '',
        overview: { route: routed, status: 'running', prompt: value },
      }] : [];
      setHomeMessages((current) => [...current,
        ...overviewMessages,
        { id: responseId, role: 'assistant', content: '', meta: '실행 준비 중' },
      ]);
      const handle = window.xgenSide.agent.start(request, (runEvent) => {
        setHomeMessages((current) => applyRunEvent(current, responseId, overviewId, runEvent));
      });
      homeRunRef.current = handle;
      activeRunId = handle.id;
      const result = await handle.result;
      setHomeMessages((current) => current.map((message) => overviewId && message.id === overviewId ? {
        ...message,
        overview: {
          ...message.overview,
          route: result.route ?? routed,
          status: result.state === 'completed' ? 'completed' : result.state === 'cancelled' ? 'cancelled' : 'failed',
          prompt: value,
        },
      } : message));
      setHomeMessages((current) => current.map((message) => message.id === responseId ? {
        ...message,
        content: result.answer || message.content || result.error || '응답이 없습니다.',
        meta: `${runStateLabel(result.state)} · 로컬 기록 ${result.sessionId.slice(0, 8)}`,
      } : message));
    } catch (error) {
      if (route) {
        setHomeMessages((current) => current.map((message) => overviewId && message.id === overviewId && message.overview ? {
          ...message,
          overview: { ...message.overview, status: 'failed' },
        } : message));
      }
      setHomeMessages((current) => current.some((message) => message.id === responseId)
        ? current.map((message) => message.id === responseId ? {
          ...message,
          content: error instanceof Error ? error.message : String(error),
          meta: '실행 실패',
        } : message)
        : [...current, errorMessage(error)]);
    } finally {
      if (homeRunRef.current?.id === activeRunId) homeRunRef.current = null;
      setHomeBusy(false);
    }
  }

  async function sendPageMessage(event: FormEvent): Promise<void> {
    event.preventDefault();
    const value = pagePrompt.trim();
    if (!value || pageBusy) return;
    setPageMessages((current) => [...current, { id: crypto.randomUUID(), role: 'user', content: value }]);
    setPagePrompt('');
    setPageBusy(true);
    const responseId = crypto.randomUUID();
    let activeRunId: string | undefined;
    try {
      const pageContext = await window.xgenSide.browser.getPageContext();
      if (!pageContext) throw new Error('현재 페이지를 읽을 수 없습니다.');
      setPageMessages((current) => [...current, { id: responseId, role: 'assistant', content: '', meta: '실행 준비 중' }]);
      const handle = window.xgenSide.agent.start({
        providerId,
        model,
        mode: pageMode,
        reasoningEffort,
        prompt: value,
        pageContext,
        history: pageMessages.map(({ role, content }) => ({ role, content })),
      }, (runEvent) => {
        setPageMessages((current) => applyRunEvent(current, responseId, undefined, runEvent));
      });
      pageRunRef.current = handle;
      activeRunId = handle.id;
      const result = await handle.result;
      setPageMessages((current) => current.map((message) => message.id === responseId ? {
        ...message,
        content: result.answer || message.content || result.error || '응답이 없습니다.',
        meta: `${runStateLabel(result.state)} · 로컬 기록 ${result.sessionId.slice(0, 8)}`,
      } : message));
    } catch (error) {
      setPageMessages((current) => current.some((message) => message.id === responseId)
        ? current.map((message) => message.id === responseId ? {
          ...message,
          content: error instanceof Error ? error.message : String(error),
          meta: '실행 실패',
        } : message)
        : [...current, errorMessage(error)]);
    } finally {
      if (pageRunRef.current?.id === activeRunId) pageRunRef.current = null;
      setPageBusy(false);
    }
  }

  async function cancelHomeRun(): Promise<void> {
    const handle = homeRunRef.current;
    if (!handle || !await handle.cancel()) return;
    homeRunRef.current = null;
    setHomeBusy(false);
    setHomeMessages((current) => current.map((message) => message.overview?.status === 'running'
      ? { ...message, overview: { ...message.overview, status: 'cancelled', activity: '사용자가 실행을 중지했습니다' } }
      : message));
  }

  async function cancelPageRun(): Promise<void> {
    const handle = pageRunRef.current;
    if (!handle || !await handle.cancel()) return;
    pageRunRef.current = null;
    setPageBusy(false);
    setPageMessages((current) => current.map((message) => message.meta?.includes('실행')
      ? { ...message, meta: '중지됨' }
      : message));
  }

  async function connectProvider(id: ProviderId): Promise<void> {
    try {
      const result = await window.xgenSide.providers.authenticate(id);
      setSettingsMessage(result.message);
      if (result.launched) {
        setAuthenticatingProviderId(id);
        setSettingsMessage(`${result.message} 로그인 완료를 자동으로 확인합니다.`);
      }
    } catch (error) {
      setSettingsMessage(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <main className="app-shell" data-theme={theme} data-compact={preferences.compact ? 'true' : 'false'}>
      {leftOpen ? (
        <LeftPanel
          activeChatId={activeChatId}
          chats={chats}
          engine={engine}
          onClose={() => setLeftOpen(false)}
          onCloseBrowser={(id) => void closeBrowserTab(id)}
          onCreateBrowser={() => void createBrowserTab()}
          onCreateChat={createChat}
          onOpenBrowser={(id) => void openBrowserTab(id)}
          onOpenChat={(id) => { setActiveChatId(id); setSurface('home'); setRightOpen(false); }}
          onOpenSettings={() => { setSurface('settings'); setRightOpen(false); }}
          onChangeSettingsSection={setSettingsSection}
          onSettingsSearch={setSettingsSearch}
          onToggleTheme={() => setTheme((current) => current === 'light' ? 'dark' : 'light')}
          settingsSearch={settingsSearch}
          settingsSection={settingsSection}
          surface={surface}
          tabs={tabs}
          theme={theme}
        />
      ) : (
        <button className="panel-reopen panel-reopen-left" onClick={() => setLeftOpen(true)} aria-label="왼쪽 패널 열기"><PanelLeftExpand24Regular /></button>
      )}

      {surface === 'home' && (
        <HomeSurface
          busy={homeBusy}
          chats={chats}
          leftWidth={leftWidth}
          messages={homeMessages}
          mode={homeMode}
          model={model}
          onChangeMode={setHomeMode}
          onChangeModel={setModel}
          onChangePrompt={setHomePrompt}
          onChangeProvider={changeProvider}
          onChangeReasoning={setReasoningEffort}
          onCancel={() => void cancelHomeRun()}
          onOpenBrowser={(id) => void openBrowserTab(id)}
          onOpenChat={(id) => { setActiveChatId(id); setSurface('home'); }}
          onSubmit={(event) => void sendHomeMessage(event)}
          prompt={homePrompt}
          providerId={providerId}
          providers={providers}
          reasoningEffort={reasoningEffort}
          rightWidth={homeDockWidth}
          selectedProvider={selectedProvider}
          tabs={tabs}
        />
      )}
      {surface === 'home' && homeOverview?.route.browserVisible && (
        <BrowserSnapshotRail busy={homeBusy} overview={homeOverview} />
      )}
      {surface === 'settings' && (
        <SettingsSurface
          activeSection={settingsSection}
          leftWidth={leftWidth}
          localData={localData}
          mcpEnabled={mcpEnabled}
          message={settingsMessage}
          onConnect={(id) => void connectProvider(id)}
          onSetMcpEnabled={(id, enabled) => setMcpEnabled((current) => ({ ...current, [id]: enabled }))}
          onSetPreferences={setPreferences}
          onOpenData={() => void window.xgenSide.localData.open()}
          onRefresh={() => void refreshProviders()}
          onSetSkillEnabled={(domainId, skillId, enabled) => setSkillDomains((current) => current.map((domain) => domain.id === domainId ? {
            ...domain,
            skills: domain.skills.map((skill) => skill.id === skillId ? { ...skill, enabled } : skill),
          } : domain))}
          onToggleSkillDomain={(domainId) => setSkillDomains((current) => current.map((domain) => domain.id === domainId ? { ...domain, expanded: !domain.expanded } : domain))}
          providers={providers}
          preferences={preferences}
          skillDomains={skillDomains}
          skillSearch={skillSearch}
          onSkillSearch={setSkillSearch}
        />
      )}
      {surface === 'browser' && (
        <BrowserChrome
          activeTab={activeTab}
          address={address}
          leftWidth={leftWidth}
          onAddressChange={setAddress}
          onBack={() => void window.xgenSide.browser.back()}
          onForward={() => void window.xgenSide.browser.forward()}
          onNavigate={navigate}
          onReload={() => void window.xgenSide.browser.reload()}
          onToggleAgent={() => setRightOpen((current) => !current)}
          rightOpen={rightOpen}
          rightWidth={rightWidth}
        />
      )}

      {surface === 'browser' && rightOpen && (
        <AgentPanel
          activeTab={activeTab}
          busy={pageBusy}
          messages={pageMessages}
          mode={pageMode}
          model={model}
          onChangeMode={setPageMode}
          onChangeModel={setModel}
          onChangePrompt={setPagePrompt}
          onChangeProvider={changeProvider}
          onChangeReasoning={setReasoningEffort}
          onCancel={() => void cancelPageRun()}
          onClose={() => setRightOpen(false)}
          onSubmit={(event) => void sendPageMessage(event)}
          prompt={pagePrompt}
          providerId={providerId}
          providers={providers}
          reasoningEffort={reasoningEffort}
          selectedProvider={selectedProvider}
        />
      )}
    </main>
  );
}

interface LeftPanelProps {
  activeChatId: string;
  chats: ChatSession[];
  engine?: EngineStatus;
  onClose(): void;
  onCloseBrowser(id: string): void;
  onCreateBrowser(): void;
  onCreateChat(): void;
  onChangeSettingsSection(value: SettingsSection): void;
  onOpenBrowser(id: string): void;
  onOpenChat(id: string): void;
  onOpenSettings(): void;
  onSettingsSearch(value: string): void;
  onToggleTheme(): void;
  settingsSearch: string;
  settingsSection: SettingsSection;
  surface: Surface;
  tabs: BrowserTabState[];
  theme: Theme;
}

function LeftPanel(props: LeftPanelProps): ReactElement {
  const settingsItems: Array<{ id: SettingsSection; label: string; description: string; icon: ReactElement }> = [
    { id: 'general', label: 'General', description: '앱 동작과 실행 기본값', icon: <Settings24Regular /> },
    { id: 'providers', label: 'AI Providers', description: 'Codex와 Claude Code', icon: <BotSparkle24Filled /> },
    { id: 'mcp', label: 'MCP', description: '로컬 도구와 서버 연결', icon: <PlugConnected24Regular /> },
    { id: 'skills', label: 'Skills', description: '사이트별 브라우저 능력', icon: <PuzzlePiece24Regular /> },
    { id: 'data', label: 'Local data', description: '세션 기록과 저장소', icon: <Database24Regular /> },
  ];
  const filteredSettingsItems = settingsItems.filter((item) => `${item.label} ${item.description}`.toLowerCase().includes(props.settingsSearch.toLowerCase()));
  return (
    <aside className="left-panel glass-panel">
      <header className="left-brand">
        {props.surface === 'settings' ? (
          <button className="settings-back" onClick={() => props.onOpenChat(props.activeChatId)} aria-label="앱으로 돌아가기">
            <ArrowLeft24Regular /><span><strong>Settings</strong><small>앱으로 돌아가기</small></span>
          </button>
        ) : (
          <button className="brand-button" onClick={() => props.onOpenChat(props.activeChatId)} aria-label="XGEN Side 홈">
            <span className="brand-icon"><BotSparkle24Filled /></span>
            <span><strong>XGEN Side</strong><small>{props.engine?.available ? 'Browser engine ready' : 'Local workspace'}</small></span>
          </button>
        )}
        <button className="icon-button" onClick={props.onClose} aria-label="왼쪽 패널 닫기"><PanelLeftContract24Regular /></button>
      </header>
      {props.surface === 'settings' ? (
        <nav className="settings-nav" aria-label="설정 목록">
          <label className="settings-nav-search"><Search24Regular /><input value={props.settingsSearch} onChange={(event) => props.onSettingsSearch(event.target.value)} placeholder="설정 검색" /></label>
          <div className="settings-nav-group-title">XGEN Side</div>
          <div className="settings-nav-list">
            {filteredSettingsItems.map((item) => (
              <button className={props.settingsSection === item.id ? 'settings-nav-row active' : 'settings-nav-row'} key={item.id} onClick={() => props.onChangeSettingsSection(item.id)}>
                <span className="settings-nav-icon">{item.icon}</span>
                <span><strong>{item.label}</strong><small>{item.description}</small></span>
                <ChevronRight24Regular />
              </button>
            ))}
          </div>
          <div className="settings-nav-footnote"><ShieldLock24Regular /><span><strong>Local first</strong><small>인증과 실행 데이터는 이 기기에만 저장됩니다.</small></span></div>
        </nav>
      ) : (
      <nav className="session-nav" aria-label="세션 목록">
        <section className="nav-section">
          <div className="nav-section-title"><span>Chats</span><button className="icon-button compact" onClick={props.onCreateChat} aria-label="새 채팅"><Add24Regular /></button></div>
          <div className="nav-list">
            {props.chats.map((chat) => (
              <button className={props.surface === 'home' && props.activeChatId === chat.id ? 'nav-row active' : 'nav-row'} key={chat.id} onClick={() => props.onOpenChat(chat.id)}>
                {props.surface === 'home' && props.activeChatId === chat.id ? <Chat24Filled /> : <Chat24Regular />}
                <span className="nav-copy"><strong>{chat.title}</strong><small>{chat.time}</small></span>
              </button>
            ))}
          </div>
        </section>
        <section className="nav-section browser-session-section">
          <div className="nav-section-title"><span>Browser tabs</span><button className="icon-button compact" onClick={props.onCreateBrowser} aria-label="새 브라우저 탭"><Add24Regular /></button></div>
          <div className="nav-list">
            {props.tabs.map((tab) => (
              <div className={props.surface === 'browser' && tab.active ? 'nav-row active' : 'nav-row'} key={tab.id}>
                <button className="nav-row-open" onClick={() => props.onOpenBrowser(tab.id)} aria-label={tab.title || '새 브라우저 탭'}>
                  {tab.url.includes('google.com') ? <Globe24Regular /> : <TabDesktop24Regular />}
                  <span className="nav-copy"><strong>{tab.loading ? '불러오는 중' : tab.title || '새 탭'}</strong><small>{formatHost(tab.url)}</small></span>
                </button>
                <button className="row-close" aria-label="브라우저 탭 닫기" onClick={() => props.onCloseBrowser(tab.id)}><Dismiss24Regular /></button>
              </div>
            ))}
          </div>
        </section>
      </nav>
      )}
      <footer className="left-footer">
        <button className={props.surface === 'settings' ? 'footer-action active' : 'footer-action'} onClick={props.onOpenSettings}><Settings24Regular /><span>Settings</span></button>
        <button className="icon-button" onClick={props.onToggleTheme} aria-label="테마 전환">
          {props.theme === 'light' ? <WeatherMoon24Regular /> : <WeatherSunny24Regular />}
        </button>
      </footer>
    </aside>
  );
}

interface ConversationSurfaceProps {
  busy: boolean;
  messages: ChatMessage[];
  mode: AgentMode;
  model: string;
  onChangeMode(value: AgentMode): void;
  onChangeModel(value: string): void;
  onChangePrompt(value: string): void;
  onChangeProvider(value: ProviderId): void;
  onChangeReasoning(value: ReasoningEffort): void;
  onCancel(): void;
  onSubmit(event: FormEvent): void;
  prompt: string;
  providerId: ProviderId;
  providers: ProviderStatus[];
  reasoningEffort: ReasoningEffort;
  selectedProvider?: ProviderStatus;
}

function HomeSurface(props: ConversationSurfaceProps & {
  chats: ChatSession[];
  leftWidth: number;
  onOpenBrowser(id: string): void;
  onOpenChat(id: string): void;
  rightWidth: number;
  tabs: BrowserTabState[];
}): ReactElement {
  const [recentView, setRecentView] = useState<'chats' | 'browsers'>('chats');
  const hasOverview = props.messages.some((message) => message.overview);
  const composer = <Composer {...props} modes={homeModes} placeholder="AI에게 작업을 요청하거나 웹 검색을 시작하세요" />;
  return (
    <section className="home-surface" style={{ left: props.leftWidth, right: props.rightWidth }}>
      <header className="home-header">
        <h1>{props.messages.length ? 'Chat' : 'New chat'}</h1>
        <button className="profile-button" aria-label="프로필">XS</button>
      </header>
      <div className={props.messages.length ? 'home-content has-messages' : 'home-content'}>
        {props.messages.length ? (
          <>
            <div className={hasOverview ? 'conversation-stream overview-stream' : 'conversation-stream'} role="region" tabIndex={0} aria-label="대화 내용">
              {props.messages.map((message) => <MessageBubble key={message.id} message={message} />)}
            </div>
            {composer}
          </>
        ) : (
          <div className="home-start">
            <div className="home-hero">
              <h1>무엇을 도와드릴까요?</h1>
              <p>대화로 정리하거나, 브라우저 검색으로 최신 정보를 찾아보세요.</p>
            </div>
            {composer}
            <section className="recent-work" aria-label="최근 작업">
              <header className="recent-work-header">
                <div className="recent-tabs" role="tablist" aria-label="최근 작업 종류">
                  <button className={recentView === 'chats' ? 'active' : ''} onClick={() => setRecentView('chats')} role="tab" aria-selected={recentView === 'chats'}>Chats</button>
                  <button className={recentView === 'browsers' ? 'active' : ''} onClick={() => setRecentView('browsers')} role="tab" aria-selected={recentView === 'browsers'}>Browsers</button>
                </div>
                <span><History24Regular /> 최근 작업</span>
              </header>
              <div className="recent-grid">
                {recentView === 'chats'
                  ? props.chats.slice(0, 3).map((chat, index) => (
                    <button className="recent-card" key={chat.id} onClick={() => props.onOpenChat(chat.id)}>
                      <span className="recent-card-icon"><Chat24Regular /></span>
                      <small>{chat.time}</small>
                      <strong>{chat.title}</strong>
                      <p>{index === 0 ? '이어지는 대화와 실행 기록을 확인하세요.' : '최근 대화를 다시 열어 계속 작업할 수 있습니다.'}</p>
                      <span className="recent-card-link">대화 열기 <Open24Regular /></span>
                    </button>
                  ))
                  : props.tabs.slice(0, 3).map((tab) => (
                    <button className="recent-card browser-card" key={tab.id} onClick={() => props.onOpenBrowser(tab.id)}>
                      <span className="recent-card-icon"><Window24Regular /></span>
                      <small>{formatHost(tab.url)}</small>
                      <strong>{tab.title || '새 브라우저 탭'}</strong>
                      <p>{tab.loading ? '페이지를 불러오는 중입니다.' : '최근 브라우저 작업을 이어서 진행하세요.'}</p>
                      <span className="recent-card-link">브라우저 열기 <Open24Regular /></span>
                    </button>
                  ))}
                {recentView === 'browsers' && props.tabs.length === 0 && <div className="recent-empty">아직 열린 브라우저가 없습니다.</div>}
              </div>
            </section>
          </div>
        )}
      </div>
    </section>
  );
}

interface McpDefinition {
  id: string;
  name: string;
  command: string;
  transport: string;
  tools: string[];
  permissions: string[];
  status: string;
}

function BrowserChrome(props: {
  activeTab?: BrowserTabState; address: string; leftWidth: number; rightWidth: number; rightOpen: boolean;
  onAddressChange(value: string): void; onBack(): void; onForward(): void; onNavigate(event: FormEvent): void; onReload(): void; onToggleAgent(): void;
}): ReactElement {
  return (
    <header className="browser-chrome" style={{ left: props.leftWidth, right: props.rightWidth }}>
      <div className="browser-nav-actions">
        <button className="icon-button" disabled={!props.activeTab?.canGoBack} onClick={props.onBack} aria-label="뒤로"><ArrowLeft24Regular /></button>
        <button className="icon-button" disabled={!props.activeTab?.canGoForward} onClick={props.onForward} aria-label="앞으로"><ArrowRight24Regular /></button>
        <button className="icon-button" onClick={props.onReload} aria-label="새로고침"><ArrowClockwise24Regular /></button>
      </div>
      <form className="address-form" onSubmit={props.onNavigate}>
        <Globe24Regular /><input aria-label="주소" value={props.address} onChange={(event) => props.onAddressChange(event.target.value)} placeholder="검색어 또는 URL" />
      </form>
      <button className={props.rightOpen ? 'side-toggle active' : 'side-toggle'} onClick={props.onToggleAgent} aria-pressed={props.rightOpen}>
        <BotSparkle24Filled /><span>XGEN Side</span>
      </button>
    </header>
  );
}

function AgentPanel(props: ConversationSurfaceProps & { activeTab?: BrowserTabState; onClose(): void }): ReactElement {
  return (
    <aside className="agent-panel glass-panel">
      <header className="agent-header">
        <div><span className="agent-title-icon"><BotSparkle24Filled /></span><strong>XGEN Side</strong></div>
        <button className="icon-button" onClick={props.onClose} aria-label="오른쪽 패널 닫기"><PanelRightContract24Regular /></button>
      </header>
      <div className="page-context">
        <div className="context-heading"><Document24Regular /><strong>Attached page</strong></div>
        <p>{props.activeTab?.title || '현재 페이지'}</p>
        <span><Globe24Regular />{formatHost(props.activeTab?.url)}</span>
      </div>
      <div className="mode-explainer">{props.mode === 'page' ? '읽기 전용 · 현재 탭만 답변에 첨부' : '작업 모드 · agent-browser가 현재 탭을 조작'}</div>
      <div className="agent-stream">{props.messages.map((message) => <MessageBubble key={message.id} message={message} />)}</div>
      <Composer {...props} modes={pageModes} placeholder={props.mode === 'page' ? '이 페이지에 대해 질문하세요' : '브라우저에서 수행할 작업을 요청하세요'} />
    </aside>
  );
}

function BrowserSnapshotRail(props: {
  busy: boolean;
  overview: NonNullable<ChatMessage['overview']>;
}): ReactElement {
  const snapshots = props.overview.snapshots ?? [];
  return (
    <aside className="browser-snapshot-rail" aria-label="브라우저 작업 캡처">
      <header className="snapshot-rail-header">
        <div><span className={props.busy ? 'live-browser-status active' : 'live-browser-status'} /><span><strong>Browser activity</strong><small>{props.busy ? '화면이 바뀔 때 캡처합니다' : '작업 캡처 완료'}</small></span></div>
        <span className="snapshot-mode"><Globe24Regular />Snapshots</span>
      </header>
      <div className="snapshot-list">
        {snapshots.length ? snapshots.map((snapshot, index) => (
          <article className="browser-snapshot-card" key={snapshot.id}>
            <header><span><strong>{snapshot.title}</strong><small>{formatHost(snapshot.url)}</small></span><b>{index + 1}</b></header>
            <img src={snapshot.imageDataUrl} alt={`${snapshot.title} 브라우저 캡처`} />
            <footer><span>{snapshot.reason}</span><time>{new Date(snapshot.capturedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></footer>
          </article>
        )) : <div className="snapshot-empty"><Window24Regular /><span><strong>첫 화면을 기다리는 중</strong><small>{props.overview.activity || props.overview.route.reason}</small></span></div>}
      </div>
    </aside>
  );
}

function SettingsSurface(props: {
  activeSection: SettingsSection;
  leftWidth: number;
  localData?: LocalDataStatus;
  mcpEnabled: Record<string, boolean>;
  message: string;
  onConnect(id: ProviderId): void;
  onSetMcpEnabled(id: string, enabled: boolean): void;
  onOpenData(): void;
  onRefresh(): void;
  onSetPreferences(value: AppSettings['general'] | ((current: AppSettings['general']) => AppSettings['general'])): void;
  onSetSkillEnabled(domainId: string, skillId: string, enabled: boolean): void;
  onSkillSearch(value: string): void;
  onToggleSkillDomain(domainId: string): void;
  providers: ProviderStatus[];
  preferences: AppSettings['general'];
  skillDomains: SkillDomain[];
  skillSearch: string;
}): ReactElement {
  const sectionCopy: Record<SettingsSection, { eyebrow: string; title: string; description: string }> = {
    general: { eyebrow: 'XGEN Side', title: 'General', description: '브라우저와 로컬 agent 실행의 기본 동작을 설정합니다.' },
    providers: { eyebrow: 'Models', title: 'AI Providers', description: '공식 로컬 CLI와 구독 계정 연결 상태를 관리합니다.' },
    mcp: { eyebrow: 'Tools', title: 'MCP', description: 'agent가 사용할 로컬 도구 서버와 권한 범위를 관리합니다.' },
    skills: { eyebrow: 'Browser intelligence', title: 'Skills', description: '도메인별로 자동 활성화할 브라우저 능력을 선택합니다.' },
    data: { eyebrow: 'Local first', title: 'Local data', description: '세션 기록과 provider 출력이 저장되는 위치를 확인합니다.' },
  };
  const copy = sectionCopy[props.activeSection];
  const isWorkbench = props.activeSection === 'mcp' || props.activeSection === 'skills' || props.activeSection === 'data';

  return (
    <section className="settings-surface" style={{ left: props.leftWidth }}>
      <header className="settings-topbar"><span>Settings <ChevronRight24Regular /> {copy.title}</span><button className="icon-button" onClick={props.onRefresh} aria-label="상태 새로고침"><ArrowClockwise24Regular /></button></header>
      <div className={isWorkbench ? 'settings-content settings-workbench-content' : 'settings-content settings-detail-scroll'}>
        {!isWorkbench && <div className="settings-page-heading"><span>{copy.eyebrow}</span><h1>{copy.title}</h1><p>{copy.description}</p></div>}
        {props.message && props.activeSection === 'providers' && <div className="settings-notice">{props.message}</div>}

        {props.activeSection === 'general' && (
          <div className="settings-section-stack">
            <SettingsGroup title="Agent behavior" description="모든 provider에 동일하게 적용되는 기본 실행 정책입니다.">
              <SettingsRow title="Guard by default" description="외부 변경이나 중요한 브라우저 동작은 실행 전에 확인합니다."><Toggle checked={props.preferences.guard} onChange={(checked) => props.onSetPreferences((current) => ({ ...current, guard: checked }))} /></SettingsRow>
              <SettingsRow title="Local run history" description="실행 단계와 provider 출력을 로컬 JSONL로 기록합니다."><Toggle checked={props.preferences.localLogs} onChange={(checked) => props.onSetPreferences((current) => ({ ...current, localLogs: checked }))} /></SettingsRow>
              <SettingsRow title="Compact interface" description="사이드 패널과 설정 행의 간격을 줄여 더 많은 정보를 표시합니다."><Toggle checked={props.preferences.compact} onChange={(checked) => props.onSetPreferences((current) => ({ ...current, compact: checked }))} /></SettingsRow>
            </SettingsGroup>
            <SettingsGroup title="Execution" description="Windows에서 agent를 실행하는 기본 환경입니다.">
              <SettingsRow title="Agent runtime" description="공식 provider CLI를 직접 실행하는 로컬 Windows 환경입니다."><span className="setting-value">Windows native</span></SettingsRow>
              <SettingsRow title="Login terminal" description="사용자가 직접 로그인하는 화면에만 PowerShell을 사용합니다."><span className="setting-value">PowerShell</span></SettingsRow>
              <SettingsRow title="Browser engine" description="현재 Electron 탭과 연결되는 자동화 엔진입니다."><span className="setting-value ready-dot">agent-browser</span></SettingsRow>
            </SettingsGroup>
          </div>
        )}

        {props.activeSection === 'providers' && (
          <div className="provider-grid settings-provider-grid">
            {props.providers.map((provider) => (
              <article className="provider-card" key={provider.id}>
                <div className="provider-card-head"><span className="brand-icon"><BotSparkle24Filled /></span><div><strong>{provider.label}</strong><small>{provider.version || 'CLI not found'}</small></div><span className={provider.available ? 'status-pill ready' : 'status-pill'}>{provider.available ? 'Connected' : provider.installed ? 'Setup' : 'Not installed'}</span></div>
                <p>{provider.description}</p>
                {provider.error && <div className="provider-error">{provider.error}</div>}
                {provider.complianceNotice && <div className="provider-policy">{provider.complianceNotice}</div>}
                <button className="provider-action" disabled={!provider.subscriptionAuth || !provider.installed} onClick={() => props.onConnect(provider.id)}>
                  {provider.authenticated ? '다시 로그인' : provider.subscriptionAuth ? '구독 연결' : 'API 연결 준비 중'}
                </button>
              </article>
            ))}
          </div>
        )}

        {props.activeSection === 'mcp' && (
          <McpWorkbench enabled={props.mcpEnabled} onSetEnabled={props.onSetMcpEnabled} />
        )}

        {props.activeSection === 'skills' && (
          <SkillWorkbench domains={props.skillDomains} search={props.skillSearch} onSearch={props.onSkillSearch} onSetEnabled={props.onSetSkillEnabled} />
        )}

        {props.activeSection === 'data' && (
          <MemoryWorkbench localData={props.localData} onOpenData={props.onOpenData} />
        )}
      </div>
    </section>
  );
}

function SkillWorkbench(props: {
  domains: SkillDomain[];
  search: string;
  onSearch(value: string): void;
  onSetEnabled(domainId: string, skillId: string, enabled: boolean): void;
}): ReactElement {
  const resources = useMemo(() => props.domains.flatMap((domain) => domain.skills.map((skill) => ({ domain, skill }))).filter(({ domain, skill }) => {
    const needle = props.search.trim().toLowerCase();
    return !needle || `${domain.label} ${domain.host} ${skill.name} ${skill.description}`.toLowerCase().includes(needle);
  }), [props.domains, props.search]);
  const [selectedId, setSelectedId] = useState('xgen.web-research');
  const selected = resources.find(({ skill }) => skill.id === selectedId) ?? resources[0];
  useEffect(() => {
    if (selected && !resources.some(({ skill }) => skill.id === selectedId)) setSelectedId(selected.skill.id);
  }, [resources, selected, selectedId]);
  return (
    <div className="settings-workbench">
      <aside className="resource-sidebar">
        <header><div><strong>Skills</strong><small>{resources.length} files</small></div><Document24Regular /></header>
        <label className="resource-search"><Search24Regular /><input value={props.search} onChange={(event) => props.onSearch(event.target.value)} placeholder="Search skills" /></label>
        <div className="resource-tree">
          {props.domains.map((domain) => {
            const skills = resources.filter((entry) => entry.domain.id === domain.id);
            if (!skills.length) return null;
            return <section className="resource-group" key={domain.id}><header><span>{domain.label}</span><small>{skills.length}</small></header>{skills.map(({ skill }) => {
              const id = skill.id;
              return <button className={selectedId === id ? 'resource-file active' : 'resource-file'} key={id} onClick={() => setSelectedId(id)}><Document24Regular /><span><strong>{skill.name}</strong><small>SKILL.md</small></span><span className={skill.enabled ? 'resource-state enabled' : 'resource-state'} /></button>;
            })}</section>;
          })}
        </div>
      </aside>
      {selected ? <section className="resource-detail">
        <header className="resource-detail-heading"><div><span>Skill</span><h1>{selected.skill.name}</h1><p>{selected.domain.label} · {selected.skill.domain}</p></div><Toggle checked={selected.skill.enabled} onChange={(checked) => props.onSetEnabled(selected.domain.id, selected.skill.id, checked)} /></header>
        <div className="resource-metadata"><span><small>Runtime</small><strong>{selected.skill.runtime.kind}</strong></span><span><small>Tools</small><strong>{selected.skill.runtime.tools.length}</strong></span><span><small>Risk</small><strong>{selected.skill.permissions.risk}</strong></span></div>
        <MarkdownDocument title={selected.skill.source} content={selected.skill.markdown} />
      </section> : <div className="resource-empty">검색 결과가 없습니다.</div>}
    </div>
  );
}

function McpWorkbench(props: { enabled: Record<string, boolean>; onSetEnabled(id: string, enabled: boolean): void }): ReactElement {
  const [selectedId, setSelectedId] = useState('browser');
  const selected = mcpDefinitions.find((server) => server.id === selectedId) ?? mcpDefinitions[0]!;
  return (
    <div className="settings-workbench">
      <aside className="resource-sidebar">
        <header><div><strong>MCP servers</strong><small>{mcpDefinitions.length} configurations</small></div><PlugConnected24Regular /></header>
        <div className="resource-tree mcp-resource-tree">{mcpDefinitions.map((server) => <button className={selected.id === server.id ? 'resource-file active' : 'resource-file'} key={server.id} onClick={() => setSelectedId(server.id)}><PlugConnected24Regular /><span><strong>{server.name}</strong><small>{server.transport} · {server.status}</small></span><span className={props.enabled[server.id] ? 'resource-state enabled' : 'resource-state'} /></button>)}</div>
      </aside>
      <section className="resource-detail">
        <header className="resource-detail-heading"><div><span>MCP server</span><h1>{selected.name}</h1><p>{selected.command}</p></div><Toggle checked={Boolean(props.enabled[selected.id])} onChange={(checked) => props.onSetEnabled(selected.id, checked)} /></header>
        <div className="resource-metadata"><span><small>Transport</small><strong>{selected.transport}</strong></span><span><small>Tools</small><strong>{selected.tools.length}</strong></span><span><small>Status</small><strong>{selected.status}</strong></span></div>
        <MarkdownDocument title="MCP.md" content={mcpMarkdown(selected)} />
      </section>
    </div>
  );
}

function MemoryWorkbench(props: { localData?: LocalDataStatus; onOpenData(): void }): ReactElement {
  const [files, setFiles] = useState<LocalMarkdownFile[]>([]);
  const [selectedPath, setSelectedPath] = useState('MEMORY.md');
  const [content, setContent] = useState('# Browser Agent Memory\n\n불러오는 중입니다.');
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const refresh = async (): Promise<void> => {
    const next = await window.xgenSide.localData.listMarkdown();
    setFiles(next);
    if (!next.some((file) => file.relativePath === selectedPath)) setSelectedPath(next[0]?.relativePath ?? 'MEMORY.md');
  };
  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void window.xgenSide.localData.readMarkdown(selectedPath).then((value) => {
      if (cancelled) return;
      setContent(value);
      setDirty(false);
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [selectedPath]);
  const save = async (): Promise<void> => {
    await window.xgenSide.localData.writeMarkdown(selectedPath, content);
    setDirty(false);
    await refresh();
  };
  const groups: Array<{ id: LocalMarkdownFile['category']; label: string }> = [
    { id: 'root', label: 'Memory' },
    { id: 'browser-history', label: 'Browser history' },
    { id: 'task-results', label: 'Task results' },
  ];
  const selected = files.find((file) => file.relativePath === selectedPath);
  return (
    <div className="settings-workbench">
      <aside className="resource-sidebar">
        <header><div><strong>Memory</strong><small>Browser Agent only</small></div><Database24Regular /></header>
        <button className="resource-folder-action" onClick={props.onOpenData}><Open24Regular />Open folder</button>
        <div className="resource-tree">{groups.map((group) => {
          const entries = files.filter((file) => file.category === group.id);
          if (!entries.length) return null;
          return <section className="resource-group" key={group.id}><header><span>{group.label}</span><small>{entries.length}</small></header>{entries.map((file) => <button className={selectedPath === file.relativePath ? 'resource-file active' : 'resource-file'} key={file.id} onClick={() => setSelectedPath(file.relativePath)}><Document24Regular /><span><strong>{file.name}</strong><small>{formatFileSize(file.size)}</small></span></button>)}</section>;
        })}</div>
      </aside>
      <section className="resource-detail">
        <header className="resource-detail-heading"><div><span>Local Markdown</span><h1>{selected?.name || 'MEMORY.md'}</h1><p>{props.localData?.memoryRoot || 'Local memory'} · Browser Agent 기록만 저장</p></div><span className="memory-scope"><ShieldLock24Regular />Local only</span></header>
        <MarkdownDocument title={selected?.relativePath || selectedPath} content={content} editable loading={loading} dirty={dirty} onChange={(value) => { setContent(value); setDirty(true); }} onSave={() => void save()} />
      </section>
    </div>
  );
}

function MarkdownDocument(props: { title: string; content: string; editable?: boolean; loading?: boolean; dirty?: boolean; onChange?(value: string): void; onSave?(): void }): ReactElement {
  const [view, setView] = useState<'preview' | 'source'>('preview');
  const lines = props.content.split(/\r?\n/);
  const previewContent = props.content.replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*\r?\n/, '');
  return (
    <section className="markdown-document">
      <header><span><Document24Regular />{props.title}</span><div><button className={view === 'preview' ? 'active' : ''} onClick={() => setView('preview')}>Preview</button><button className={view === 'source' ? 'active' : ''} onClick={() => setView('source')}>Source</button>{props.editable && <button className="save-document" disabled={!props.dirty} onClick={props.onSave}>Save</button>}</div></header>
      {props.loading ? <div className="resource-empty">Markdown을 불러오는 중입니다.</div> : view === 'preview' ? <div className="markdown-document-preview markdown-content"><ReactMarkdown remarkPlugins={[remarkGfm]}>{previewContent}</ReactMarkdown></div> : <div className="source-editor"><pre className="source-gutter" aria-hidden="true">{lines.map((_, index) => `${index + 1}\n`)}</pre>{props.editable ? <textarea value={props.content} onChange={(event) => props.onChange?.(event.target.value)} spellCheck={false} aria-label={`${props.title} Markdown source`} /> : <pre className="source-code">{props.content}</pre>}</div>}
    </section>
  );
}

function mcpMarkdown(server: McpDefinition): string {
  return [`# ${server.name}`, '', '## Connection', '', '```json', JSON.stringify({ transport: server.transport, command: server.command, status: server.status }, null, 2), '```', '', '## Exposed tools', '', ...server.tools.map((tool) => `- \`${tool}\``), '', '## Permission boundary', '', ...server.permissions.map((permission) => `- ${permission}`), '', 'The server is re-scoped for every agent run and receives only the permissions selected by the route.', ''].join('\n');
}

function formatFileSize(size: number): string {
  if (size < 1_024) return `${size} B`;
  return `${Math.round(size / 1_024)} KB`;
}

function SettingsGroup(props: { title: string; description: string; children: ReactElement | ReactElement[] }): ReactElement {
  return <section className="settings-group"><header><strong>{props.title}</strong><p>{props.description}</p></header><div>{props.children}</div></section>;
}

function SettingsRow(props: { title: string; description: string; children: ReactElement }): ReactElement {
  return <div className="settings-row"><span><strong>{props.title}</strong><small>{props.description}</small></span><div className="settings-row-control">{props.children}</div></div>;
}

function McpRow(props: { name: string; command: string; status: string; checked: boolean; onChange(value: boolean): void }): ReactElement {
  return <div className="mcp-row"><span className="mcp-icon"><PlugConnected24Regular /></span><span className="mcp-copy"><strong>{props.name}</strong><small>{props.command}</small></span><span className={props.status === 'Connected' ? 'mcp-status ready' : 'mcp-status'}>{props.status}</span><Toggle checked={props.checked} onChange={props.onChange} /></div>;
}

function Toggle(props: { checked: boolean; onChange(value: boolean): void }): ReactElement {
  return <label className="toggle"><input type="checkbox" aria-label="사용 여부 전환" checked={props.checked} onChange={(event) => props.onChange(event.target.checked)} /><span /></label>;
}

function MessageBubble({ message }: { message: ChatMessage }): ReactElement {
  if (message.overview) return <AgentOverview overview={message.overview} />;
  return (
    <article className={`message message-${message.role}`}>
      {message.role === 'assistant' && <span className="message-avatar"><BotSparkle24Filled /></span>}
      <div className="message-body">
        <div className="markdown-content">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ children, ...anchorProps }) => <a {...anchorProps} target="_blank" rel="noreferrer">{children}</a>,
            }}
          >
            {message.content}
          </ReactMarkdown>
        </div>
        {message.meta && <small className="message-meta">{message.meta}</small>}
      </div>
    </article>
  );
}

function AgentOverview({ overview }: { overview: NonNullable<ChatMessage['overview']> }): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const statusLabel = overview.status === 'running'
    ? 'Running'
    : overview.status === 'completed'
      ? 'Completed'
      : overview.status === 'cancelled'
        ? 'Cancelled'
        : 'Needs attention';
  return (
    <article className={expanded ? 'agent-overview expanded' : 'agent-overview'}>
      <button className="overview-header" onClick={() => setExpanded((current) => !current)} aria-expanded={expanded}>
        <div><span className="overview-brand"><BotSparkle24Filled /></span><span><strong>{overview.activity || overview.route.reason}</strong><small>{overview.route.skills.map((skill) => skill.name).join(' · ')}</small></span></div>
        <span className="overview-header-actions"><span className={`overview-status ${overview.status}`}>{statusLabel}</span><ChevronDown24Regular className={expanded ? 'chevron-open' : ''} /></span>
      </button>
      {expanded && <div className="overview-details">
        <div className="overview-skills"><span>사용 중인 skill</span>{overview.route.skills.map((skill) => <span className="skill-chip" key={skill.id}><PuzzlePiece24Regular />{skill.name}<small>{skill.risk}</small></span>)}</div>
        <div className="overview-timeline">
          {overview.route.steps.map((step, index) => {
            const running = overview.status === 'running' && index === overview.route.steps.length - 1;
            const complete = overview.status === 'completed' || index < overview.route.steps.length - 1;
            return (
              <div className={running ? 'overview-step running' : 'overview-step'} key={step.id}>
                <span className="step-icon">{complete ? <CheckmarkCircle24Regular /> : step.kind === 'browser' ? <Globe24Regular /> : step.kind === 'guard' ? <ShieldLock24Regular /> : <Sparkle24Filled />}</span>
                <span><strong>{step.label}</strong><small>{step.detail}</small></span>
                <span className={overview.status === 'failed' && index === overview.route.steps.length - 1 ? 'step-state failed' : 'step-state'}>{running ? '진행 중' : complete ? '완료' : index + 1}</span>
              </div>
            );
          })}
        </div>
        {overview.route.browserVisible && <div className="overview-browser-note"><Window24Regular /><span><strong>브라우저 작업 캡처</strong><small>{overview.route.targetHost || '검색 탭'} · 동작과 화면 전환 시 오른쪽에 기록</small></span></div>}
        {overview.route.blockedReason && <div className="overview-blocked"><ShieldLock24Regular />{overview.route.blockedReason}</div>}
      </div>}
    </article>
  );
}

function Composer(props: ConversationSurfaceProps & { modes: Array<{ id: AgentMode; label: string }>; placeholder: string }): ReactElement {
  const models = props.selectedProvider?.models ?? [];
  const modeHint: Record<AgentMode, string> = {
    auto: 'Agent가 필요한 도구를 자동 선택',
    chat: '브라우저 없이 대화',
    search: '실시간 브라우저 · 읽기 전용',
    page: '현재 페이지 읽기',
    'browser-agent': '브라우저 조작 · Memory 저장',
  };
  const submitOnEnter = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (!props.prompt.trim() || props.busy || !props.selectedProvider?.available) return;
    event.currentTarget.form?.requestSubmit();
  };
  return (
    <form className="composer" onSubmit={props.onSubmit}>
      <div className="composer-primary">
        <textarea value={props.prompt} onChange={(event) => props.onChangePrompt(event.target.value)} onKeyDown={submitOnEnter} placeholder={props.busy ? '로컬 agent가 실행 중입니다' : props.placeholder} aria-label={`${props.placeholder}. Enter로 전송, Shift+Enter로 줄바꿈`} disabled={props.busy} />
        <label className="mode-select"><span className="sr-only">실행 범위</span><select value={props.mode} onChange={(event) => props.onChangeMode(event.target.value as AgentMode)}>{props.modes.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select><ChevronDown24Regular /></label>
      </div>
      <div className="composer-tools">
        <div className="composer-context-tools">
          <button type="button" className="icon-button compact" aria-label="파일 첨부"><Attach24Regular /></button>
          <span className="mode-boundary-hint">{modeHint[props.mode]}</span>
          <span className="context-chip"><Document24Regular />Local<ChevronDown24Regular /></span>
          <span className="context-chip"><ShieldLock24Regular />Guard<ChevronDown24Regular /></span>
        </div>
        <div className="composer-options">
          <label className="compact-select provider-select"><BotSparkle24Filled /><span className="sr-only">Provider</span><select value={props.providerId} onChange={(event) => props.onChangeProvider(event.target.value as ProviderId)}>{props.providers.map((provider) => <option key={provider.id} value={provider.id} disabled={!provider.available}>{provider.id === 'codex' ? 'OpenAI' : 'Claude'}</option>)}</select><ChevronDown24Regular /></label>
          <label className="compact-select"><span className="sr-only">Model</span><select value={props.model} onChange={(event) => props.onChangeModel(event.target.value)}>{models.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select><ChevronDown24Regular /></label>
          <label className="compact-select reasoning-select"><span className="sr-only">추론 강도</span><select value={props.selectedProvider?.supportsReasoningEffort ? props.reasoningEffort : 'auto'} disabled={!props.selectedProvider?.supportsReasoningEffort} onChange={(event) => props.onChangeReasoning(event.target.value as ReasoningEffort)}>{props.selectedProvider?.supportsReasoningEffort ? reasoningOptions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>) : <option value="auto">Provider default</option>}</select><ChevronDown24Regular /></label>
          <button type="button" className="icon-button compact composer-mic" aria-label="음성 입력"><Mic24Regular /></button>
          {props.busy && <button type="button" className="send-button stop-button" onClick={props.onCancel} aria-label="실행 중지"><Dismiss24Regular /></button>}
        </div>
      </div>
    </form>
  );
}

function errorMessage(error: unknown): ChatMessage {
  return { id: crypto.randomUUID(), role: 'assistant', content: error instanceof Error ? error.message : String(error) };
}

function applyRunEvent(
  messages: ChatMessage[],
  responseId: string,
  overviewId: string | undefined,
  event: AgentRunEvent,
): ChatMessage[] {
  return messages.map((message) => {
    if (message.id === responseId) {
      if (event.type === 'text') {
        return {
          ...message,
          content: event.mode === 'append' ? `${message.content}${event.text}` : event.text,
          meta: '응답 스트리밍 중',
        };
      }
      return { ...message, meta: runEventLabel(event) };
    }
    if (overviewId && message.id === overviewId && message.overview) {
      if (event.type === 'browser-snapshot') {
        const snapshots = [...(message.overview.snapshots ?? []), event.snapshot].slice(-8);
        return { ...message, overview: { ...message.overview, snapshots, activity: event.snapshot.reason } };
      }
      return { ...message, overview: { ...message.overview, activity: runEventLabel(event) } };
    }
    return message;
  });
}

function runEventLabel(event: AgentRunEvent): string {
  switch (event.type) {
    case 'run-started': return '실행을 시작했습니다';
    case 'skills-routed': return event.route.reason;
    case 'provider-started': return `${event.providerId === 'codex' ? 'Codex' : 'Claude Code'} · ${event.model}`;
    case 'text': return '응답 스트리밍 중';
    case 'activity': return `${event.name} · ${event.phase}`;
    case 'browser-snapshot': return `${event.snapshot.title} · 화면 캡처`;
    case 'run-finished': return runStateLabel(event.state);
  }
}

function runStateLabel(state: 'completed' | 'failed' | 'cancelled'): string {
  if (state === 'completed') return '완료';
  if (state === 'cancelled') return '중지됨';
  return '실패';
}

function formatHost(url?: string): string {
  if (!url || url === 'about:blank') return '새 브라우저 세션';
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}
