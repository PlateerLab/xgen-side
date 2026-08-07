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
    const primary = shellCommand(request.shell, request.script, false);

    try {
      const result = await spawnAndCollect(primary.command, primary.args, cwd);
      return {
        state: result.exitCode === 0 ? 'completed' : 'failed',
        decision: 'allow',
        reason,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      if (request.shell === 'powershell' && isMissingExecutable(error)) {
        const fallback = shellCommand(request.shell, request.script, true);
        const result = await spawnAndCollect(fallback.command, fallback.args, cwd);
        return {
          state: result.exitCode === 0 ? 'completed' : 'failed',
          decision: 'allow',
          reason,
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          durationMs: Date.now() - startedAt,
        };
      }

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

function shellCommand(
  shell: ShellKind,
  script: string,
  powershellFallback: boolean,
): { command: string; args: string[] } {
  switch (shell) {
    case 'powershell':
      return {
        command: powershellFallback ? 'powershell.exe' : 'pwsh.exe',
        args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
      };
    case 'cmd':
      return { command: 'cmd.exe', args: ['/d', '/s', '/c', script] };
    case 'wsl':
      return { command: 'wsl.exe', args: ['--exec', 'bash', '-lc', script] };
  }
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
