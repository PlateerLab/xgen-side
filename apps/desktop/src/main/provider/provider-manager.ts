import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type {
  AgentPermissionMode,
  AgentRunEvent,
  AgentRunRequest,
  AgentRunResult,
  BrowserAgentStatus,
  BrowserHistoryEntry,
  BrowserSnapshot,
  BrowserTabState,
  ProviderId,
  ProviderStatus,
  SkillCatalogEntry,
  SkillRoute,
} from '../../shared/contracts';
import { AgentBrowserClient } from '../engine/agent-browser-client';
import { XgenCoreClient } from '../core/xgen-core-client';
import { LocalRunStore, type RunSession } from '../storage/local-run-store';
import { BrowserApprovalBroker } from '../security/browser-approval-broker';
import { CredentialBroker } from '../security/credential-broker';
import { LocalSettingsStore } from '../storage/local-settings-store';
import { SkillRouter } from '../skills/skill-router';
import { ClaudeCodeAdapter } from './claude-code-adapter';
import { CodexAdapter, codexCompatibilityError } from './codex-adapter';
import type { BrowserBridge, ProviderAdapter } from './provider-adapter';
import { collect } from './provider-runtime';
import { safeEnvironment } from './provider-runtime';
import { allowConfirmedAction, browserActionPolicy } from './browser-action-policy';
import { buildPrompt } from './provider-prompt';

const runTimeoutMs = 15 * 60_000;
const modelIdPattern = /^[A-Za-z0-9._:-]{1,100}$/;

export interface AgentRunOptions {
  runId?: string;
  signal?: AbortSignal;
  onEvent?(event: AgentRunEvent): void;
}

export interface PreparedBrowserTarget {
  tab: BrowserTabState;
  targetId?: string;
}

export class ProviderManager {
  private readonly adapters: ReadonlyMap<ProviderId, ProviderAdapter>;
  private readonly skillRouter: SkillRouter;

  constructor(
    private readonly store: LocalRunStore,
    private readonly browserEngine: AgentBrowserClient,
    private readonly coreClient: XgenCoreClient,
    private readonly settingsStore: LocalSettingsStore,
    private readonly resourceRoot: string,
    private readonly openLocalPath: (path: string) => Promise<string>,
    private readonly openBrowserCdp?: (tabId: string, runId: string) => Promise<string>,
    private readonly closeBrowserCdp?: (runId: string) => Promise<void>,
    private readonly browserHistorySince: (sinceMs: number, tabId?: string) => BrowserHistoryEntry[] = () => [],
    private readonly captureBrowserSnapshot: (reason: string, tabId?: string) => Promise<BrowserSnapshot | undefined> = async () => undefined,
    private readonly prepareBrowserTarget: (runId: string, request: AgentRunRequest, route: SkillRoute) => Promise<PreparedBrowserTarget> = async () => {
      throw new Error('브라우저 작업 탭을 준비할 수 없습니다.');
    },
    private readonly updateBrowserRunStatus: (runId: string, status: BrowserAgentStatus) => void = () => undefined,
    private readonly approvalBroker?: BrowserApprovalBroker,
    private readonly credentialBroker?: CredentialBroker,
  ) {
    const adapters: ProviderAdapter[] = [
      new CodexAdapter(store),
      new ClaudeCodeAdapter(store),
    ];
    this.adapters = new Map(adapters.map((adapter) => [adapter.id, adapter]));
    this.skillRouter = new SkillRouter(settingsStore);
  }

  async list(): Promise<ProviderStatus[]> {
    await this.store.initialize();
    return Promise.all([...this.adapters.values()].map((adapter) => adapter.getStatus()));
  }

  authenticate(id: ProviderId): Promise<{ launched: boolean; message: string }> {
    return this.adapter(id).authenticate();
  }

  previewRoute(request: AgentRunRequest): Promise<SkillRoute> {
    validateRunRequest(request);
    return this.skillRouter.route(request);
  }

  listSkills(): SkillCatalogEntry[] {
    return this.skillRouter.list();
  }

