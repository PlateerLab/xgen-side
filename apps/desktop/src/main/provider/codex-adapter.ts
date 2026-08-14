import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentRunRequest, ProviderStatus } from '../../shared/contracts';
import { LocalRunStore, type RunSession } from '../storage/local-run-store';
import type { BrowserBridge, ProviderAdapter, ProviderRunPlan, ProviderStreamEvent } from './provider-adapter';
import { authError, collect, launchLoginTerminal, locateNativeExecutable, safeEnvironment } from './provider-runtime';

const models = [
  { id: 'gpt-5.6-sol', label: '5.6 Sol' },
  { id: 'gpt-5.6-terra', label: '5.6 Terra' },
  { id: 'gpt-5.6-luna', label: '5.6 Luna' },
];

export class CodexAdapter implements ProviderAdapter {
  readonly id = 'codex' as const;

  constructor(private readonly store: LocalRunStore) {}

  async getStatus(): Promise<ProviderStatus> {
    const executable = await this.locate();
    const home = await this.prepareHome();
    const auth = executable
      ? await collect(executable.path, ['login', 'status'], home, undefined, 15_000, safeEnvironment({ CODEX_HOME: home }))
      : undefined;
    return {
      id: this.id,
      label: 'ChatGPT · Codex',
      description: 'ChatGPT 구독으로 공식 Codex CLI를 로컬 실행합니다.',
      installed: Boolean(executable),
      authenticated: auth?.exitCode === 0,
      available: Boolean(executable && auth?.exitCode === 0),
      subscriptionAuth: true,
      version: executable?.version,
      executablePath: executable?.path,
      models,
      supportsReasoningEffort: true,
      error: executable ? authError(auth, 'ChatGPT 로그인이 필요합니다.') : 'Codex CLI를 찾지 못했습니다.',
    };
  }

  async authenticate(): Promise<{ launched: boolean; message: string }> {
    const executable = await this.locate();
    if (!executable) return { launched: false, message: 'Codex CLI를 먼저 설치해 주세요.' };
    const home = await this.prepareHome();
    await launchLoginTerminal({
      executablePath: executable.path,
      args: ['login'],
      cwd: home,
      homeEnvironmentName: 'CODEX_HOME',
    });
    return { launched: true, message: '공식 Codex 로그인 창을 열었습니다. 브라우저 로그인을 마친 뒤 상태를 새로고침하세요.' };
  }

  async prepareRun(
    request: AgentRunRequest,
    session: RunSession,
    browser?: BrowserBridge,
  ): Promise<ProviderRunPlan> {
    const executable = await this.locate();
    if (!executable) throw new Error('Codex CLI를 찾지 못했습니다.');
    const home = await this.prepareHome();
    const args = [
      'exec',
      '--json',
      '--model', request.model,
      '--sandbox', browser || (request.attachments?.length && request.permissionMode !== 'read-only') ? 'workspace-write' : 'read-only',
      '--cd', session.workspace,
      '--skip-git-repo-check',
    ];
    if (request.reasoningEffort && request.reasoningEffort !== 'auto') {
      args.push('-c', `model_reasoning_effort=${JSON.stringify(request.reasoningEffort)}`);
    }
    if (request.mode === 'search') args.push('-c', 'web_search="live"');
    const extraEnvironment: Record<string, string> = { CODEX_HOME: home };

    if (browser) {
      args.push(...codexBrowserMcpOverrides(browser));
    }
    args.push('-');
    return {
      executable,
      args,
      env: safeEnvironment(extraEnvironment),
      sandbox: browser || (request.attachments?.length && request.permissionMode !== 'read-only') ? 'workspace-write' : 'read-only',
    };
  }

