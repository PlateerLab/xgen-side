import assert from 'node:assert/strict';
import test from 'node:test';
import { agentBrowserBinaryName, executableCandidatesFromPath, inheritedEnvironmentNames, loginTerminalLaunchSpec, xgenDaemonBinaryName } from './platform-runtime';

test('selects the packaged browser engine for macOS and Windows', () => {
  assert.equal(agentBrowserBinaryName('darwin', 'arm64'), 'agent-browser-darwin-arm64');
  assert.equal(agentBrowserBinaryName('darwin', 'x64'), 'agent-browser-darwin-x64');
  assert.equal(agentBrowserBinaryName('win32', 'arm64'), 'agent-browser-win32-arm64.exe');
  assert.equal(agentBrowserBinaryName('win32', 'x64'), 'agent-browser-win32-x64.exe');
  assert.equal(xgenDaemonBinaryName('darwin', 'arm64'), 'xgen-daemon-darwin-arm64');
  assert.equal(xgenDaemonBinaryName('win32', 'x64'), 'xgen-daemon-win32-x64.exe');
});

test('finds provider executables from platform-specific search locations', () => {
  const mac = executableCandidatesFromPath('codex', 'darwin', { PATH: '/custom/bin', HOME: '/Users/test' });
  assert.ok(mac.includes('/custom/bin/codex'));
  assert.ok(mac.includes('/opt/homebrew/bin/codex'));
  assert.ok(mac.includes('/Users/test/.local/bin/codex'));

  const windows = executableCandidatesFromPath('codex', 'win32', {
    PATH: 'C:\\Tools',
    PATHEXT: '.EXE;.CMD',
    APPDATA: 'C:\\Users\\test\\AppData\\Roaming',
  });
  assert.ok(windows.some((candidate) => candidate.toLowerCase().endsWith('codex.exe')));
  assert.ok(windows.some((candidate) => candidate.toLowerCase().endsWith('codex.cmd')));
});

test('creates native login terminal launch specifications', () => {
  const mac = loginTerminalLaunchSpec('darwin', {
    executablePath: '/opt/homebrew/bin/codex',
    args: ['login'],
    cwd: '/Users/test/XGEN Data',
    homeEnvironmentName: 'CODEX_HOME',
  });
  assert.equal(mac.command, '/usr/bin/osascript');
  assert.match(mac.args.join(' '), /Terminal/);
  assert.match(mac.args.join(' '), /CODEX_HOME/);

  const windows = loginTerminalLaunchSpec('win32', {
    executablePath: 'C:\\Tools\\codex.exe',
    args: ['login'],
    cwd: 'C:\\Users\\test\\XGEN Data',
    homeEnvironmentName: 'CODEX_HOME',
  });
  assert.equal(windows.command, 'powershell.exe');
  assert.ok(windows.args.includes('-NonInteractive'));
});

test('preserves platform environment required by provider CLIs', () => {
  assert.ok(inheritedEnvironmentNames('darwin').includes('HOME'));
  assert.ok(inheritedEnvironmentNames('win32').includes('USERPROFILE'));
});
