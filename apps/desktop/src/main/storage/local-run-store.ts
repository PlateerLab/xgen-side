import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app } from 'electron';
import type { AgentMode, AgentRunRequest, CommandRequest, CommandResult, LocalDataStatus, ProviderId } from '../../shared/contracts';

export interface RunSession {
  id: string;
  directory: string;
  eventsPath: string;
  workspace: string;
  startedAt: number;
}

interface RunEvent {
  schemaVersion: 1;
  id: string;
  sessionId: string;
  at: string;
  type: string;
  providerId?: ProviderId;
  mode?: AgentMode;
  payload?: Record<string, unknown>;
}

export class LocalRunStore {
  private readonly root: string;
  private readonly sessionsRoot: string;
  private readonly providersRoot: string;
  private readonly commandsRoot: string;

  constructor(root = join(app.getPath('userData'), 'agent-data')) {
    this.root = root;
    this.sessionsRoot = join(root, 'sessions');
    this.providersRoot = join(root, 'providers');
    this.commandsRoot = join(root, 'commands');
  }

  async initialize(): Promise<void> {
    await Promise.all([
      mkdir(this.sessionsRoot, { recursive: true }),
      mkdir(this.providersRoot, { recursive: true }),
      mkdir(this.commandsRoot, { recursive: true }),
    ]);
  }

  status(): LocalDataStatus {
    return { root: this.root, sessionsRoot: this.sessionsRoot };
  }

  providerHome(providerId: ProviderId): string {
    return join(this.providersRoot, providerId);
  }

  async ensureProviderHome(providerId: ProviderId): Promise<string> {
    const home = this.providerHome(providerId);
    await mkdir(home, { recursive: true });
    return home;
  }

  async createSession(request: AgentRunRequest): Promise<RunSession> {
    const id = randomUUID();
    const directory = join(this.sessionsRoot, id);
    const workspace = join(directory, 'workspace');
    const eventsPath = join(directory, 'events.jsonl');
    await mkdir(workspace, { recursive: true });
    await writeFile(join(directory, 'session.json'), JSON.stringify({
      schemaVersion: 1,
      id,
      createdAt: new Date().toISOString(),
      providerId: request.providerId,
      model: request.model,
      mode: request.mode,
      page: request.pageContext ? {
        tabId: request.pageContext.tabId,
        title: request.pageContext.title,
        url: request.pageContext.url,
      } : undefined,
    }, null, 2), 'utf8');
    const session = { id, directory, eventsPath, workspace, startedAt: Date.now() };
    await this.append(session, 'session.created', request.providerId, request.mode, {
      model: request.model,
      prompt: request.prompt,
    });
    if (request.pageContext) {
      await writeFile(join(directory, 'page-context.json'), JSON.stringify(request.pageContext, null, 2), 'utf8');
      await this.append(session, 'browser.context.captured', request.providerId, request.mode, {
        title: request.pageContext.title,
        url: request.pageContext.url,
        characters: request.pageContext.text.length,
      });
    }
    return session;
  }

  async append(
    session: RunSession,
    type: string,
    providerId?: ProviderId,
    mode?: AgentMode,
    payload?: Record<string, unknown>,
  ): Promise<void> {
    const event: RunEvent = {
      schemaVersion: 1,
      id: randomUUID(),
      sessionId: session.id,
      at: new Date().toISOString(),
      type,
      providerId,
      mode,
      payload: payload ? redact(payload) : undefined,
    };
    await appendFile(session.eventsPath, `${JSON.stringify(event)}\n`, 'utf8');
  }

  async writeProviderOutput(session: RunSession, stdout: string, stderr: string): Promise<void> {
    await Promise.all([
      writeFile(join(session.directory, 'provider.stdout.jsonl'), stdout, 'utf8'),
      writeFile(join(session.directory, 'provider.stderr.log'), redactText(stderr), 'utf8'),
    ]);
  }

  async recordCommand(request: CommandRequest, result: CommandResult): Promise<void> {
    await this.initialize();
    const { approvalToken: _approvalToken, ...safeResult } = result;
    await appendFile(join(this.commandsRoot, 'events.jsonl'), `${redactText(JSON.stringify({
      schemaVersion: 1,
      id: randomUUID(),
      at: new Date().toISOString(),
      type: `command.${result.state}`,
      shell: request.shell,
      cwd: request.cwd,
      script: request.script,
      result: safeResult,
    }))}\n`, 'utf8');
  }
}

function redact(payload: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(redactText(JSON.stringify(payload))) as Record<string, unknown>;
}

function redactText(value: string): string {
  return value
    .replace(/(?:sk|sess|oauth|token)-[A-Za-z0-9._-]{12,}/gi, '[REDACTED]')
    .replace(/("?(?:api[_-]?key|access[_-]?token|authorization)"?\s*[:=]\s*")([^"]+)(")/gi, '$1[REDACTED]$3');
}
