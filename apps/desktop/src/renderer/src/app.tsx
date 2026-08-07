import {
  Add24Regular,
  ArrowClockwise24Regular,
  ArrowLeft24Regular,
  ArrowRight24Regular,
  Attach24Regular,
  BotSparkle24Filled,
  Chat24Filled,
  Chat24Regular,
  ChevronDown24Regular,
  ChevronRight24Regular,
  Database24Regular,
  Dismiss24Regular,
  Document24Regular,
  Globe24Regular,
  Mic24Regular,
  PanelLeftContract24Regular,
  PanelLeftExpand24Regular,
  PanelRightContract24Regular,
  PlugConnected24Regular,
  PuzzlePiece24Regular,
  Search24Regular,
  Send24Filled,
  Settings24Regular,
  ShieldLock24Regular,
  Sparkle24Filled,
  TabDesktop24Regular,
  WeatherMoon24Regular,
  WeatherSunny24Regular,
} from '@fluentui/react-icons';
import { type FormEvent, type ReactElement, useEffect, useMemo, useState } from 'react';
import type {
  AgentMode,
  AppSettings,
  BrowserTabState,
  EngineStatus,
  LocalDataStatus,
  ProviderId,
  ProviderStatus,
  SkillRoute,
} from '../../shared/contracts';

type Theme = 'light' | 'dark';
type Surface = 'home' | 'browser' | 'settings';
type SettingsSection = 'general' | 'providers' | 'mcp' | 'skills' | 'data';

interface SkillDefinition {
  id: string;
  name: string;
  description: string;
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
    status: 'running' | 'completed' | 'failed';
    prompt: string;
  };
}

const initialChats: ChatSession[] = [
  { id: 'chat-1', title: '새로운 AI 브라우저 구조 정리', time: '방금' },
  { id: 'chat-2', title: '고속도로 교통 상황 요약', time: '오전 9:18' },
  { id: 'chat-3', title: '문서 비교와 핵심 차이', time: '어제' },
  { id: 'chat-4', title: 'Windows 자동화 계획', time: '5월 30일' },
];

const homeModes: Array<{ id: AgentMode; label: string }> = [
  { id: 'chat', label: 'Chat' },
  { id: 'search', label: 'Search' },
];

const pageModes: Array<{ id: AgentMode; label: string }> = [
  { id: 'page', label: 'Ask page' },
  { id: 'browser-agent', label: 'Browser agent' },
];

const initialSkillDomains: SkillDomain[] = [
  {
    id: 'github', label: 'GitHub', host: 'github.com', accent: '#24292f', expanded: true,
    skills: [
      { id: 'repo-navigator', name: 'Repository navigator', description: '저장소 구조와 코드 위치를 빠르게 탐색합니다.', enabled: true },
      { id: 'pr-review', name: 'Pull request context', description: 'PR 변경점과 리뷰 컨텍스트를 현재 페이지에서 읽습니다.', enabled: true },
    ],
  },
  {
    id: 'google-workspace', label: 'Google Workspace', host: 'docs.google.com · drive.google.com', accent: '#4285f4', expanded: false,
    skills: [
      { id: 'document-reader', name: 'Document reader', description: '문서의 구조와 선택 영역을 읽고 요약합니다.', enabled: true },
      { id: 'drive-organizer', name: 'Drive organizer', description: '승인 후 파일 분류와 폴더 정리를 지원합니다.', enabled: false },
    ],
  },
  {
    id: 'notion', label: 'Notion', host: 'notion.so', accent: '#677083', expanded: false,
    skills: [
      { id: 'workspace-context', name: 'Workspace context', description: '현재 페이지와 연결된 워크스페이스 컨텍스트를 첨부합니다.', enabled: true },
      { id: 'database-helper', name: 'Database helper', description: '데이터베이스 속성과 보기를 이해하고 작업을 계획합니다.', enabled: false },
    ],
  },
  {
    id: 'global', label: 'Every website', host: '모든 도메인', accent: '#305eeb', expanded: false,
    skills: [
      { id: 'chat-answer', name: 'Conversation', description: '브라우저나 외부 도구 없이 일반 요청에 답합니다.', enabled: true },
      { id: 'web-research', name: 'Web research', description: '일반 웹 검색 결과를 출처와 함께 조사합니다.', enabled: true },
      { id: 'browser-navigation', name: 'Browser navigation', description: '탭을 열고 URL로 이동하며 페이지 상태를 확인합니다.', enabled: true },
      { id: 'data-extraction', name: 'Structured extraction', description: '페이지에서 필요한 정보를 읽어 구조화된 결과로 정리합니다.', enabled: true },
      { id: 'page-summarizer', name: 'Page summarizer', description: '현재 페이지의 핵심 내용과 출처를 정리합니다.', enabled: true },
      { id: 'form-guard', name: 'Form guard', description: '제출 전 입력 내용과 위험한 동작을 검토합니다.', enabled: true },
    ],
  },
];

