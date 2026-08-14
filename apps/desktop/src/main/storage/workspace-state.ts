import type {
  BrowserActionCategory,
  BrowserSnapshot,
  PersistedChatMessage,
  PersistedChatSession,
  PersistedRunActivity,
  PersistedRunOverview,
  RoutedSkill,
  SkillRoute,
  SkillRouteStep,
  PersistedWorkspaceState,
  LocalAttachment,
  LocalArtifact,
} from '../../shared/contracts';

export const defaultWorkspaceState: PersistedWorkspaceState = {
  schemaVersion: 1,
  activeChatId: 'new-chat',
  chats: [{ id: 'new-chat', title: 'New Chat', time: '' }],
  chatMessages: { 'new-chat': [] },
  browser: { urls: ['about:blank'], activeIndex: 0 },
};

export function sanitizeWorkspaceState(value: unknown): PersistedWorkspaceState {
  const input = isRecord(value) ? value : {};
  const rawChats = Array.isArray(input.chats) ? input.chats : [];
  const chats = rawChats.map(sanitizeChat).filter((chat): chat is PersistedChatSession => Boolean(chat)).slice(0, 500);
  if (!chats.length) chats.push(structuredClone(defaultWorkspaceState.chats[0]!));
  const chatIds = new Set(chats.map((chat) => chat.id));
  const rawMessages = isRecord(input.chatMessages) ? input.chatMessages : {};
  const chatMessages: Record<string, PersistedChatMessage[]> = {};
  for (const chat of chats) {
    const rawChatMessages = rawMessages[chat.id];
    const messages: unknown[] = Array.isArray(rawChatMessages) ? rawChatMessages : [];
    chatMessages[chat.id] = messages.map(sanitizeMessage).filter((message): message is PersistedChatMessage => Boolean(message)).slice(-2_000);
  }
  const browserInput = isRecord(input.browser) ? input.browser : {};
  const urls = (Array.isArray(browserInput.urls) ? browserInput.urls : [])
    .filter((url): url is string => typeof url === 'string' && isRestorableUrl(url))
    .slice(0, 50);
  if (!urls.length) urls.push('about:blank');
  const activeIndex = typeof browserInput.activeIndex === 'number' && Number.isInteger(browserInput.activeIndex)
    ? Math.min(Math.max(browserInput.activeIndex, 0), urls.length - 1)
    : 0;
  const activeChatId = typeof input.activeChatId === 'string' && chatIds.has(input.activeChatId)
    ? input.activeChatId
    : chats[0]!.id;
  return { schemaVersion: 1, activeChatId, chats, chatMessages, browser: { urls, activeIndex } };
}

export function isRestorableUrl(url: string): boolean {
  if (url === 'about:blank') return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function sanitizeChat(value: unknown): PersistedChatSession | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || !/^[A-Za-z0-9._:-]{1,160}$/.test(value.id)) return undefined;
  const title = typeof value.title === 'string' ? value.title.replace(/\s+/g, ' ').trim().slice(0, 160) : '';
  return { id: value.id, title: title || 'New Chat', time: typeof value.time === 'string' ? value.time.slice(0, 40) : '' };
}

function sanitizeMessage(value: unknown): PersistedChatMessage | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || !/^[A-Za-z0-9._:-]{1,160}$/.test(value.id)) return undefined;
  if (value.role !== 'user' && value.role !== 'assistant') return undefined;
  if (typeof value.content !== 'string') return undefined;
  return {
    id: value.id,
    role: value.role,
    content: value.content.slice(0, 1_000_000),
    meta: typeof value.meta === 'string' ? value.meta.slice(0, 1_000) : undefined,
    overview: sanitizeOverview(value.overview),
    attachments: Array.isArray(value.attachments)
      ? value.attachments.map(sanitizeAttachment).filter((item): item is LocalAttachment => Boolean(item)).slice(0, 10)
      : undefined,
    artifacts: Array.isArray(value.artifacts)
      ? value.artifacts.map(sanitizeArtifact).filter((item): item is LocalArtifact => Boolean(item)).slice(0, 20)
      : undefined,
  };
}