  async run(request: AgentRunRequest, options: AgentRunOptions = {}): Promise<AgentRunResult> {
    validateRunRequest(request);
    const adapter = this.adapter(request.providerId);
    const session = await this.store.createSession(request);
    const attachments = await this.store.materializeAttachments(session, request.attachments);
    const runId = options.runId ?? session.id;
    let eventWrites = Promise.resolve();
    const now = (): string => new Date().toISOString();
    const publish = (event: AgentRunEvent): void => {
      options.onEvent?.(event);
      const payload = event.type === 'text'
        ? { mode: event.mode, characters: event.text.length }
        : { ...event };
      eventWrites = eventWrites.then(() => this.store.append(
        session,
        `stream.${event.type}`,
        request.providerId,
        request.mode,
        payload,
      ));
    };
    publish({ type: 'run-started', sessionId: session.id, at: now() });
    const route = await this.skillRouter.route(request);
    let effectiveRequest: AgentRunRequest = {
      ...request,
      mode: route.resolvedMode,
      reasoningEffort: resolveReasoningEffort(request, route),
    };
    await this.store.append(session, 'skills.routed', request.providerId, request.mode, {
      routeId: route.id,
      reason: route.reason,
      skills: route.skills.map((skill) => ({ id: skill.id, settingKey: skill.settingKey, risk: skill.risk })),
      browserVisible: route.browserVisible,
      agentBrowserRequired: route.agentBrowserRequired,
      browserActionCategories: route.browserActionCategories,
      blockedReason: route.blockedReason,
    });
    publish({ type: 'skills-routed', sessionId: session.id, at: now(), route });
    if (route.blockedReason) {
      await this.store.append(session, 'provider.blocked', request.providerId, request.mode, { reason: route.blockedReason });
      const blockedResult: AgentRunResult = {
        sessionId: session.id,
        state: 'failed',
        error: route.blockedReason,
        durationMs: 0,
        logDirectory: session.directory,
        route,
      };
      publish({ type: 'run-finished', sessionId: session.id, at: now(), state: blockedResult.state, durationMs: 0, error: blockedResult.error });
      await this.store.writeBrowserAgentMemory(session, request, blockedResult, route, this.browserHistorySince(session.startedAt));
      await eventWrites;
      return blockedResult;
    }
    const browserTarget = route.agentBrowserRequired
      ? await this.prepareBrowserTarget(runId, effectiveRequest, route)
      : undefined;
    if (browserTarget) {
      publish({ type: 'browser-tab-attached', sessionId: session.id, at: now(), tab: browserTarget.tab });
    }
    const browser = browserTarget
      ? await this.prepareBrowserBridge(session, route, browserTarget, runId, effectiveRequest.permissionMode ?? 'guard', publish)
      : undefined;
    const plan = await adapter.prepareRun(effectiveRequest, session, browser);
    const prompt = buildPrompt(effectiveRequest, route, this.skillRouter.instructionsFor(route), browser, attachments);

    await this.store.append(session, 'provider.started', request.providerId, request.mode, {
      executable: basename(plan.executable.path),
      version: plan.executable.version,
      sandbox: plan.sandbox,
    });
    publish({
      type: 'provider-started',
      sessionId: session.id,
      at: now(),
      providerId: request.providerId,
      model: request.model,
      sandbox: plan.sandbox,
    });
    for (const attachment of attachments) {
      publish({
        type: 'activity',
        sessionId: session.id,
        at: now(),
        name: `Read ${attachment.name}`,
        phase: 'started',
        detail: `${attachment.kind.toUpperCase()} · ${attachment.size} bytes`,
      });
    }

    let snapshotSequence = Promise.resolve();
    let lastSnapshotImage = '';
    const publishSnapshot = (reason: string): void => {
      if (!route.browserVisible) return;
      snapshotSequence = snapshotSequence.then(async () => {
        const snapshot = await this.captureBrowserSnapshot(reason, browser?.tabId);
        if (snapshot && snapshot.imageDataUrl !== lastSnapshotImage) {
          lastSnapshotImage = snapshot.imageDataUrl;
          publish({ type: 'browser-snapshot', sessionId: session.id, at: now(), snapshot });
        }
      }).catch(() => undefined);
    };
    const startedAt = Date.now();
    const result = await collect(
      plan.executable.path,
      plan.args,
      session.workspace,
      prompt,
      runTimeoutMs,
      plan.env,
      {
        signal: options.signal,
        stopAfterStdoutLine: adapter.isStreamComplete?.bind(adapter),
        onStdoutLine: (line) => {
          for (const event of adapter.parseStreamLine(line)) {
            if (event.type === 'text') {
              publish({ type: 'text', sessionId: session.id, at: now(), text: event.text, mode: event.mode });
            } else {
              publish({
                type: 'activity',
                sessionId: session.id,
                at: now(),
                name: event.name,
                phase: event.phase,
                detail: event.detail,
              });
              if (event.phase === 'completed' && /agent_browser_(?:snapshot|screenshot|open|click|auth_login)$/.test(event.name)) {
                publishSnapshot(event.name);
              }
            }
          }
        },
      },
    );
    if (browser) await this.releaseBrowserRun(runId);
    const durationMs = Date.now() - startedAt;
    publishSnapshot('브라우저 작업 결과');
    await snapshotSequence;
    await this.store.writeProviderOutput(session, result.stdout, result.stderr);
    const answer = adapter.parseAnswer(result.stdout);
    const state: AgentRunResult['state'] = result.cancelled ? 'cancelled' : result.exitCode === 0 ? 'completed' : 'failed';
    const error = state === 'completed'
      ? undefined
      : state === 'cancelled'
        ? '사용자가 실행을 중지했습니다.'
        : providerFailureMessage(request.providerId, result.stderr);
    for (const attachment of attachments) {
      publish({
        type: 'activity',
        sessionId: session.id,
        at: now(),
        name: `Read ${attachment.name}`,
        phase: state === 'completed' ? 'completed' : 'failed',
      });
    }
    await this.store.append(session, `provider.${state}`, request.providerId, request.mode, {
      exitCode: result.exitCode,
      durationMs,
      answerCharacters: answer.length,
      error,
    });
    const artifacts = await this.store.collectArtifacts(session);
    const runResult: AgentRunResult = {
      sessionId: session.id,
      state,
      answer: answer || undefined,
      error,
      durationMs,
      logDirectory: session.directory,
      route,
      browserTabId: browser?.tabId,
      artifacts,
    };
    this.updateBrowserRunStatus(runId, state);
    publish({ type: 'run-finished', sessionId: session.id, at: now(), state, durationMs, error });
    await this.store.writeBrowserAgentMemory(session, request, runResult, route, this.browserHistorySince(session.startedAt, browser?.tabId));
    await eventWrites;
    return runResult;
  }

