import { spawn, type ChildProcess } from 'node:child_process';
import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { currentDesktopPlatform, executableCandidatesFromPath, inheritedEnvironmentNames, loginTerminalLaunchSpec } from '../platform/platform-runtime';

const maxOutputBytes = 8_000_000;

export interface ProcessOutput {
  exitCode: number;
  stdout: string;
  stderr: string;
  cancelled: boolean;
}

export interface CollectOptions {
  signal?: AbortSignal;
  onStdoutLine?(line: string): void;
  onStderrLine?(line: string): void;
  stopAfterStdoutLine?(line: string): boolean;
}

export async function locateNativeExecutable(
  name: string,
  candidates: string[] = [],
): Promise<{ path: string; version: string } | undefined> {
  const platform = currentDesktopPlatform();
  const paths = new Set([...candidates, ...executableCandidatesFromPath(name, platform)]);
  for (const found of await executablesOnPath(name)) paths.add(found);

  for (const candidate of paths) {
    try {
      await access(candidate);
      const version = await collect(candidate, ['--version'], process.cwd(), undefined, 10_000);
      if (version.exitCode === 0) {
        return { path: candidate, version: version.stdout.trim() || version.stderr.trim() };
      }
    } catch {
      // Continue until a native executable can be invoked directly.
    }
  }
  return undefined;
}

export async function launchLoginTerminal(options: {
  executablePath: string;
  args: string[];
  cwd: string;
  homeEnvironmentName: 'CODEX_HOME' | 'CLAUDE_CONFIG_DIR';
}): Promise<void> {
  const environment = { [options.homeEnvironmentName]: options.cwd };
  const platform = currentDesktopPlatform();
  const launch = loginTerminalLaunchSpec(platform, options);
  const result = await collect(
    launch.command,
    launch.args,
    options.cwd,
    undefined,
    10_000,
    safeEnvironment(environment),
  );
  if (result.exitCode !== 0) {
    throw new Error((result.stderr || result.stdout || 'Could not open the provider login terminal.').trim());
  }
}

export function collect(
  command: string,
  args: string[],
  cwd: string,
  stdin?: string,
  timeoutMs = 30_000,
  env = safeEnvironment(),
  options: CollectOptions = {},
): Promise<ProcessOutput> {
  return new Promise((resolve) => {
    if (options.signal?.aborted) {
      resolve({ exitCode: 1, stdout: '', stderr: '', cancelled: true });
      return;
    }
    // POSIX has no taskkill. Give the child its own process group so terminateProcessTree
    // can signal the whole tree instead of leaving orphaned provider CLIs behind.
    const child = spawn(command, args, {
      cwd,
      env,
      windowsHide: true,
      shell: false,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let stdoutLines = '';
    let stderrLines = '';
    let bytes = 0;
    let timedOut = false;
    let cancelled = false;
    let outputCompleted = false;
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    let forceFinishTimer: NodeJS.Timeout | undefined;
    const finish = (result: ProcessOutput): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (forceFinishTimer) clearTimeout(forceFinishTimer);
      options.signal?.removeEventListener('abort', abort);
      resolve(result);
    };
    const emitLines = (target: 'stdout' | 'stderr', text: string): void => {
      const pending = (target === 'stdout' ? stdoutLines : stderrLines) + text;
      const lines = pending.split(/\r?\n/);
      const remainder = lines.pop() ?? '';
      if (target === 'stdout') stdoutLines = remainder;
      else stderrLines = remainder;
      const listener = target === 'stdout' ? options.onStdoutLine : options.onStderrLine;
      for (const line of lines) {
        listener?.(line);
        if (target === 'stdout' && !outputCompleted && options.stopAfterStdoutLine?.(line)) {
          outputCompleted = true;
          terminateProcessTree(child);
          forceFinishTimer = setTimeout(() => finish({ exitCode: 0, stdout, stderr, cancelled: false }), 1_500);
        }
      }
    };
    const append = (target: 'stdout' | 'stderr', chunk: Buffer): void => {
      const remaining = Math.max(0, maxOutputBytes - bytes);
      if (!remaining) return;
      const text = chunk.subarray(0, remaining).toString('utf8');
      bytes += Buffer.byteLength(text);
      if (target === 'stdout') stdout += text;
      else stderr += text;
      emitLines(target, text);
    };
    child.stdout.on('data', (chunk: Buffer) => append('stdout', chunk));
    child.stderr.on('data', (chunk: Buffer) => append('stderr', chunk));
    child.once('error', (error) => finish({ exitCode: 1, stdout, stderr: `${stderr}${error.message}`, cancelled }));
    timer = setTimeout(() => {
      timedOut = true;
      terminateProcessTree(child);
    }, timeoutMs);
    const abort = (): void => {
      cancelled = true;
      terminateProcessTree(child);
      forceFinishTimer = setTimeout(() => finish({ exitCode: 1, stdout, stderr, cancelled: true }), 1_500);
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    child.once('close', (code) => {
      if (stdoutLines) options.onStdoutLine?.(stdoutLines);
      if (stderrLines) options.onStderrLine?.(stderrLines);
      if (timedOut) stderr += `\nProcess timed out after ${timeoutMs}ms.`;
      if (bytes >= maxOutputBytes) stderr += '\nOutput was truncated.';
      finish({ exitCode: outputCompleted ? 0 : code ?? 1, stdout, stderr, cancelled });
    });
    if (stdin !== undefined) child.stdin.end(stdin, 'utf8');
    else child.stdin.end();
  });
}

/**
 * Lists every PATH entry that holds the executable. Windows delegates to where.exe so
 * PATHEXT resolution stays native; POSIX scans PATH directly because a GUI process cannot
 * rely on which(1) being installed.
 */
async function executablesOnPath(name: string): Promise<string[]> {
  if (process.platform === 'win32') {
    const found = await collect('where.exe', [`${name}.exe`], process.cwd(), undefined, 5_000);
    return found.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  }

  const found: string[] = [];
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    if (!directory) continue;
    const candidate = join(directory, name);
    try {
      if (!(await stat(candidate)).isFile()) continue;
      await access(candidate, constants.X_OK);
      found.push(candidate);
    } catch {
      // Most PATH entries do not hold this executable.
    }
  }
  return found;
}

function terminateProcessTree(child: ChildProcess): void {
  const pid = child.pid;
  if (!pid) return;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
      shell: false,
      stdio: 'ignore',
    });
    killer.once('error', () => undefined);
    return;
  }
  if (!signalProcessTree(pid, 'SIGTERM')) return;
  // Escalate only while this child is still alive. Its pid, and with it the process
  // group id, can be reassigned to an unrelated process the moment it exits, and a
  // late SIGKILL would then land outside this run.
  setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) signalProcessTree(pid, 'SIGKILL');
  }, 2_000).unref();
}

/**
 * Signals the child's process group first and falls back to the single process when the
 * group is gone. Returns false once the target no longer exists.
 */
function signalProcessTree(pid: number, signal: NodeJS.Signals): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    // The child may not lead a process group, for example when it was already reaped.
  }
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

export function safeEnvironment(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const names = inheritedEnvironmentNames(currentDesktopPlatform());
  const env: NodeJS.ProcessEnv = {};
  for (const name of names) if (process.env[name]) env[name] = process.env[name];
  return { ...env, ...extra };
}

export function authError(result: ProcessOutput | undefined, fallback: string): string | undefined {
  if (!result || result.exitCode === 0) return undefined;
  return (result.stderr || result.stdout || fallback).trim();
}