function sanitizeAttachment(value: unknown): LocalAttachment | undefined {
  if (!isRecord(value) || !validOpaqueId(value.id) || typeof value.name !== 'string') return undefined;
  const kind = fileKind(value.kind);
  const size = positiveNumber(value.size);
  if (!kind || size === undefined || size > 50 * 1024 * 1024) return undefined;
  return { id: value.id, name: value.name.slice(0, 180), kind, size };
}

function sanitizeArtifact(value: unknown): LocalArtifact | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || !validOpaqueId(value.sessionId) || typeof value.name !== 'string') return undefined;
  const kind = fileKind(value.kind);
  const size = positiveNumber(value.size);
  if (!kind || size === undefined || size > 100 * 1024 * 1024 || !safeArtifactRelativePath(value.relativePath)) return undefined;
  return { id: value.id.slice(0, 400), sessionId: value.sessionId, name: value.name.slice(0, 180), kind, relativePath: value.relativePath, size };
}

function safeArtifactRelativePath(value: unknown): value is string {
  if (typeof value !== 'string' || !value.startsWith('artifacts/')) return false;
  const name = value.slice('artifacts/'.length);
  return name.length >= 1
    && name.length <= 200
    && name !== '.'
    && name !== '..'
    && !/[\\/\u0000-\u001f]/.test(name);
}

function sanitizeOverview(value: unknown): PersistedRunOverview | undefined {
  if (!isRecord(value)) return undefined;
  const route = sanitizeRoute(value.route);
  const status = ['running', 'completed', 'failed', 'cancelled'].includes(String(value.status))
    ? value.status as PersistedRunOverview['status']
    : undefined;
  if (!route || !status || typeof value.prompt !== 'string') return undefined;
  const authState = ['preparing', 'approval', 'device', 'qr-device', 'verifying'].includes(String(value.authState))
    ? value.authState as PersistedRunOverview['authState']
    : undefined;
  return {
    sessionId: shortText(value.sessionId, 160),
    browserTabId: shortText(value.browserTabId, 160),
    route,
    status: status === 'running' ? 'cancelled' : status,
    prompt: value.prompt.slice(0, 20_000),
    activity: shortText(value.activity, 2_000),
    startedAt: shortText(value.startedAt, 80),
    durationMs: positiveNumber(value.durationMs),
    authState,
    activities: Array.isArray(value.activities)
      ? value.activities.map(sanitizeActivity).filter((item): item is PersistedRunActivity => Boolean(item)).slice(-500)
      : undefined,
    snapshots: Array.isArray(value.snapshots)
      ? value.snapshots.map(sanitizeSnapshot).filter((item): item is BrowserSnapshot => Boolean(item)).slice(-8)
      : undefined,
  };
}

function sanitizeRoute(value: unknown): SkillRoute | undefined {
  if (!isRecord(value) || typeof value.id !== 'string') return undefined;
  const resolvedMode = ['chat', 'search', 'page', 'browser-agent'].includes(String(value.resolvedMode))
    ? value.resolvedMode as SkillRoute['resolvedMode']
    : undefined;
  if (!resolvedMode) return undefined;
  return {
    id: value.id.slice(0, 160),
    resolvedMode,
    reason: typeof value.reason === 'string' ? value.reason.slice(0, 4_000) : '',
    browserVisible: Boolean(value.browserVisible),
    agentBrowserRequired: Boolean(value.agentBrowserRequired),
    targetUrl: shortText(value.targetUrl, 4_000),
    targetHost: shortText(value.targetHost, 500),
    browserActionCategories: Array.isArray(value.browserActionCategories)
      ? value.browserActionCategories.filter(isBrowserActionCategory).slice(0, 50)
      : [],
    skills: Array.isArray(value.skills)
      ? value.skills.map(sanitizeRoutedSkill).filter((item): item is RoutedSkill => Boolean(item)).slice(0, 50)
      : [],
    steps: Array.isArray(value.steps)
      ? value.steps.map(sanitizeRouteStep).filter((item): item is SkillRouteStep => Boolean(item)).slice(0, 100)
      : [],
    blockedReason: shortText(value.blockedReason, 4_000),
  };
}

