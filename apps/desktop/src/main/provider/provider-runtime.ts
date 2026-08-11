import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';

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
}

export async function locateNativeExecutable(
  name: string,
  candidates: string[] = [],
): Promise<{ path: string; version: string } | undefined> {
  const paths = new Set(candidates);
  const fromPath = await collect('where.exe', [`${name}.exe`], process.cwd(), undefined, 5_000);
  for (const line of fromPath.stdout.split(/\r?\n/)) if (line.trim()) paths.add(line.trim());

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
  const commandArgs = options.args.map((value) => `'${escapePowerShell(value)}'`).join(' ');
  const command = `$env:${options.homeEnvironmentName}='${escapePowerShell(options.cwd)}'; & '${escapePowerShell(options.executablePath)}' ${commandArgs}`;

  if (process.platform === 'win32') {
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
    return;
  }

  const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NoExit', '-Command', command], {
    cwd: options.cwd,
    detached: true,
    windowsHide: false,
    shell: false,
    stdio: 'ignore',
    env: safeEnvironment(environment),
  });
  child.once('error', () => undefined);
  child.unref();
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
    const child = spawn(command, args, { cwd, env, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let stdoutLines = '';
    let stderrLines = '';
    let bytes = 0;
    let timedOut = false;
    let cancelled = false;
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
      for (const line of lines) listener?.(line);
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
      finish({ exitCode: code ?? 1, stdout, stderr, cancelled });
    });
    if (stdin !== undefined) child.stdin.end(stdin, 'utf8');
    else child.stdin.end();
  });
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
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // The process may already have exited.
  }
}

export function safeEnvironment(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const names = ['SystemRoot', 'WINDIR', 'PATH', 'PATHEXT', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'COMSPEC', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'CODEX_CA_CERTIFICATE', 'SSL_CERT_FILE'];
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
