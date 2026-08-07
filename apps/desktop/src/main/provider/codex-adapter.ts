import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentRunRequest, ProviderStatus } from '../../shared/contracts';
import { LocalRunStore, type RunSession } from '../storage/local-run-store';
import type { BrowserBridge, ProviderAdapter, ProviderRunPlan } from './provider-adapter';
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
      error: executable ? authError(auth, 'ChatGPT 로그인이 필요합니다.') : 'Codex CLI를 찾지 못했습니다.',
    };
  }

  async authenticate(): Promise<{ launched: boolean; message: string }> {
    const executable = await this.locate();
    if (!executable) return { launched: false, message: 'Codex CLI를 먼저 설치해 주세요.' };
    const home = await this.prepareHome();
    launchLoginTerminal({
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
      '--sandbox', browser ? 'workspace-write' : 'read-only',
      '--cd', session.workspace,
      '--skip-git-repo-check',
    ];
    if (request.mode === 'search') args.push('-c', 'web_search="live"');
    const extraEnvironment: Record<string, string> = { CODEX_HOME: home };

    if (browser) {
      args.push(
        '-c', `mcp_servers.xgen_browser.command=${tomlString(browser.executablePath)}`,
        '-c', 'mcp_servers.xgen_browser.args=["mcp","--tools","core,tabs"]',
        '-c', `mcp_servers.xgen_browser.env=${tomlInlineTable(browser.environment)}`,
      );
      Object.assign(extraEnvironment, browser.environment);
    }
    args.push('-');
    return {
      executable,
      args,
      env: safeEnvironment(extraEnvironment),
      sandbox: browser ? 'workspace-write' : 'read-only',
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

  private async locate(): Promise<{ path: string; version: string } | undefined> {
    const candidates: string[] = [];
    const appData = process.env.APPDATA;
    if (appData) {
      const arch = process.arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc';
      candidates.push(join(appData, 'npm', 'node_modules', '@openai', 'codex', 'node_modules', `@openai/codex-win32-${process.arch}`, 'vendor', arch, 'codex', 'codex.exe'));
    }
    return locateNativeExecutable('codex', candidates);
  }

  private async prepareHome(): Promise<string> {
    const home = await this.store.ensureProviderHome(this.id);
    await writeFile(join(home, 'config.toml'), [
      'cli_auth_credentials_store = "keyring"',
      'sandbox_mode = "read-only"',
      'approval_policy = "never"',
      'web_search = "cached"',
      '',
    ].join('\n'), 'utf8');
    return home;
  }
}

function tomlString(value: string): string {
  return JSON.stringify(value.replace(/\\/g, '/'));
}

function tomlInlineTable(values: Record<string, string>): string {
  return `{${Object.entries(values).map(([key, value]) => `${key}=${tomlString(value)}`).join(',')}}`;
}
