import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AgentRunRequest, ProviderStatus } from '../../shared/contracts';
import { LocalRunStore, type RunSession } from '../storage/local-run-store';
import type { BrowserBridge, ProviderAdapter, ProviderRunPlan, ProviderStreamEvent } from './provider-adapter';
import { readClaudeModelCatalog } from './claude-model-catalog';
import { authError, collect, launchLoginTerminal, locateNativeExecutable, safeEnvironment } from './provider-runtime';

const fallbackModels = [
  { id: 'sonnet', label: 'Claude Sonnet' },
  { id: 'opus', label: 'Claude Opus' },
  { id: 'haiku', label: 'Claude Haiku' },
];

export class ClaudeCodeAdapter implements ProviderAdapter {
  readonly id = 'claude' as const;

  constructor(private readonly store: LocalRunStore) {}

  async getStatus(): Promise<ProviderStatus> {
    const executable = await this.locate();
    const home = await this.prepareHome();
    const auth = executable
      ? await collect(executable.path, ['auth', 'status'], home, undefined, 15_000, safeEnvironment({ CLAUDE_CONFIG_DIR: home }))
      : undefined;
    return {
      id: this.id,
      label: 'Claude Code',
      description: 'Claude 구독으로 공식 Claude Code CLI를 로컬 실행합니다.',
      installed: Boolean(executable),
      authenticated: auth?.exitCode === 0,
      available: Boolean(executable && auth?.exitCode === 0),
      subscriptionAuth: true,
      version: executable?.version,
      executablePath: executable?.path,
      models: executable ? await listClaudeModels(executable.path, home, executable.version) : fallbackModels,
      supportsReasoningEffort: executable ? (await claudeCapabilities(executable)).supportsEffort : false,
      error: executable ? authError(auth, 'Claude 로그인이 필요합니다.') : 'Claude Code CLI를 찾지 못했습니다.',
      complianceNotice: '로컬 사용자가 직접 설치·로그인한 공식 Claude Code CLI만 실행합니다. 호스팅·공유형 배포는 Anthropic API 또는 별도 승인이 필요합니다.',
    };
  }

  async authenticate(): Promise<{ launched: boolean; message: string }> {
    const executable = await this.locate();
    if (!executable) return { launched: false, message: 'Claude Code CLI를 먼저 설치해 주세요.' };
    const home = await this.prepareHome();
    await launchLoginTerminal({
      executablePath: executable.path,
      args: ['auth', 'login'],
      cwd: home,
      homeEnvironmentName: 'CLAUDE_CONFIG_DIR',
    });
    return { launched: true, message: '공식 Claude Code 로그인 창을 열었습니다. 구독 계정 로그인을 마친 뒤 상태를 새로고침하세요.' };
  }

  async prepareRun(
    request: AgentRunRequest,
    session: RunSession,
    browser?: BrowserBridge,
  ): Promise<ProviderRunPlan> {
    const executable = await this.locate();
    if (!executable) throw new Error('Claude Code CLI를 찾지 못했습니다.');
    const home = await this.prepareHome();
    const { supportsEffort } = await claudeCapabilities(executable);
    const effort = supportsEffort && request.reasoningEffort && request.reasoningEffort !== 'auto'
      ? request.reasoningEffort
      : undefined;
    const args = [
      '-p',
      '--output-format', 'stream-json',
      '--include-partial-messages',
      '--verbose',
      '--model', request.model,
      ...(effort ? ['--effort', effort] : []),
      '--permission-mode', browser ? 'default' : 'plan',
      '--disallowedTools', request.mode === 'search'
        ? 'Bash,Edit,Write,NotebookEdit'
        : 'Bash,Edit,Write,NotebookEdit,WebSearch,WebFetch',
    ];
    const extraEnvironment: Record<string, string> = { CLAUDE_CONFIG_DIR: home };

    if (browser) {
      const mcpConfigPath = join(session.directory, 'claude-mcp.json');
      const toolProfiles = browser.toolProfiles.join(',') || 'core';
      await writeFile(mcpConfigPath, JSON.stringify({
        mcpServers: {
          xgen_browser: {
            command: browser.executablePath,
            args: ['mcp', '--tools', toolProfiles],
            env: browser.environment,
          },
        },
      }, null, 2), 'utf8');
      args.push(
        '--mcp-config', mcpConfigPath,
        '--strict-mcp-config',
        '--allowedTools', 'mcp__xgen_browser__*',
      );
      Object.assign(extraEnvironment, browser.environment);
    }

    return {
      executable,
      args,
      env: safeEnvironment(extraEnvironment),
      sandbox: browser
        ? 'isolated-workspace + agent-browser-policy'
        : 'isolated-workspace + claude-plan-mode',
    };
  }

