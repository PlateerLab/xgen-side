import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import type { CommandRequest, CommandResult, ShellKind } from '../../shared/contracts';
import { PolicyEngine } from '../security/policy-engine';

interface PendingApproval {
  request: CommandRequest;
  expiresAt: number;
}

const approvalTtlMs = 60_000;
const commandTimeoutMs = 30_000;
const maxOutputBytes = 1_000_000;

export class CommandBroker {
  private readonly policy = new PolicyEngine();
  private readonly pendingApprovals = new Map<string, PendingApproval>();

  constructor(private readonly recorder?: (request: CommandRequest, result: CommandResult) => Promise<void>) {}

  async request(request: CommandRequest): Promise<CommandResult> {
    const evaluation = this.policy.evaluateCommand(request);

    if (evaluation.decision === 'deny') {
      const result: CommandResult = {
        state: 'denied',
        decision: evaluation.decision,
        reason: evaluation.reason,
      };
      await this.recorder?.(request, result);
      return result;
    }

    if (evaluation.decision === 'ask') {
      const approvalToken = randomUUID();
      this.pendingApprovals.set(approvalToken, {
        request,
        expiresAt: Date.now() + approvalTtlMs,
      });
      const result: CommandResult = {
        state: 'approval-required',
        decision: evaluation.decision,
        reason: evaluation.reason,
        approvalToken,
      };
      await this.recorder?.(request, result);
      return result;
    }

    return this.executeAndRecord(request, evaluation.reason);
  }

  async approve(token: string): Promise<CommandResult> {
    const pending = this.pendingApprovals.get(token);
    this.pendingApprovals.delete(token);

    if (!pending || pending.expiresAt < Date.now()) {
      return {
        state: 'denied',
        decision: 'deny',
        reason: 'The approval request is missing or expired.',
      };
    }

    return this.executeAndRecord(pending.request, 'The user approved this command once.');
  }

  private async executeAndRecord(request: CommandRequest, reason: string): Promise<CommandResult> {
    const result = await this.execute(request, reason);
    await this.recorder?.(request, result);
    return result;
  }

  private async execute(request: CommandRequest, reason: string): Promise<CommandResult> {
    const startedAt = Date.now();
    const cwd = resolve(request.cwd ?? process.cwd());
    const platform = process.platform;
    const finish = (result: { exitCode: number; stdout: string; stderr: string }): CommandResult => ({
      state: result.exitCode === 0 ? 'completed' : 'failed',
      decision: 'allow',
      reason,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: Date.now() - startedAt,
    });

    try {
      const primary = shellCommand(request.shell, request.script, { platform, powershellFallback: false });

      try {
        return finish(await spawnAndCollect(primary.command, primary.args, cwd));
      } catch (error) {
        // Some Windows images ship the legacy powershell.exe but not pwsh.exe.
        // POSIX has no such pair, so there is nothing to fall back to there.
        if (request.shell === 'powershell' && platform === 'win32' && isMissingExecutable(error)) {
          const fallback = shellCommand(request.shell, request.script, { platform, powershellFallback: true });
          return finish(await spawnAndCollect(fallback.command, fallback.args, cwd));
        }
        if (isMissingExecutable(error)) {
          throw new Error(`The ${request.shell} shell is not installed on this machine (${primary.command} was not found).`);
        }
        throw error;
      }
    } catch (error) {
      return {
        state: 'failed',
        decision: 'allow',
        reason,
        stderr: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
      };
    }
  }
}

/** The shell the broker uses when a caller does not name one. */
export function defaultShellForPlatform(platform: NodeJS.Platform): ShellKind {
  if (platform === 'win32') return 'powershell';
  return platform === 'darwin' ? 'zsh' : 'bash';
}

export function shellCommand(
  shell: ShellKind,
  script: string,
  options: { platform: NodeJS.Platform; powershellFallback: boolean },
): { command: string; args: string[] } {
  const windows = options.platform === 'win32';

  switch (shell) {
    case 'powershell':
      return {
        command: windows ? (options.powershellFallback ? 'powershell.exe' : 'pwsh.exe') : 'pwsh',
        args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
      };
    case 'cmd':
      if (!windows) throw unsupportedShell(shell, options.platform);
      return { command: 'cmd.exe', args: ['/d', '/s', '/c', script] };
    case 'wsl':
      if (!windows) throw unsupportedShell(shell, options.platform);
      return { command: 'wsl.exe', args: ['--exec', 'bash', '-lc', script] };
    case 'bash':
    case 'zsh':
      // Windows reaches a POSIX shell through the `wsl` kind, which keeps the
      // Linux userland boundary explicit instead of guessing at a bash on PATH.
      if (windows) throw unsupportedShell(shell, options.platform);
      return { command: shell, args: ['-lc', script] };
  }
}

function unsupportedShell(shell: ShellKind, platform: NodeJS.Platform): Error {
  return new Error(`The ${shell} shell is not available on ${platform}.`);
}

function spawnAndCollect(
  command: string,
  args: string[],
  cwd: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    let timedOut = false;

    const append = (target: 'stdout' | 'stderr', chunk: Buffer): void => {
      const remaining = Math.max(0, maxOutputBytes - outputBytes);
      if (remaining === 0) return;
      const sliced = chunk.subarray(0, remaining);
      outputBytes += sliced.length;
      if (target === 'stdout') stdout += sliced.toString('utf8');
      else stderr += sliced.toString('utf8');
    };

    child.stdout.on('data', (chunk: Buffer) => append('stdout', chunk));
    child.stderr.on('data', (chunk: Buffer) => append('stderr', chunk));
    child.once('error', reject);

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, commandTimeoutMs);

    child.once('close', (code) => {
      clearTimeout(timer);
      if (timedOut) stderr += `\nCommand timed out after ${commandTimeoutMs}ms.`;
      if (outputBytes >= maxOutputBytes) stderr += '\nOutput was truncated by the command broker.';
      resolvePromise({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

function isMissingExecutable(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
