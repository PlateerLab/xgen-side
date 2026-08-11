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
  placement?: 'workspace' | 'right-dock';
  dockInset?: number;
}

export interface BrowserHistoryEntry {
  tabId: string;
  title: string;
  url: string;
  visitedAt: string;
  visitedAtMs: number;
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
export type ResolvedAgentMode = 'chat' | 'search' | 'page' | 'browser-agent';
export type AgentMode = 'auto' | ResolvedAgentMode;
export type ReasoningEffort = 'auto' | 'low' | 'medium' | 'high' | 'xhigh';
export type BrowserActionCategory = 'navigate' | 'click' | 'fill' | 'eval' | 'download' | 'upload' | 'snapshot' | 'scroll' | 'wait' | 'read' | 'get' | 'interact' | 'network' | 'state';

export type SkillRuntimeKind = 'llm' | 'provider-web' | 'page-context' | 'agent-browser' | 'policy';

export interface SkillRuntimeDescriptor {
  kind: SkillRuntimeKind;
  capability: string;
  adapter?: string;
  server?: string;
  toolProfiles?: string[];
  tools: string[];
}

export interface SkillPermissionDescriptor {
  risk: 'read' | 'write' | 'consequential';
  allowActions: string[];
  confirmActions: string[];
  denyActions: string[];
}

export interface SkillProgressDescriptor {
  label: string;
  detail: string;
}

export interface SkillCatalogEntry {
  id: string;
  settingKey: string;
  name: string;
  description: string;
  category: string;
  domain: string;
  enabledByDefault: boolean;
  source: string;
  markdown: string;
  runtime: SkillRuntimeDescriptor;
  permissions: SkillPermissionDescriptor;
  progress: SkillProgressDescriptor;
}

export interface RoutedSkill {
  id: string;
  settingKey: string;
  name: string;
  description: string;
  domain: string;
  risk: 'read' | 'write' | 'consequential';
  runtime: SkillRuntimeDescriptor;
  permissions: SkillPermissionDescriptor;
  progress: SkillProgressDescriptor;
}

export interface SkillRouteStep {
  id: string;
  label: string;
  detail: string;
  kind: 'route' | 'research' | 'page' | 'browser' | 'interaction' | 'extract' | 'guard' | 'result';
}

export interface SkillRoute {
  id: string;
  resolvedMode: ResolvedAgentMode;
  reason: string;
  browserVisible: boolean;
  agentBrowserRequired: boolean;
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
  supportsReasoningEffort?: boolean;
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
  reasoningEffort?: ReasoningEffort;
  prompt: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  pageContext?: PageContext;
}

export interface AgentRunResult {
  sessionId: string;
  state: 'completed' | 'failed' | 'cancelled';
  answer?: string;
  error?: string;
  durationMs: number;
  logDirectory: string;
  route?: SkillRoute;
}

export interface BrowserSnapshot {
  id: string;
  tabId: string;
  title: string;
  url: string;
  capturedAt: string;
  reason: string;
  imageDataUrl: string;
}

export type AgentRunEvent =
  | { type: 'run-started'; sessionId: string; at: string }
  | { type: 'skills-routed'; sessionId: string; at: string; route: SkillRoute }
  | { type: 'provider-started'; sessionId: string; at: string; providerId: ProviderId; model: string; sandbox: string }
  | { type: 'text'; sessionId: string; at: string; text: string; mode: 'append' | 'replace' }
  | { type: 'activity'; sessionId: string; at: string; name: string; phase: 'started' | 'updated' | 'completed' | 'failed'; detail?: string }
  | { type: 'browser-snapshot'; sessionId: string; at: string; snapshot: BrowserSnapshot }
  | { type: 'run-finished'; sessionId: string; at: string; state: AgentRunResult['state']; durationMs: number; error?: string };

export interface AgentRunHandle {
  id: string;
  result: Promise<AgentRunResult>;
  cancel(): Promise<boolean>;
}

export interface LocalDataStatus {
  root: string;
  sessionsRoot: string;
  memoryRoot: string;
}

export interface LocalMarkdownFile {
  id: string;
  name: string;
  relativePath: string;
  category: 'browser-history' | 'task-results' | 'root';
  updatedAt: string;
  size: number;
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
    start(request: AgentRunRequest, listener?: (event: AgentRunEvent) => void): AgentRunHandle;
  };
  skills: {
    list(): Promise<SkillCatalogEntry[]>;
    route(request: AgentRunRequest): Promise<SkillRoute>;
  };
  localData: {
    status(): Promise<LocalDataStatus>;
    open(): Promise<string>;
    listMarkdown(): Promise<LocalMarkdownFile[]>;
    readMarkdown(relativePath: string): Promise<string>;
    writeMarkdown(relativePath: string, content: string): Promise<void>;
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