  parseAnswer(stdout: string): string {
    let answer = '';
    for (const line of stdout.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as Record<string, unknown>;
        const item = event.item as Record<string, unknown> | undefined;
        if (event.type === 'item.completed' && item?.type === 'agent_message' && typeof item.text === 'string') {
          answer = item.text;
        }
      } catch {
        // Keep parsing the JSONL stream.
      }
    }
    return answer.trim();
  }

  isStreamComplete(line: string): boolean {
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      return event.type === 'turn.completed';
    } catch {
      return false;
    }
  }

  parseStreamLine(line: string): ProviderStreamEvent[] {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return [];
    }
    const item = event.item as Record<string, unknown> | undefined;
    if (!item) return [];
    if (event.type === 'item.completed' && item.type === 'agent_message' && typeof item.text === 'string') {
      return [{ type: 'text', text: item.text, mode: 'replace' }];
    }
    if (!['item.started', 'item.updated', 'item.completed'].includes(String(event.type))) return [];
    if (!['mcp_tool_call', 'command_execution', 'web_search'].includes(String(item.type))) return [];
    const phase = event.type === 'item.started'
      ? 'started'
      : event.type === 'item.completed'
        ? (item.status === 'failed' ? 'failed' : 'completed')
        : 'updated';
    const name = codexActivityName(item);
    const detail = typeof item.command === 'string'
      ? item.command
      : typeof item.query === 'string'
        ? item.query
        : undefined;
    return [{ type: 'activity', name, phase, detail }];
  }

  private async locate(): Promise<{ path: string; version: string } | undefined> {
    const candidates: string[] = [];
    const home = process.env.HOME;
    if (home) {
      candidates.push(...codexMacExecutableCandidates(home));
    }
    const appData = process.env.APPDATA;
    if (appData) {
      candidates.push(...codexNpmExecutableCandidates(appData, process.arch));
    }
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) {
      const desktopBinRoot = join(localAppData, 'OpenAI', 'Codex', 'bin');
      try {
        const entries = await readdir(desktopBinRoot, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) candidates.push(join(desktopBinRoot, entry.name, 'codex.exe'));
        }
      } catch {
        // Codex Desktop is optional. PATH and npm candidates still apply.
      }
    }
    return locateNativeExecutable('codex', candidates);
  }

  private async prepareHome(): Promise<string> {
    const home = await this.store.ensureProviderHome(this.id);
    await writeFile(join(home, 'config.toml'), [
      'cli_auth_credentials_store = "file"',
      'sandbox_mode = "read-only"',
      'approval_policy = "never"',
      'web_search = "cached"',
      '',
    ].join('\n'), 'utf8');
    return home;
  }
}

export function codexMacExecutableCandidates(home: string): string[] {
  return [
    join(home, '.local', 'bin', 'codex'),
    join(home, '.npm-global', 'bin', 'codex'),
    '/Applications/ChatGPT.app/Contents/Resources/codex',
    '/Applications/Codex.app/Contents/Resources/codex',
    '/Applications/Codex.app/Contents/MacOS/codex',
  ];
}

export function codexBrowserMcpOverrides(browser: BrowserBridge): string[] {
  return [
    '-c', `mcp_servers.xgen_browser.command=${tomlString(browser.executablePath)}`,
    '-c', `mcp_servers.xgen_browser.args=[${browser.args.map(tomlString).join(',')}]`,
    '-c', `mcp_servers.xgen_browser.env=${tomlInlineTable(browser.environment)}`,
    '-c', 'mcp_servers.xgen_browser.default_tools_approval_mode="approve"',
  ];
}

export function codexNpmExecutableCandidates(appData: string, architecture: NodeJS.Architecture): string[] {
  const packageArchitecture = architecture === 'arm64' ? 'arm64' : 'x64';
  const target = architecture === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc';
  const vendorRoot = join(
    appData,
    'npm',
    'node_modules',
    '@openai',
    'codex',
    'node_modules',
    `@openai/codex-win32-${packageArchitecture}`,
    'vendor',
    target,
  );
  return [
    join(vendorRoot, 'bin', 'codex.exe'),
    join(vendorRoot, 'codex', 'codex.exe'),
  ];
}

export function codexCompatibilityError(stderr: string): string | undefined {
  if (!/failed to decode models response/i.test(stderr) || !/unknown variant [`'"]?max/i.test(stderr)) return undefined;
  return '설치된 Codex CLI가 최신 모델 목록과 호환되지 않습니다. Codex CLI를 최신 버전으로 업데이트한 뒤 Settings > AI Providers에서 상태를 새로고침하세요.';
}

function codexActivityName(item: Record<string, unknown>): string {
  if (item.type === 'mcp_tool_call') {
    const server = typeof item.server === 'string' ? item.server : 'mcp';
    const tool = typeof item.tool === 'string' ? item.tool : 'tool';
    return `${server}.${tool}`;
  }
  if (item.type === 'web_search') return 'Web search';
  return 'Local command';
}

function tomlString(value: string): string {
  return JSON.stringify(value.replace(/\\/g, '/'));
}

function tomlInlineTable(values: Record<string, string>): string {
  return `{${Object.entries(values).map(([key, value]) => `${key}=${tomlString(value)}`).join(',')}}`;
}