  async openLocalData(): Promise<string> {
    await this.store.initialize();
    return this.openLocalPath(this.store.status().root);
  }

  async releaseBrowserRun(runId: string): Promise<void> {
    await this.coreClient.stopBrowserRelay(runId).catch(() => undefined);
    await this.closeBrowserCdp?.(runId).catch(() => undefined);
  }

  private adapter(id: ProviderId): ProviderAdapter {
    const adapter = this.adapters.get(id);
    if (!adapter) throw new Error(`지원하지 않는 provider입니다: ${id}`);
    return adapter;
  }

  private async prepareBrowserBridge(
    session: RunSession,
    route: SkillRoute,
    target: PreparedBrowserTarget,
    runId: string,
    permissionMode: AgentPermissionMode,
    publish: (event: AgentRunEvent) => void,
  ): Promise<BrowserBridge> {
    if (!this.openBrowserCdp) throw new Error('브라우저 자동화 gateway를 사용할 수 없습니다.');
    const engine = await this.browserEngine.status();
    if (!engine.available || !engine.executablePath) {
      throw new Error(engine.error || 'agent-browser 엔진을 찾지 못했습니다.');
    }
    const policyPath = join(session.directory, 'browser-policy.json');
    const selectedTools = route.skills.flatMap((skill) => skill.runtime.tools ?? []);
    const settings = await this.settingsStore.load();
    const policy = browserActionPolicy(selectedTools, settings.browserPermissions, permissionMode);
    allowConfirmedAction(policy, 'plugin:xgen-tab:browser.provider');
    const usesXgenCredentialVault = route.skills.some((skill) => skill.id === 'xgen.login-assistant');
    const credentialAccessEnabled = usesXgenCredentialVault && permissionMode !== 'read-only';
    if (credentialAccessEnabled) {
      const credentialAction = 'plugin:xgen-vault:credential.inject';
      allowConfirmedAction(policy, credentialAction);
      if (selectedTools.includes('agent_browser_click')) allowConfirmedAction(policy, 'click');
      allowConfirmedAction(policy, 'auth_login');
    }
    await writeFile(policyPath, JSON.stringify(policy, null, 2), 'utf8');
    const approval = policy.confirm.length && this.approvalBroker
      ? this.approvalBroker.registerRun(runId, (request) => publish({
        type: 'approval-required',
        sessionId: session.id,
        at: new Date().toISOString(),
        approvalId: request.id,
        action: request.action,
        detail: request.detail,
      }))
      : undefined;
    const credential = credentialAccessEnabled && this.credentialBroker
      ? this.credentialBroker.registerRun(runId, target.tab.id, (request) => publish({
        type: 'approval-required',
        sessionId: session.id,
        at: new Date().toISOString(),
        approvalId: request.id,
        action: request.action,
        detail: request.detail,
      }))
      : undefined;
    const credentialPluginPath = join(this.resourceRoot, 'xgen-credential-plugin.cjs');
    const browserProviderPath = join(this.resourceRoot, 'xgen-browser-provider.cjs');
    const toolProfiles = [...new Set(route.skills.flatMap((skill) => skill.runtime.toolProfiles ?? []))];
    const browserSession = `xg-${createHash('sha256').update(runId).digest('hex').slice(0, 12)}`;
    const browserSocketDirectory = process.platform === 'darwin'
      ? `/tmp/xgen-ab-${typeof process.getuid === 'function' ? process.getuid() : 'user'}`
      : join(tmpdir(), 'xgen-ab');
    const plugins = [{
      name: 'xgen-tab',
      command: process.execPath,
      args: [browserProviderPath],
      capabilities: ['browser.provider'],
    }, ...(credential ? [{
      name: 'xgen-vault',
      command: process.execPath,
      args: [credentialPluginPath],
      capabilities: ['credential.inject'],
    }] : [])];
    const engineEnvironment = definedEnvironment(safeEnvironment({
      ELECTRON_RUN_AS_NODE: '1',
      AGENT_BROWSER_PROVIDER: 'xgen-tab',
      AGENT_BROWSER_PLUGINS: JSON.stringify(plugins),
      XGEN_PRIVATE_CDP_URL: await this.openBrowserCdp(target.tab.id, runId),
      AGENT_BROWSER_CONTENT_BOUNDARIES: '1',
      AGENT_BROWSER_MAX_OUTPUT: '50000',
      AGENT_BROWSER_IDLE_TIMEOUT_MS: '5000',
      AGENT_BROWSER_SOCKET_DIR: browserSocketDirectory,
      AGENT_BROWSER_ACTION_POLICY: policyPath,
      AGENT_BROWSER_NAMESPACE: browserSession,
      AGENT_BROWSER_SESSION: browserSession,
      ...(approval ? { XGEN_APPROVAL_BROKER: approval.address, XGEN_APPROVAL_TOKEN: approval.token, XGEN_APPROVAL_RUN_ID: runId } : {}),
      ...(credential ? {
        XGEN_CREDENTIAL_BROKER: credential.address,
        XGEN_CREDENTIAL_TOKEN: credential.token,
        XGEN_CREDENTIAL_RUN_ID: runId,
      } : {}),
    }));
    const relay = await this.coreClient.startBrowserRelay({
      runId,
      enginePath: engine.executablePath,
      toolProfiles: toolProfiles.length ? toolProfiles : ['core'],
      environment: engineEnvironment,
    });
    const relayBridgePath = join(this.resourceRoot, 'xgen-mcp-bridge.cjs');
    return {
      executablePath: process.execPath,
      args: [relayBridgePath],
      environment: {
        ELECTRON_RUN_AS_NODE: '1',
        XGEN_CORE_MCP_ADDRESS: relay.address,
        XGEN_CORE_MCP_TOKEN: relay.token,
      },
      toolProfiles,
      tabId: target.tab.id,
      targetId: target.targetId,
    };
  }
}

