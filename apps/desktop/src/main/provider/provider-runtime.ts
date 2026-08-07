import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';

const maxOutputBytes = 8_000_000;

export interface ProcessOutput {
  exitCode: number;
  stdout: string;
  stderr: string;
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

export function launchLoginTerminal(options: {
  executablePath: string;
  args: string[];
  cwd: string;
  homeEnvironmentName: 'CODEX_HOME' | 'CLAUDE_CONFIG_DIR';
}): void {
  const environment = { [options.homeEnvironmentName]: options.cwd };
  const commandArgs = options.args.map((value) => `'${escapePowerShell(value)}'`).join(' ');
  const command = `$env:${options.homeEnvironmentName}='${escapePowerShell(options.cwd)}'; & '${escapePowerShell(options.executablePath)}' ${commandArgs}`;
  const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NoExit', '-Command', command], {
    cwd: options.cwd,
    detached: true,
    windowsHide: false,
    shell: false,
    stdio: 'ignore',
    env: safeEnvironment(environment),
  });
  child.unref();
}

export function collect(
  command: string,
  args: string[],
  cwd: string,
  stdin?: string,
  timeoutMs = 30_000,
  env = safeEnvironment(),
): Promise<ProcessOutput> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let bytes = 0;
    let timedOut = false;
    let settled = false;
    const finish = (result: ProcessOutput): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const append = (target: 'stdout' | 'stderr', chunk: Buffer): void => {
      const remaining = Math.max(0, maxOutputBytes - bytes);
      if (!remaining) return;
      const text = chunk.subarray(0, remaining).toString('utf8');
      bytes += Buffer.byteLength(text);
      if (target === 'stdout') stdout += text;
      else stderr += text;
    };
    child.stdout.on('data', (chunk: Buffer) => append('stdout', chunk));
    child.stderr.on('data', (chunk: Buffer) => append('stderr', chunk));
    child.once('error', (error) => finish({ exitCode: 1, stdout, stderr: `${stderr}${error.message}` }));
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.once('close', (code) => {
      clearTimeout(timer);
      if (timedOut) stderr += `\nProcess timed out after ${timeoutMs}ms.`;
      if (bytes >= maxOutputBytes) stderr += '\nOutput was truncated.';
      finish({ exitCode: code ?? 1, stdout, stderr });
    });
    if (stdin !== undefined) child.stdin.end(stdin, 'utf8');
    else child.stdin.end();
  });
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
