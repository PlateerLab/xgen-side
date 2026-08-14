import { join, posix, win32 } from 'node:path';

export type DesktopPlatform = 'darwin' | 'win32';
export type DesktopArchitecture = 'arm64' | 'x64';

export interface LoginTerminalOptions {
  executablePath: string;
  args: string[];
  cwd: string;
  homeEnvironmentName: 'CODEX_HOME' | 'CLAUDE_CONFIG_DIR';
}

export interface ProcessLaunchSpec {
  command: string;
  args: string[];
}

export function currentDesktopPlatform(platform: NodeJS.Platform = process.platform): DesktopPlatform {
  if (platform === 'darwin' || platform === 'win32') return platform;
  throw new Error(`XGEN Side desktop does not support ${platform}.`);
}

export function currentDesktopArchitecture(architecture: NodeJS.Architecture = process.arch): DesktopArchitecture {
  return architecture === 'arm64' ? 'arm64' : 'x64';
}

export function agentBrowserBinaryName(platform: DesktopPlatform, architecture: DesktopArchitecture): string {
  const extension = platform === 'win32' ? '.exe' : '';
  return `agent-browser-${platform}-${architecture}${extension}`;
}

export function xgenDaemonBinaryName(platform: DesktopPlatform, architecture: DesktopArchitecture): string {
  const extension = platform === 'win32' ? '.exe' : '';
  return `xgen-daemon-${platform}-${architecture}${extension}`;
}

export function executableCandidatesFromPath(
  name: string,
  platform: DesktopPlatform,
  environment: NodeJS.ProcessEnv = process.env,
): string[] {
  const paths = platform === 'win32' ? win32 : posix;
  const pathDirectories = (environment.PATH ?? '').split(platform === 'win32' ? ';' : ':').filter(Boolean);
  const home = environment.HOME || environment.USERPROFILE;
  const commonDirectories = platform === 'darwin'
    ? ['/opt/homebrew/bin', '/usr/local/bin', ...(home ? [join(home, '.local', 'bin'), join(home, '.npm-global', 'bin')] : [])]
    : [
        ...(environment.APPDATA ? [win32.join(environment.APPDATA, 'npm')] : []),
        ...(environment.LOCALAPPDATA ? [win32.join(environment.LOCALAPPDATA, 'Programs')] : []),
      ];
  const extensions = platform === 'win32'
    ? (environment.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').filter(Boolean).map((extension) => extension.toLowerCase())
    : [''];
  const directories = [...new Set([...pathDirectories, ...commonDirectories])];
  return directories.flatMap((directory) => extensions.map((extension) => paths.join(directory, `${name}${extension}`)));
}

export function loginTerminalLaunchSpec(platform: DesktopPlatform, options: LoginTerminalOptions): ProcessLaunchSpec {
  if (platform === 'win32') {
    const command = `$env:${options.homeEnvironmentName}=${powerShellQuote(options.cwd)}; & ${powerShellQuote(options.executablePath)} ${options.args.map(powerShellQuote).join(' ')}`;
    const encodedCommand = Buffer.from(command, 'utf16le').toString('base64');
    const launcher = [
      "$process = Start-Process -FilePath 'powershell.exe'",
      `-WorkingDirectory ${powerShellQuote(options.cwd)}`,
      `-ArgumentList @('-NoLogo','-NoProfile','-NoExit','-EncodedCommand','${encodedCommand}')`,
      '-WindowStyle Normal -PassThru',
      "; if (-not $process) { throw 'Could not open the provider login terminal.' }",
    ].join(' ');
    return { command: 'powershell.exe', args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', launcher] };
  }

  const shellCommand = [
    `cd ${shellQuote(options.cwd)}`,
    `export ${options.homeEnvironmentName}=${shellQuote(options.cwd)}`,
    `exec ${shellQuote(options.executablePath)} ${options.args.map(shellQuote).join(' ')}`,
  ].join(' && ');
  const script = `tell application "Terminal" to do script "${appleScriptString(shellCommand)}"`;
  return { command: '/usr/bin/osascript', args: ['-e', script] };
}

export function inheritedEnvironmentNames(platform: DesktopPlatform): string[] {
  const shared = ['PATH', 'TEMP', 'TMP', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'CODEX_CA_CERTIFICATE', 'SSL_CERT_FILE', 'LANG', 'LC_ALL'];
  return platform === 'win32'
    ? ['SystemRoot', 'WINDIR', 'PATHEXT', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'COMSPEC', ...shared]
    : ['HOME', 'USER', 'SHELL', 'TMPDIR', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', ...shared];
}

function powerShellQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function appleScriptString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
