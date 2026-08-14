import { randomUUID } from 'node:crypto';
import { access, appendFile, chmod, copyFile, mkdir, open, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import type {
  AgentMode,
  AgentRunRequest,
  AgentRunResult,
  BrowserHistoryEntry,
  CommandRequest,
  CommandResult,
  LocalDataStatus,
  LocalArtifact,
  LocalAttachment,
  LocalFileKind,
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

export interface PreparedAttachment extends LocalAttachment {
  relativePath: string;
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
  private readonly attachmentInboxRoot: string;
  private cleanedAttachmentInbox = false;

  constructor(root: string) {
    this.root = root;
    this.sessionsRoot = join(root, 'sessions');
    this.providersRoot = join(root, 'providers');
    this.commandsRoot = join(root, 'commands');
    this.memoryRoot = join(root, 'memory');
    this.browserHistoryRoot = join(this.memoryRoot, 'browser-history');
    this.taskResultsRoot = join(this.memoryRoot, 'task-results');
    this.attachmentInboxRoot = join(root, 'attachments', 'inbox');
  }

  async initialize(): Promise<void> {
    await Promise.all([
      mkdir(this.sessionsRoot, { recursive: true }),
      mkdir(this.providersRoot, { recursive: true }),
      mkdir(this.commandsRoot, { recursive: true }),
      mkdir(this.browserHistoryRoot, { recursive: true }),
      mkdir(this.taskResultsRoot, { recursive: true }),
      mkdir(this.attachmentInboxRoot, { recursive: true }),
    ]);
    if (!this.cleanedAttachmentInbox) {
      await this.cleanupStaleAttachments().catch(() => undefined);
      this.cleanedAttachmentInbox = true;
    }
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
      permissionMode: request.permissionMode ?? 'guard',
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
      permissionMode: request.permissionMode ?? 'guard',
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

  async stageAttachments(paths: string[]): Promise<LocalAttachment[]> {
    await this.initialize();
    if (!Array.isArray(paths) || paths.length > 10) throw new Error('한 번에 최대 10개 파일을 첨부할 수 있습니다.');
    const attachments: LocalAttachment[] = [];
    const stagedDirectories: string[] = [];
    try {
      for (const sourcePath of paths) {
        const source = resolve(sourcePath);
        const info = await stat(source);
        if (!info.isFile()) throw new Error('폴더는 파일 첨부로 사용할 수 없습니다.');
        if (info.size < 1 || info.size > 50 * 1024 * 1024) throw new Error('첨부 파일은 50MB 이하여야 합니다.');
        const kind = fileKind(source);
        await assertFileSignature(source, kind);
        const id = randomUUID();
        const directory = join(this.attachmentInboxRoot, id);
        stagedDirectories.push(directory);
        const name = safeFileName(basename(source), kind);
        await mkdir(directory, { recursive: true });
        await copyFile(source, join(directory, name));
        if (process.platform !== 'win32') await chmod(join(directory, name), 0o400);
        const attachment = { id, name, kind, size: info.size };
        await writeFile(join(directory, 'metadata.json'), JSON.stringify(attachment, null, 2), 'utf8');
        attachments.push(attachment);
      }
    } catch (error) {
      await Promise.all(stagedDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
      throw error;
    }
    return attachments;
  }

  async discardAttachment(id: string): Promise<boolean> {
    if (!validOpaqueId(id)) return false;
    const directory = join(this.attachmentInboxRoot, id);
    try {
      await rm(directory, { recursive: true, force: false });
      return true;
    } catch {
      return false;
    }
  }

  async materializeAttachments(session: RunSession, requested: LocalAttachment[] = []): Promise<PreparedAttachment[]> {
    if (!requested.length) return [];
    const targetDirectory = join(session.workspace, 'attachments');
    await mkdir(targetDirectory, { recursive: true });
    const prepared: PreparedAttachment[] = [];
    for (const reference of requested) {
      if (!validOpaqueId(reference.id)) throw new Error('첨부 파일 식별자가 올바르지 않습니다.');
      const metadata = JSON.parse(await readFile(join(this.attachmentInboxRoot, reference.id, 'metadata.json'), 'utf8')) as LocalAttachment;
      if (metadata.id !== reference.id || metadata.name !== reference.name || metadata.kind !== reference.kind || metadata.size !== reference.size) {
        throw new Error('첨부 파일 메타데이터가 일치하지 않습니다.');
      }
      const targetName = uniqueFileName(prepared.map((item) => item.name), metadata.name);
      const relativePath = `attachments/${targetName}`;
      const target = join(session.workspace, ...relativePath.split('/'));
      await copyFile(join(this.attachmentInboxRoot, reference.id, metadata.name), target);
      if (process.platform !== 'win32') await chmod(target, 0o444);
      prepared.push({ ...metadata, name: targetName, relativePath });
    }
    await mkdir(join(session.workspace, 'artifacts'), { recursive: true });
    await Promise.all(requested.map((reference) => rm(join(this.attachmentInboxRoot, reference.id), { recursive: true, force: true })));
    return prepared;
  }

  async collectArtifacts(session: RunSession): Promise<LocalArtifact[]> {
    const directory = join(session.workspace, 'artifacts');
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return [];
    }
    const artifacts: LocalArtifact[] = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      let kind: LocalFileKind;
      try { kind = fileKind(entry.name); } catch { continue; }
      const path = join(directory, entry.name);
      const info = await stat(path);
      if (info.size < 1 || info.size > 100 * 1024 * 1024) continue;
      try { await assertFileSignature(path, kind); } catch { continue; }
      artifacts.push({
        id: `${session.id}:${entry.name}`,
        sessionId: session.id,
        name: entry.name,
        kind,
        relativePath: `artifacts/${entry.name}`,
        size: info.size,
      });
    }
    return artifacts;
  }

  resolveArtifactPath(sessionId: string, relativePath: string): string {
    if (!validOpaqueId(sessionId) || typeof relativePath !== 'string' || !relativePath.startsWith('artifacts/')) {
      throw new Error('결과 파일 경로가 올바르지 않습니다.');
    }
    const root = resolve(this.sessionsRoot, sessionId, 'workspace', 'artifacts');
    const target = resolve(this.sessionsRoot, sessionId, 'workspace', relativePath);
    if (!target.startsWith(`${root}${sep}`)) throw new Error('결과 파일 경로가 작업 공간 밖을 가리킵니다.');
    return target;
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

  private async cleanupStaleAttachments(): Promise<void> {
    const cutoff = Date.now() - 24 * 60 * 60 * 1_000;
    const entries = await readdir(this.attachmentInboxRoot, { withFileTypes: true });
    await Promise.all(entries.filter((entry) => entry.isDirectory() && validOpaqueId(entry.name)).map(async (entry) => {
      const directory = join(this.attachmentInboxRoot, entry.name);
      try {
        const info = await stat(directory);
        if (info.mtimeMs < cutoff) await rm(directory, { recursive: true, force: true });
      } catch {
        // The entry may have been submitted or removed while cleanup was running.
      }
    }));
  }
}

function fileKind(path: string): LocalFileKind {
  const extension = extname(path).toLowerCase().slice(1);
  if (extension === 'docx' || extension === 'xlsx' || extension === 'pptx' || extension === 'pdf') return extension;
  throw new Error('DOCX, XLSX, PPTX, PDF 파일만 첨부할 수 있습니다.');
}

async function assertFileSignature(path: string, kind: LocalFileKind): Promise<void> {
  const handle = await open(path, 'r');
  try {
    const header = Buffer.alloc(8);
    await handle.read(header, 0, header.length, 0);
    const validPdf = header.subarray(0, 5).toString('ascii') === '%PDF-';
    const validZip = header[0] === 0x50 && header[1] === 0x4b && [0x03, 0x05, 0x07].includes(header[2] ?? -1);
    let valid = kind === 'pdf' ? validPdf : validZip;
    if (valid && kind !== 'pdf') {
      const info = await handle.stat();
      const tailSize = Math.min(info.size, 8 * 1024 * 1024);
      const tail = Buffer.alloc(tailSize);
      await handle.read(tail, 0, tailSize, info.size - tailSize);
      const marker = kind === 'docx' ? 'word/' : kind === 'xlsx' ? 'xl/' : 'ppt/';
      valid = tail.includes(Buffer.from('[Content_Types].xml')) && tail.includes(Buffer.from(marker));
    }
    if (!valid) throw new Error('파일 확장자와 실제 형식이 일치하지 않습니다.');
  } finally {
    await handle.close();
  }
}

function safeFileName(name: string, kind: LocalFileKind): string {
  const base = basename(name, extname(name)).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim().slice(0, 120) || 'attachment';
  return `${base}.${kind}`;
}

function uniqueFileName(existing: string[], name: string): string {
  if (!existing.includes(name)) return name;
  const extension = extname(name);
  const stem = basename(name, extension);
  let sequence = 2;
  while (existing.includes(`${stem}-${sequence}${extension}`)) sequence += 1;
  return `${stem}-${sequence}${extension}`;
}

function validOpaqueId(value: string): boolean {
  return /^[a-f0-9-]{36}$/i.test(value);
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
