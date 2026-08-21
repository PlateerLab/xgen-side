import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { delimiter, join } from 'node:path';

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
  const paths = new Set(candidates);
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

  if (process.platform !== 'win32') {
    await launchPosixLoginTerminal(options, environment);
    return;
  }

  const commandArgs = options.args.map((value) => `'${escapePowerShell(value)}'`).join(' ');
  const command = `$env:${options.homeEnvironmentName}='${escapePowerShell(options.cwd)}'; & '${escapePowerShell(options.executablePath)}' ${commandArgs}`;

  const encodedCommand = Buffer.from(command, 'utf16le').toString('base64');
  const launcher = [
    "$process = Start-Process -FilePath 'powershell.exe'",
    `-WorkingDirectory '${escapePowerShell(options.cwd)}'`,
    `-ArgumentList @('-NoLogo','-NoProfile','-NoExit','-EncodedCommand','${encodedCommand}')`,
    '-WindowStyle Normal -PassThru',
  ].join(' ');
  const verifiedLauncher = `${launcher}; if (-not $process) { throw 'Could not open the provider login terminal.' }`;
  const result = await collect(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', verifiedLauncher],
    options.cwd,
    undefined,
    10_000,
    safeEnvironment(environment),
  );
  if (result.exitCode !== 0) {
    throw new Error((result.stderr || result.stdout || 'Could not open the provider login terminal.').trim());
  }
}

/**
 * Opens the provider login flow in the user's own terminal. The login stays inside the
 * official CLI, so XGEN Side never handles the subscription credentials itself.
 */
async function launchPosixLoginTerminal(
  options: { executablePath: string; args: string[]; cwd: string; homeEnvironmentName: string },
  environment: Record<string, string>,
): Promise<void> {
  const script = [
    `export ${options.homeEnvironmentName}=${escapePosix(options.cwd)}`,
    `cd ${escapePosix(options.cwd)}`,
    [escapePosix(options.executablePath), ...options.args.map(escapePosix)].join(' '),
  ].join('; ');

  if (process.platform === 'darwin') {
    const appleScript = `tell application "Terminal"\nactivate\ndo script ${escapeAppleScript(script)}\nend tell`;
    const result = await collect('/usr/bin/osascript', ['-e', appleScript], options.cwd, undefined, 10_000, safeEnvironment(environment));
    if (result.exitCode !== 0) {
      throw new Error((result.stderr || result.stdout || 'Could not open the provider login terminal.').trim());
    }
    return;
  }

  const emulators = [
    { command: 'x-terminal-emulator', args: ['-e', 'bash', '-lc', script] },
    { command: 'gnome-terminal', args: ['--', 'bash', '-lc', script] },
    { command: 'konsole', args: ['-e', 'bash', '-lc', script] },
    { command: 'xterm', args: ['-e', 'bash', '-lc', script] },
  ];
  for (const emulator of emulators) {
    const [executable] = await executablesOnPath(emulator.command);
    if (!executable) continue;
    const child = spawn(executable, emulator.args, {
      cwd: options.cwd,
      detached: true,
      shell: false,
      stdio: 'ignore',
      env: safeEnvironment(environment),
    });
    child.once('error', () => undefined);
    child.unref();
    return;
  }
  throw new Error('Could not find a terminal emulator to open the provider login flow.');
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
          terminateProcessTree(child.pid);
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
      terminateProcessTree(child.pid);
    }, timeoutMs);
    const abort = (): void => {
      cancelled = true;
      terminateProcessTree(child.pid);
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
      await access(candidate, constants.X_OK);
      found.push(candidate);
    } catch {
      // Most PATH entries do not hold this executable.
    }
  }
  return found;
}

function terminateProcessTree(pid: number | undefined): void {
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
  setTimeout(() => signalProcessTree(pid, 'SIGKILL'), 2_000).unref();
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

const sharedEnvironmentNames = ['PATH', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'CODEX_CA_CERTIFICATE', 'SSL_CERT_FILE'];
const windowsEnvironmentNames = ['SystemRoot', 'WINDIR', 'PATHEXT', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'COMSPEC'];
// POSIX provider CLIs resolve their configuration and credential store from HOME. Dropping
// it makes an authenticated Codex or Claude CLI report itself as signed out.
const posixEnvironmentNames = ['HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'TMPDIR', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME'];

export function safeEnvironment(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const names = process.platform === 'win32'
    ? [...sharedEnvironmentNames, ...windowsEnvironmentNames]
    : [...sharedEnvironmentNames, ...posixEnvironmentNames];
  const env: NodeJS.ProcessEnv = {};
  for (const name of names) if (process.env[name]) env[name] = process.env[name];
  return { ...env, ...extra };
}

export function authError(result: ProcessOutput | undefined, fallback: string): string | undefined {
  if (!result || result.exitCode === 0) return undefined;
  return (result.stderr || result.stdout || fallback).trim();
}

function escapePowerShell(value: string): string {
  return value.replace(/'/g, "''");
}

function escapePosix(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function escapeAppleScript(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