const initialPreferences: AppSettings['general'] = { guard: true, localLogs: true, compact: false };

export function App(): ReactElement {
  const [tabs, setTabs] = useState<BrowserTabState[]>([]);
  const [surface, setSurface] = useState<Surface>('home');
  const [theme, setTheme] = useState<Theme>('light');
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(false);
  const [address, setAddress] = useState('');
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [providerId, setProviderId] = useState<ProviderId>('codex');
  const [model, setModel] = useState('gpt-5.6-sol');
  const [homeMode, setHomeMode] = useState<AgentMode>('chat');
  const [pageMode, setPageMode] = useState<AgentMode>('page');
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
  const [skillDomains, setSkillDomains] = useState(initialSkillDomains);
  const [mcpEnabled, setMcpEnabled] = useState<Record<string, boolean>>({ browser: true, xgen: true, filesystem: false });
  const [preferences, setPreferences] = useState(initialPreferences);
  const [settingsReady, setSettingsReady] = useState(false);
  const activeTab = useMemo(() => tabs.find((tab) => tab.active), [tabs]);
  const selectedProvider = providers.find((provider) => provider.id === providerId);
  const leftWidth = leftOpen ? 260 : 0;
  const rightWidth = surface === 'browser' && rightOpen ? 372 : 0;

  useEffect(() => {
    void window.xgenSide.browser.listTabs().then(setTabs);
    void window.xgenSide.engine.status().then(setEngine);
    void refreshProviders();
    void window.xgenSide.localData.status().then(setLocalData);
    void window.xgenSide.settings.load().then((saved) => {
      setPreferences(saved.general);
      setMcpEnabled(saved.mcpEnabled);
      setSkillDomains((current) => current.map((domain) => ({
        ...domain,
        skills: domain.skills.map((skill) => ({
          ...skill,
          enabled: saved.skillEnabled[`${domain.id}:${skill.id}`] ?? skill.enabled,
        })),
      })));
      setSettingsReady(true);
    }).catch(() => setSettingsReady(true));
    return window.xgenSide.browser.onTabsChanged(setTabs);
  }, []);

  useEffect(() => {
    if (!settingsReady) return;
    const skillEnabled = Object.fromEntries(skillDomains.flatMap((domain) => domain.skills.map((skill) => [`${domain.id}:${skill.id}`, skill.enabled])));
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
    });
  }, [leftWidth, rightWidth, surface]);

  async function refreshProviders(): Promise<void> {
    const next = await window.xgenSide.providers.list();
    setProviders(next);
    const current = next.find((provider) => provider.id === providerId) ?? next[0];
    if (current) {
      setProviderId(current.id);
      setModel((value) => current.models.some((item) => item.id === value) ? value : (current.models[0]?.id ?? ''));
    }
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
      prompt: value,
      history: homeMessages.filter((message) => !message.overview).map(({ role, content }) => ({ role, content })),
    };
    const overviewId = crypto.randomUUID();
    let route: SkillRoute | undefined;
    try {
      const routed = await window.xgenSide.skills.route(request);
      route = routed;
      if (routed.browserRequired || routed.blockedReason) {
        setHomeMessages((current) => [...current, {
          id: overviewId,
          role: 'assistant',
          content: '',
          overview: { route: routed, status: 'running', prompt: value },
        }]);
      }
      const result = await window.xgenSide.agent.run(request);
      if (routed.browserRequired || routed.blockedReason) {
        setHomeMessages((current) => current.map((message) => message.id === overviewId ? {
          ...message,
          overview: { route: result.route ?? routed, status: result.state === 'completed' ? 'completed' : 'failed', prompt: value },
        } : message));
      }
      setHomeMessages((current) => [...current, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: result.answer || result.error || '응답이 없습니다.',
        meta: `로컬 기록 · ${result.sessionId.slice(0, 8)}`,
      }]);
    } catch (error) {
      if (route?.browserRequired || route?.blockedReason) {
        setHomeMessages((current) => current.map((message) => message.id === overviewId && message.overview ? {
          ...message,
          overview: { ...message.overview, status: 'failed' },
        } : message));
      }
      setHomeMessages((current) => [...current, errorMessage(error)]);
    } finally {
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
    try {
      const pageContext = await window.xgenSide.browser.getPageContext();
      if (!pageContext) throw new Error('현재 페이지를 읽을 수 없습니다.');
      const result = await window.xgenSide.agent.run({
        providerId,
        model,
        mode: pageMode,
        prompt: value,
        pageContext,
        history: pageMessages.map(({ role, content }) => ({ role, content })),
      });
      setPageMessages((current) => [...current, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: result.answer || result.error || '응답이 없습니다.',
        meta: `로컬 기록 · ${result.sessionId.slice(0, 8)}`,
      }]);
    } catch (error) {
      setPageMessages((current) => [...current, errorMessage(error)]);
    } finally {
      setPageBusy(false);
    }
  }

  async function connectProvider(id: ProviderId): Promise<void> {
    const result = await window.xgenSide.providers.authenticate(id);
    setSettingsMessage(result.message);
    if (result.launched) setTimeout(() => void refreshProviders(), 4_000);
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
          leftWidth={leftWidth}
          messages={homeMessages}
          mode={homeMode}
          model={model}
          onChangeMode={setHomeMode}
          onChangeModel={setModel}
          onChangePrompt={setHomePrompt}
          onChangeProvider={changeProvider}
          onSubmit={(event) => void sendHomeMessage(event)}
          prompt={homePrompt}
          providerId={providerId}
          providers={providers}
          selectedProvider={selectedProvider}
        />
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
          onClose={() => setRightOpen(false)}
          onSubmit={(event) => void sendPageMessage(event)}
          prompt={pagePrompt}
          providerId={providerId}
          providers={providers}
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
              <button className={props.surface === 'browser' && tab.active ? 'nav-row active' : 'nav-row'} key={tab.id} onClick={() => props.onOpenBrowser(tab.id)}>
                {tab.url.includes('google.com') ? <Globe24Regular /> : <TabDesktop24Regular />}
                <span className="nav-copy"><strong>{tab.loading ? '불러오는 중' : tab.title || '새 탭'}</strong><small>{formatHost(tab.url)}</small></span>
                <span className="row-close" role="button" tabIndex={0} aria-label="브라우저 탭 닫기" onClick={(event) => { event.stopPropagation(); props.onCloseBrowser(tab.id); }}><Dismiss24Regular /></span>
              </button>
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
  onSubmit(event: FormEvent): void;
  prompt: string;
  providerId: ProviderId;
  providers: ProviderStatus[];
  selectedProvider?: ProviderStatus;
}

