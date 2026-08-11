import { randomUUID } from 'node:crypto';
import { access, appendFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { app } from 'electron';
import type {
  AgentMode,
  AgentRunRequest,
  AgentRunResult,
  BrowserHistoryEntry,
  CommandRequest,
  CommandResult,
  LocalDataStatus,
  LocalMarkdownFile,
  ProviderId,
  SkillRoute,
} from '../../shared/contracts';

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
  private readonly memoryRoot: string;
  private readonly browserHistoryRoot: string;
  private readonly taskResultsRoot: string;

  constructor(root = join(app.getPath('userData'), 'agent-data')) {
    this.root = root;
    this.sessionsRoot = join(root, 'sessions');
    this.providersRoot = join(root, 'providers');
    this.commandsRoot = join(root, 'commands');
    this.memoryRoot = join(root, 'memory');
    this.browserHistoryRoot = join(this.memoryRoot, 'browser-history');
    this.taskResultsRoot = join(this.memoryRoot, 'task-results');
  }

  async initialize(): Promise<void> {
    await Promise.all([
      mkdir(this.sessionsRoot, { recursive: true }),
      mkdir(this.providersRoot, { recursive: true }),
      mkdir(this.commandsRoot, { recursive: true }),
      mkdir(this.browserHistoryRoot, { recursive: true }),
      mkdir(this.taskResultsRoot, { recursive: true }),
    ]);
    const indexPath = join(this.memoryRoot, 'MEMORY.md');
    try {
      await access(indexPath);
    } catch {
      await writeFile(indexPath, [
        '# Browser Agent Memory',
        '',
        'XGEN Side stores memory only for Browser Agent runs.',
        '',
        '- `browser-history/` contains pages visited while a Browser Agent task was active.',
        '- `task-results/` contains one Markdown result for each Browser Agent run.',
        '- Chat, Search, and Ask page runs are intentionally excluded.',
        '',
      ].join('\n'), 'utf8');
    }
  }

  status(): LocalDataStatus {
    return { root: this.root, sessionsRoot: this.sessionsRoot, memoryRoot: this.memoryRoot };
  }

  async listMarkdown(): Promise<LocalMarkdownFile[]> {
    await this.initialize();
    const files = await collectMarkdownFiles(this.memoryRoot);
    return files.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async readMarkdown(relativePath: string): Promise<string> {
    return readFile(this.resolveMarkdownPath(relativePath), 'utf8');
  }

  async writeMarkdown(relativePath: string, content: string): Promise<void> {
    if (typeof content !== 'string' || content.length > 1_000_000) throw new Error('Markdown content is too large.');
    const path = this.resolveMarkdownPath(relativePath);
    await mkdir(resolve(path, '..'), { recursive: true });
    await writeFile(path, redactText(content), 'utf8');
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

  async writeBrowserAgentMemory(
    session: RunSession,
    request: AgentRunRequest,
    result: AgentRunResult,
    route: SkillRoute,
    history: BrowserHistoryEntry[],
  ): Promise<void> {
    if (route.resolvedMode !== 'browser-agent') return;
    await this.initialize();
    const completedAt = new Date();
    const date = completedAt.toISOString().slice(0, 10);
    const taskPath = join(this.taskResultsRoot, `${date}-${session.id.slice(0, 8)}.md`);
    const pages = uniqueHistory(history, request.pageContext?.url, request.pageContext?.title);
    const taskMarkdown = [
      '---',
      `session: ${session.id}`,
      `created: ${completedAt.toISOString()}`,
      `provider: ${request.providerId}`,
      `model: ${request.model}`,
      `state: ${result.state}`,
      'mode: browser-agent',
      '---',
      '',
      `# ${markdownText(request.prompt).slice(0, 100) || 'Browser Agent task'}`,
      '',
      '## Request',
      '',
      quoteMarkdown(request.prompt),
      '',
      '## Skills',
      '',
      ...route.skills.map((skill) => `- **${markdownText(skill.name)}** — ${markdownText(skill.description)} \`${skill.risk}\``),
      '',
      '## Browser history',
      '',
      ...(pages.length ? pages.map((entry) => `- [${markdownText(entry.title)}](${entry.url}) — ${entry.visitedAt}`) : ['- No browser navigation was recorded.']),
      '',
      '## Result',
      '',
      redactText(result.answer || result.error || 'No result was returned.'),
      '',
    ].join('\n');
    await writeFile(taskPath, taskMarkdown, 'utf8');

    if (pages.length) {
      const historyPath = join(this.browserHistoryRoot, `${date}.md`);
      let exists = true;
      try { await access(historyPath); } catch { exists = false; }
      if (!exists) await writeFile(historyPath, `# Browser history — ${date}\n\n`, 'utf8');
      await appendFile(historyPath, [
        `## ${completedAt.toLocaleTimeString('ko-KR')} — ${markdownText(request.prompt).slice(0, 80)}`,
        '',
        ...pages.map((entry) => `- [${markdownText(entry.title)}](${entry.url}) — ${entry.visitedAt}`),
        '',
      ].join('\n'), 'utf8');
    }
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

  private resolveMarkdownPath(relativePath: string): string {
    if (typeof relativePath !== 'string' || !relativePath.toLowerCase().endsWith('.md')) throw new Error('Only Markdown memory files are supported.');
    const path = resolve(this.memoryRoot, relativePath);
    const rootPrefix = `${resolve(this.memoryRoot)}${sep}`.toLowerCase();
    if (path.toLowerCase() !== resolve(this.memoryRoot, 'MEMORY.md').toLowerCase() && !path.toLowerCase().startsWith(rootPrefix)) {
      throw new Error('Memory path is outside the local data directory.');
    }
    return path;
  }
}

async function collectMarkdownFiles(root: string): Promise<LocalMarkdownFile[]> {
  const output: LocalMarkdownFile[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue;
      const info = await stat(path);
      const relativePath = relative(root, path).replaceAll('\\', '/');
      output.push({
        id: relativePath,
        name: entry.name,
        relativePath,
        category: relativePath.startsWith('browser-history/') ? 'browser-history' : relativePath.startsWith('task-results/') ? 'task-results' : 'root',
        updatedAt: info.mtime.toISOString(),
        size: info.size,
      });
    }
  };
  await visit(root);
  return output;
}

function uniqueHistory(history: BrowserHistoryEntry[], fallbackUrl?: string, fallbackTitle?: string): BrowserHistoryEntry[] {
  const entries = [...history];
  if (!entries.length && fallbackUrl) {
    const visitedAtMs = Date.now();
    entries.push({ tabId: 'attached', title: fallbackTitle || fallbackUrl, url: fallbackUrl, visitedAt: new Date(visitedAtMs).toISOString(), visitedAtMs });
  }
  return [...new Map(entries.map((entry) => [entry.url, entry])).values()];
}

function markdownText(value: string): string {
  return redactText(value).replace(/[\r\n]+/g, ' ').replace(/[|]/g, '\\|').trim();
}

function quoteMarkdown(value: string): string {
  return redactText(value).split(/\r?\n/).map((line) => `> ${line}`).join('\n');
}

function redact(payload: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(redactText(JSON.stringify(payload))) as Record<string, unknown>;
}

function redactText(value: string): string {
  return value
    .replace(/(?:sk|sess|oauth|token)-[A-Za-z0-9._-]{12,}/gi, '[REDACTED]')
    .replace(/("?(?:api[_-]?key|access[_-]?token|authorization)"?\s*[:=]\s*")([^"]+)(")/gi, '$1[REDACTED]$3');
}
