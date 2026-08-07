export type ShellKind = 'powershell' | 'cmd' | 'wsl';

export interface BrowserTabState {
  id: string;
  title: string;
  url: string;
  active: boolean;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

export interface BrowserLayoutState {
  visible: boolean;
  leftWidth: number;
  rightWidth: number;
  chromeHeight: number;
}

export interface CommandRequest {
  shell: ShellKind;
  script: string;
  cwd?: string;
}

export type PolicyDecision = 'allow' | 'ask' | 'deny';

export interface CommandResult {
  state: 'completed' | 'approval-required' | 'denied' | 'failed';
  decision: PolicyDecision;
  reason: string;
  approvalToken?: string;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  durationMs?: number;
}

export interface EngineStatus {
  available: boolean;
  version?: string;
  executablePath?: string;
  error?: string;
}

export type ProviderId = 'codex' | 'claude';
export type AgentMode = 'chat' | 'search' | 'page' | 'browser-agent';
export type BrowserActionCategory = 'navigate' | 'click' | 'fill' | 'snapshot' | 'scroll' | 'wait' | 'read' | 'get' | 'interact';

export interface RoutedSkill {
  id: string;
  settingKey: string;
  name: string;
  description: string;
  domain: string;
  risk: 'read' | 'write' | 'consequential';
}

export interface SkillRouteStep {
  id: string;
  label: string;
  detail: string;
  kind: 'route' | 'browser' | 'extract' | 'guard' | 'result';
}

export interface SkillRoute {
  id: string;
  reason: string;
  browserRequired: boolean;
  targetUrl?: string;
  targetHost?: string;
  browserActionCategories: BrowserActionCategory[];
  skills: RoutedSkill[];
  steps: SkillRouteStep[];
  blockedReason?: string;
}

export interface ProviderStatus {
  id: ProviderId;
  label: string;
  description: string;
  installed: boolean;
  authenticated: boolean;
  available: boolean;
  subscriptionAuth: boolean;
  version?: string;
  executablePath?: string;
  models: Array<{ id: string; label: string }>;
  error?: string;
  complianceNotice?: string;
}

export interface PageContext {
  tabId: string;
  title: string;
  url: string;
  selection: string;
  text: string;
  capturedAt: string;
}

export interface AgentRunRequest {
  providerId: ProviderId;
  model: string;
  mode: AgentMode;
  prompt: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  pageContext?: PageContext;
}

export interface AgentRunResult {
  sessionId: string;
  state: 'completed' | 'failed';
  answer?: string;
  error?: string;
  durationMs: number;
  logDirectory: string;
  route?: SkillRoute;
}

export interface LocalDataStatus {
  root: string;
  sessionsRoot: string;
}

export interface AppSettings {
  schemaVersion: 1;
  general: {
    guard: boolean;
    localLogs: boolean;
    compact: boolean;
  };
  mcpEnabled: Record<string, boolean>;
  skillEnabled: Record<string, boolean>;
}

export interface XgenSideApi {
  engine: {
    status(): Promise<EngineStatus>;
  };
  browser: {
    listTabs(): Promise<BrowserTabState[]>;
    newTab(url?: string): Promise<BrowserTabState[]>;
    activateTab(id: string): Promise<BrowserTabState[]>;
    closeTab(id: string): Promise<BrowserTabState[]>;
    navigate(input: string): Promise<BrowserTabState[]>;
    back(): Promise<BrowserTabState[]>;
    forward(): Promise<BrowserTabState[]>;
    reload(): Promise<BrowserTabState[]>;
    setLayout(layout: BrowserLayoutState): Promise<void>;
    getPageContext(): Promise<PageContext | undefined>;
    onTabsChanged(listener: (tabs: BrowserTabState[]) => void): () => void;
  };
  providers: {
    list(): Promise<ProviderStatus[]>;
    authenticate(id: ProviderId): Promise<{ launched: boolean; message: string }>;
  };
  agent: {
    run(request: AgentRunRequest): Promise<AgentRunResult>;
  };
  skills: {
    route(request: AgentRunRequest): Promise<SkillRoute>;
  };
  localData: {
    status(): Promise<LocalDataStatus>;
    open(): Promise<string>;
  };
  settings: {
    load(): Promise<AppSettings>;
    save(settings: AppSettings): Promise<AppSettings>;
  };
  command: {
    run(request: CommandRequest): Promise<CommandResult>;
    approve(token: string): Promise<CommandResult>;
  };
}