function HomeSurface(props: ConversationSurfaceProps & { leftWidth: number }): ReactElement {
  const hasOverview = props.messages.some((message) => message.overview);
  return (
    <section className="home-surface" style={{ left: props.leftWidth }}>
      <header className="home-header"><span>New chat</span><button className="profile-button" aria-label="프로필">XS</button></header>
      <div className={props.messages.length ? 'home-content has-messages' : 'home-content'}>
        {props.messages.length ? (
          <div className={hasOverview ? 'conversation-stream overview-stream' : 'conversation-stream'}>{props.messages.map((message) => <MessageBubble key={message.id} message={message} />)}</div>
        ) : (
          <div className="home-hero">
            <span className="hero-icon"><Sparkle24Filled /></span>
            <h1>무엇을 도와드릴까요?</h1>
            <p>Chat은 대화만, Search는 출처가 있는 웹 리서치만 실행합니다.</p>
          </div>
        )}
        <Composer {...props} modes={homeModes} placeholder="메시지를 입력하거나 검색을 요청하세요" />
      </div>
    </section>
  );
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
  const skillNeedle = props.skillSearch.trim().toLowerCase();
  const filteredDomains = props.skillDomains.map((domain) => {
    const domainMatches = `${domain.label} ${domain.host}`.toLowerCase().includes(skillNeedle);
    return {
      ...domain,
      skills: domainMatches || !skillNeedle
        ? domain.skills
        : domain.skills.filter((skill) => `${skill.name} ${skill.description}`.toLowerCase().includes(skillNeedle)),
    };
  }).filter((domain) => domain.skills.length > 0);

  return (
    <section className="settings-surface" style={{ left: props.leftWidth }}>
      <header className="settings-topbar"><span>Settings <ChevronRight24Regular /> {copy.title}</span><button className="icon-button" onClick={props.onRefresh} aria-label="상태 새로고침"><ArrowClockwise24Regular /></button></header>
      <div className="settings-content settings-detail-scroll">
        <div className="settings-page-heading"><span>{copy.eyebrow}</span><h1>{copy.title}</h1><p>{copy.description}</p></div>
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
          <div className="settings-section-stack">
            <div className="section-toolbar"><div><strong>Connected servers</strong><span>3개의 로컬 MCP 구성이 등록되어 있습니다.</span></div><button className="quiet-action">서버 추가</button></div>
            <SettingsGroup title="Local MCP servers" description="활성화된 서버만 agent 실행 시 provider에 전달됩니다.">
              <McpRow name="XGEN Browser" command="agent-browser mcp · core,tabs" status="Connected" checked={Boolean(props.mcpEnabled.browser)} onChange={(checked) => props.onSetMcpEnabled('browser', checked)} />
              <McpRow name="XGEN Tools" command="xgen tools mcp · local" status="Connected" checked={Boolean(props.mcpEnabled.xgen)} onChange={(checked) => props.onSetMcpEnabled('xgen', checked)} />
              <McpRow name="Local Files" command="filesystem · selected folders only" status="Needs scope" checked={Boolean(props.mcpEnabled.filesystem)} onChange={(checked) => props.onSetMcpEnabled('filesystem', checked)} />
            </SettingsGroup>
            <div className="settings-inline-note"><ShieldLock24Regular /><p><strong>MCP 권한은 세션마다 다시 제한됩니다.</strong><span>브라우저 쿠키, 인증 정보, 다운로드와 업로드는 기본 정책에서 차단됩니다.</span></p></div>
          </div>
        )}

        {props.activeSection === 'skills' && (
          <div className="settings-section-stack">
            <div className="skill-toolbar">
              <label className="skill-search"><Search24Regular /><input value={props.skillSearch} onChange={(event) => props.onSkillSearch(event.target.value)} placeholder="도메인 또는 skill 검색" /></label>
              <span>{props.skillDomains.reduce((count, domain) => count + domain.skills.filter((skill) => skill.enabled).length, 0)} active</span>
            </div>
            <div className="domain-list">
              {filteredDomains.map((domain) => {
                const open = domain.expanded || Boolean(skillNeedle);
                return (
                  <article className="domain-card" key={domain.id}>
                    <button className="domain-header" onClick={() => props.onToggleSkillDomain(domain.id)} aria-expanded={open}>
                      <span className="domain-mark" style={{ color: domain.accent, background: `${domain.accent}18` }}>{domain.label.slice(0, 1)}</span>
                      <span className="domain-copy"><strong>{domain.label}</strong><small>{domain.host}</small></span>
                      <span className="domain-count">{domain.skills.filter((skill) => skill.enabled).length}/{domain.skills.length}</span>
                      <ChevronDown24Regular className={open ? 'chevron-open' : ''} />
                    </button>
                    {open && <div className="domain-skills">{domain.skills.map((skill) => (
                      <SettingsRow key={skill.id} title={skill.name} description={skill.description}><Toggle checked={skill.enabled} onChange={(checked) => props.onSetSkillEnabled(domain.id, skill.id, checked)} /></SettingsRow>
                    ))}</div>}
                  </article>
                );
              })}
              {filteredDomains.length === 0 && <div className="empty-settings">검색 결과가 없습니다.</div>}
            </div>
          </div>
        )}

        {props.activeSection === 'data' && (
          <div className="settings-section-stack">
            <section className="local-data-card settings-data-card">
              <div><strong>Local agent store</strong><p>세션 메타데이터, 페이지 컨텍스트, provider JSONL, 오류와 실행 이벤트를 로컬에 기록합니다.</p><code>{props.localData?.root || '불러오는 중'}</code></div>
              <button className="provider-action secondary" onClick={props.onOpenData}>폴더 열기</button>
            </section>
            <section className="execution-boundary">
              <strong>Mode boundaries</strong>
              <div><span>Chat</span><p>격리된 작업 폴더, 브라우저 컨텍스트와 파일 쓰기 도구 없음</p></div>
              <div><span>Search</span><p>격리된 작업 폴더, 웹 검색과 출처 요청만 허용</p></div>
              <div><span>Ask page</span><p>현재 탭 텍스트만 첨부, 브라우저 조작 없음</p></div>
              <div><span>Browser agent</span><p>provider별 실행 가드와 로컬 agent-browser MCP 정책 적용</p></div>
            </section>
          </div>
        )}
      </div>
    </section>
  );
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
  return <label className="toggle"><input type="checkbox" checked={props.checked} onChange={(event) => props.onChange(event.target.checked)} /><span /></label>;
}