function definedEnvironment(environment: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(environment).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

function providerFailureMessage(providerId: ProviderId, stderr: string): string {
  const detail = stderr.trim();
  if (providerId === 'codex') {
    const compatibilityError = codexCompatibilityError(detail);
    if (compatibilityError) return compatibilityError;
  }
  if (providerId === 'codex' && /401 Unauthorized|Missing bearer|no Codex credentials|not logged in/i.test(detail)) {
    return 'Codex 인증 정보가 없거나 만료되었습니다. Settings > AI Providers에서 구독 연결을 다시 실행하세요.';
  }
  if (!detail) return `${providerId === 'codex' ? 'Codex' : 'Claude Code'} 실행에 실패했습니다.`;
  return detail.length > 2_000 ? `${detail.slice(0, 2_000)}\n...` : detail;
}

function validateRunRequest(request: AgentRunRequest): void {
  if (!request || !['codex', 'claude'].includes(request.providerId)) throw new Error('지원하지 않는 provider입니다.');
  if (!['auto', 'chat', 'search', 'page', 'browser-agent'].includes(request.mode)) throw new Error('지원하지 않는 실행 모드입니다.');
  if (request.reasoningEffort && !['auto', 'low', 'medium', 'high', 'xhigh'].includes(request.reasoningEffort)) throw new Error('지원하지 않는 추론 강도입니다.');
  if (request.sourceSurface && !['chat', 'browser-side'].includes(request.sourceSurface)) throw new Error('지원하지 않는 실행 화면입니다.');
  if (request.browserTarget && !['new-agent-tab', 'current-tab'].includes(request.browserTarget)) throw new Error('지원하지 않는 브라우저 대상입니다.');
  if (request.permissionMode && !['read-only', 'guard', 'full-access'].includes(request.permissionMode)) throw new Error('지원하지 않는 권한 모드입니다.');
  if (request.selectedSkillIds && (request.selectedSkillIds.length > 12 || request.selectedSkillIds.some((id) => !modelIdPattern.test(id)))) {
    throw new Error('선택한 Skill 식별자가 올바르지 않습니다.');
  }
  if (!modelIdPattern.test(request.model)) throw new Error('지원하지 않는 모델 식별자입니다.');
  if (typeof request.prompt !== 'string' || !request.prompt.trim() || request.prompt.length > 100_000) {
    throw new Error('프롬프트는 1자 이상 100,000자 이하여야 합니다.');
  }
  if (request.history && (request.history.length > 100 || request.history.some((message) => !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string' || message.content.length > 100_000))) {
    throw new Error('대화 기록 형식이 올바르지 않거나 너무 큽니다.');
  }
  if (request.attachments && (request.attachments.length > 10 || request.attachments.some((attachment) => (
    !/^[a-f0-9-]{36}$/i.test(attachment.id)
    || typeof attachment.name !== 'string'
    || attachment.name.length > 180
    || !['docx', 'xlsx', 'pptx', 'pdf'].includes(attachment.kind)
    || !Number.isSafeInteger(attachment.size)
    || attachment.size < 1
    || attachment.size > 50 * 1024 * 1024
  )))) {
    throw new Error('첨부 파일 형식이 올바르지 않거나 허용 크기를 초과했습니다.');
  }
  if (request.attachments?.length && !['auto', 'chat'].includes(request.mode)) {
    throw new Error('파일 첨부는 일반 채팅 또는 Auto 모드에서만 실행할 수 있습니다.');
  }
  if (request.mode === 'page' && !request.pageContext) {
    throw new Error('현재 페이지 컨텍스트가 필요합니다.');
  }
}

function resolveReasoningEffort(request: AgentRunRequest, route: SkillRoute): 'low' | 'medium' | 'high' | 'xhigh' {
  if (request.reasoningEffort && request.reasoningEffort !== 'auto') return request.reasoningEffort;
  if (route.resolvedMode === 'browser-agent') return 'high';
  if (route.skills.some((skill) => skill.id === 'xgen.multi-page-research')) return 'high';
  if (route.resolvedMode === 'search') return 'low';
  if (route.resolvedMode === 'page') return 'medium';
  return request.prompt.length > 1_200 ? 'medium' : 'low';
}