function sanitizeRoutedSkill(value: unknown): RoutedSkill | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') return undefined;
  const risk = ['read', 'write', 'consequential'].includes(String(value.risk)) ? value.risk as RoutedSkill['risk'] : 'read';
  const runtime = isRecord(value.runtime) ? value.runtime : {};
  const permissions = isRecord(value.permissions) ? value.permissions : {};
  const progress = isRecord(value.progress) ? value.progress : {};
  const kind = ['llm', 'provider-web', 'page-context', 'agent-browser', 'policy'].includes(String(runtime.kind))
    ? runtime.kind as RoutedSkill['runtime']['kind']
    : 'llm';
  return {
    id: value.id.slice(0, 160),
    settingKey: shortText(value.settingKey, 160) ?? value.id.slice(0, 160),
    name: value.name.slice(0, 300),
    description: shortText(value.description, 2_000) ?? '',
    domain: shortText(value.domain, 300) ?? '',
    risk,
    runtime: {
      kind,
      capability: shortText(runtime.capability, 300) ?? '',
      adapter: shortText(runtime.adapter, 300),
      server: shortText(runtime.server, 300),
      toolProfiles: stringArray(runtime.toolProfiles, 100, 300),
      tools: stringArray(runtime.tools, 500, 300),
    },
    permissions: {
      risk,
      allowActions: stringArray(permissions.allowActions, 500, 300),
      confirmActions: stringArray(permissions.confirmActions, 500, 300),
      denyActions: stringArray(permissions.denyActions, 500, 300),
    },
    progress: {
      label: shortText(progress.label, 300) ?? '',
      detail: shortText(progress.detail, 2_000) ?? '',
    },
  };
}

function sanitizeRouteStep(value: unknown): SkillRouteStep | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.label !== 'string') return undefined;
  const kind = ['route', 'research', 'page', 'browser', 'interaction', 'extract', 'guard', 'auth', 'result'].includes(String(value.kind))
    ? value.kind as SkillRouteStep['kind']
    : 'route';
  return { id: value.id.slice(0, 160), label: value.label.slice(0, 500), detail: shortText(value.detail, 2_000) ?? '', kind };
}

function sanitizeActivity(value: unknown): PersistedRunActivity | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') return undefined;
  const phase = ['started', 'updated', 'completed', 'failed'].includes(String(value.phase))
    ? value.phase as PersistedRunActivity['phase']
    : undefined;
  if (!phase) return undefined;
  return {
    id: value.id.slice(0, 160),
    name: value.name.slice(0, 500),
    phase,
    detail: shortText(value.detail, 4_000),
    startedAt: shortText(value.startedAt, 80),
    durationMs: positiveNumber(value.durationMs),
  };
}

function sanitizeSnapshot(value: unknown): BrowserSnapshot | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.imageDataUrl !== 'string') return undefined;
  if (!/^data:image\/(?:png|jpeg|webp);base64,/.test(value.imageDataUrl) || value.imageDataUrl.length > 12_000_000) return undefined;
  const url = shortText(value.url, 4_000) ?? '';
  const reason = shortText(value.reason, 2_000) ?? '';
  if (/(?:login|signin|auth|passkey|qrcode)/i.test(url) && !reason.startsWith('보호된 로그인 화면 상단 · ')) return undefined;
  return {
    id: value.id.slice(0, 160),
    tabId: shortText(value.tabId, 160) ?? '',
    title: shortText(value.title, 500) ?? '',
    url,
    capturedAt: shortText(value.capturedAt, 80) ?? '',
    reason,
    imageDataUrl: value.imageDataUrl,
  };
}

function shortText(value: unknown, limit: number): string | undefined {
  return typeof value === 'string' ? value.slice(0, limit) : undefined;
}

function stringArray(value: unknown, count: number, limit: number): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, count).map((item) => item.slice(0, limit)) : [];
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function isBrowserActionCategory(value: unknown): value is BrowserActionCategory {
  return typeof value === 'string' && ['navigate', 'click', 'fill', 'eval', 'download', 'upload', 'snapshot', 'scroll', 'wait', 'read', 'get', 'interact', 'network', 'state'].includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validOpaqueId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9-]{36}$/i.test(value);
}

function fileKind(value: unknown): LocalAttachment['kind'] | undefined {
  return ['docx', 'xlsx', 'pptx', 'pdf'].includes(String(value)) ? value as LocalAttachment['kind'] : undefined;
}