function MessageBubble({ message }: { message: ChatMessage }): ReactElement {
  if (message.overview) return <AgentOverview overview={message.overview} />;
  return (
    <article className={`message message-${message.role}`}>
      {message.role === 'assistant' && <span className="message-avatar"><BotSparkle24Filled /></span>}
      <div><p>{message.content}</p>{message.meta && <small className="message-meta">{message.meta}</small>}</div>
    </article>
  );
}

function AgentOverview({ overview }: { overview: NonNullable<ChatMessage['overview']> }): ReactElement {
  const statusLabel = overview.status === 'running' ? 'Running' : overview.status === 'completed' ? 'Completed' : 'Needs attention';
  return (
    <article className="agent-overview">
      <header className="overview-header">
        <div><span className="overview-brand"><BotSparkle24Filled /></span><span><strong>Browser task overview</strong><small>{overview.route.reason}</small></span></div>
        <span className={`overview-status ${overview.status}`}>{statusLabel}</span>
      </header>
      <div className="overview-request">{overview.prompt}</div>
      <div className="overview-skills"><span>Selected skills</span>{overview.route.skills.map((skill) => <span className="skill-chip" key={skill.id}><PuzzlePiece24Regular />{skill.name}<small>{skill.risk}</small></span>)}</div>
      <div className="overview-grid">
        <div className="overview-timeline">
          {overview.route.steps.map((step, index) => (
            <div className="overview-step" key={step.id}>
              <span className="step-icon">{step.kind === 'browser' ? <Globe24Regular /> : step.kind === 'guard' ? <ShieldLock24Regular /> : <Sparkle24Filled />}</span>
              <span><strong>{step.label}</strong><small>{step.detail}</small></span>
              <span className={overview.status === 'failed' && index === overview.route.steps.length - 1 ? 'step-state failed' : 'step-state'}>{overview.status === 'running' && index === overview.route.steps.length - 1 ? 'Waiting' : index + 1}</span>
            </div>
          ))}
        </div>
        <div className="overview-browser">
          <div className="overview-browser-bar"><span /><span>{overview.route.targetUrl || 'XGEN browser workspace'}</span><Globe24Regular /></div>
          <div className="overview-browser-canvas"><span className="browser-canvas-icon"><Globe24Regular /></span><strong>{overview.route.targetHost || 'Browser workspace'}</strong><p>Skill-scoped browser session</p><div className="browser-policy-line"><ShieldLock24Regular />{overview.route.browserActionCategories.join(' · ')}</div></div>
        </div>
      </div>
      {overview.route.blockedReason && <div className="overview-blocked"><ShieldLock24Regular />{overview.route.blockedReason}</div>}
    </article>
  );
}

