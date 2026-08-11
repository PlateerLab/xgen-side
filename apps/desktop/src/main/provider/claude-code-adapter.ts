import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentRunRequest, ProviderStatus } from '../../shared/contracts';
import { LocalRunStore, type RunSession } from '../storage/local-run-store';
import type { BrowserBridge, ProviderAdapter, ProviderRunPlan, ProviderStreamEvent } from './provider-adapter';
import { authError, collect, launchLoginTerminal, locateNativeExecutable, safeEnvironment } from './provider-runtime';

const models = [
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
      models,
      supportsReasoningEffort: false,
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
    const args = [
      '-p',
      '--output-format', 'stream-json',
      '--include-partial-messages',
      '--verbose',
      '--model', request.model,
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
    const candidates = process.env.USERPROFILE
      ? [join(process.env.USERPROFILE, '.local', 'bin', 'claude.exe')]
      : [];
    return locateNativeExecutable('claude', candidates);
  }

  private prepareHome(): Promise<string> {
    return this.store.ensureProviderHome(this.id);
  }
}