  parseAnswer(stdout: string): string {
    let result = '';
    let assistantText = '';
    for (const line of stdout.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as Record<string, unknown>;
        if (event.type === 'result' && typeof event.result === 'string') result = event.result;
        if (event.type === 'assistant') {
          const message = event.message as Record<string, unknown> | undefined;
          const content = Array.isArray(message?.content) ? message.content : [];
          const text = content
            .map((item) => item as Record<string, unknown>)
            .filter((item) => item.type === 'text' && typeof item.text === 'string')
            .map((item) => item.text as string)
            .join('\n');
          if (text) assistantText = text;
        }
      } catch {
        // Keep parsing the JSONL stream.
      }
    }
    return (result || assistantText).trim();
  }

  parseStreamLine(line: string): ProviderStreamEvent[] {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return [];
    }
    if (event.type === 'stream_event') {
      const streamEvent = event.event as Record<string, unknown> | undefined;
      const delta = streamEvent?.delta as Record<string, unknown> | undefined;
      if (streamEvent?.type === 'content_block_delta' && delta?.type === 'text_delta' && typeof delta.text === 'string') {
        return [{ type: 'text', text: delta.text, mode: 'append' }];
      }
    }
    if (event.type === 'result' && typeof event.result === 'string') {
      return [{ type: 'text', text: event.result, mode: 'replace' }];
    }
    if (event.type !== 'assistant') return [];
    const message = event.message as Record<string, unknown> | undefined;
    const content = Array.isArray(message?.content)
      ? message.content.map((item) => item as Record<string, unknown>)
      : [];
    const output: ProviderStreamEvent[] = [];
    const text = content
      .filter((item) => item.type === 'text' && typeof item.text === 'string')
      .map((item) => item.text as string)
      .join('\n');
    if (text) output.push({ type: 'text', text, mode: 'replace' });
    for (const item of content) {
      if (item.type === 'tool_use') {
        output.push({
          type: 'activity',
          name: typeof item.name === 'string' ? item.name : 'Tool',
          phase: 'started',
        });
      }
    }
    return output;
  }

  private locate(): Promise<{ path: string; version: string } | undefined> {
    return locateNativeExecutable('claude', claudeExecutableCandidates());
  }

  private prepareHome(): Promise<string> {
    return this.store.ensureProviderHome(this.id);
  }
}

/**
 * Well known Claude Code CLI install locations. A packaged desktop process inherits a
 * minimal PATH on macOS, so the official installer directories are probed explicitly.
 */
export function claudeExecutableCandidates(
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string[] {
  if (platform === 'win32') {
    const profile = process.env.USERPROFILE ?? home;
    return profile ? [join(profile, '.local', 'bin', 'claude.exe')] : [];
  }

  const candidates = [
    join(home, '.local', 'bin', 'claude'),
    join(home, '.claude', 'local', 'claude'),
    join(home, 'bin', 'claude'),
  ];
  if (platform === 'darwin') candidates.push(join('/opt', 'homebrew', 'bin', 'claude'));
  candidates.push(join('/usr', 'local', 'bin', 'claude'));
  return candidates;
}

/**
 * Builds the selectable model list from the installed CLI. Claude Code has no model
 * list command, so this combines the aliases documented by `--model` in the installed
 * version's help output with the account-specific models the CLI caches in
 * `.claude.json` (`additionalModelOptionsCache`). Falls back to the well-known aliases.
 */
export async function listClaudeModels(
  executablePath: string,
  home: string,
  version = '',
): Promise<Array<{ id: string; label: string }>> {
  const models: Array<{ id: string; label: string }> = [];
  const seen = new Set<string>();
  const push = (id: string, label: string): void => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    models.push({ id, label });
  };

  // Account-gated models come first: the CLI caches exactly the ones this plan unlocked,
  // with the labels it shows for them.
  try {
    const cache = JSON.parse(await readFile(join(home, '.claude.json'), 'utf8')) as {
      additionalModelOptionsCache?: Array<{ value?: unknown; label?: unknown }>;
    };
    for (const entry of cache.additionalModelOptionsCache ?? []) {
      if (typeof entry.value === 'string' && typeof entry.label === 'string' && entry.value) {
        // The cached id carries the context-window suffix, e.g. claude-fable-5[1m]; name it
        // so it reads as a distinct choice next to the plain id from the catalog.
        const window = /\[([^\]]+)\]$/.exec(entry.value)?.[1];
        push(entry.value, `Claude ${entry.label}${window ? ` (${window.toUpperCase()})` : ''}`);
      }
    }
  } catch {
    // The cache appears after the first login; the catalog below still applies.
  }

  for (const model of await readClaudeModelCatalog(executablePath)) push(model.id, model.label);
  for (const alias of (await claudeCapabilities({ path: executablePath, version })).aliases) {
    push(alias, `Claude ${alias.charAt(0).toUpperCase()}${alias.slice(1)} (latest)`);
  }

  return models.length ? models : fallbackModels;
}

interface ClaudeCapabilities {
  aliases: string[];
  supportsEffort: boolean;
}

/**
 * Reads what the installed CLI actually accepts. The user owns their Claude Code
 * install, so passing a flag an older build does not know ("error: unknown option")
 * would fail every run. Cached per executable and version, so an upgrade in place is
 * picked up without restarting the app.
 */
const capabilityCache = new Map<string, Promise<ClaudeCapabilities>>();

export function claudeCapabilities(executable: { path: string; version: string }): Promise<ClaudeCapabilities> {
  const key = `${executable.path}@${executable.version}`;
  const cached = capabilityCache.get(key);
  if (cached) return cached;
  const probe = readClaudeCapabilities(executable.path);
  capabilityCache.set(key, probe);
  return probe;
}

async function readClaudeCapabilities(executablePath: string): Promise<ClaudeCapabilities> {
  const aliases = new Set<string>();
  let supportsEffort = false;
  try {
    const help = await collect(executablePath, ['--help'], process.cwd(), undefined, 10_000);
    const modelSection = /alias for the latest model[^)]*\)/i.exec(help.stdout)?.[0] ?? '';
    for (const [, alias] of modelSection.matchAll(/'([a-z][a-z0-9-]*)'/g)) if (alias) aliases.add(alias);
    supportsEffort = /--effort\s+<[^>]*>/.test(help.stdout);
  } catch {
    // Help output is best-effort. Fall back to the well-known aliases and, because a
    // capability could not be proven, to not sending the optional flag at all.
  }
  for (const alias of ['opus', 'sonnet', 'haiku']) aliases.add(alias);
  return { aliases: [...aliases], supportsEffort };
}