function Composer(props: ConversationSurfaceProps & { modes: Array<{ id: AgentMode; label: string }>; placeholder: string }): ReactElement {
  const models = props.selectedProvider?.models ?? [];
  return (
    <form className="composer" onSubmit={props.onSubmit}>
      <textarea value={props.prompt} onChange={(event) => props.onChangePrompt(event.target.value)} placeholder={props.busy ? '로컬 agent가 실행 중입니다' : props.placeholder} aria-label={props.placeholder} disabled={props.busy} />
      <div className="composer-tools">
        <button type="button" className="icon-button" aria-label="파일 첨부"><Attach24Regular /></button>
        <div className="composer-options">
          <label className="compact-select mode-select"><span className="sr-only">Mode</span><select value={props.mode} onChange={(event) => props.onChangeMode(event.target.value as AgentMode)}>{props.modes.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select><ChevronDown24Regular /></label>
          <label className="compact-select"><span className="sr-only">Provider</span><select value={props.providerId} onChange={(event) => props.onChangeProvider(event.target.value as ProviderId)}>{props.providers.map((provider) => <option key={provider.id} value={provider.id} disabled={!provider.available}>{provider.id === 'codex' ? 'ChatGPT' : 'Claude'}</option>)}</select><ChevronDown24Regular /></label>
          <label className="compact-select"><span className="sr-only">Model</span><select value={props.model} onChange={(event) => props.onChangeModel(event.target.value)}>{models.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select><ChevronDown24Regular /></label>
          <button type="button" className="icon-button" aria-label="음성 입력"><Mic24Regular /></button>
          <button type="submit" className="send-button" disabled={!props.prompt.trim() || props.busy || !props.selectedProvider?.available} aria-label="보내기"><Send24Filled /></button>
        </div>
      </div>
    </form>
  );
}

function errorMessage(error: unknown): ChatMessage {
  return { id: crypto.randomUUID(), role: 'assistant', content: error instanceof Error ? error.message : String(error) };
}

function formatHost(url?: string): string {
  if (!url || url === 'about:blank') return '새 브라우저 세션';
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}
