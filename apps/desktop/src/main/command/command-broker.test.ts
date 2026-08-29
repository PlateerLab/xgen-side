import assert from 'node:assert/strict';
import test from 'node:test';
import { CommandBroker, defaultShellForPlatform, shellCommand } from './command-broker';

test('executes an allowed read-only command without approval', async () => {
  const broker = new CommandBroker();
  // `whoami` is on the read-only baseline and exists in every supported shell.
  const result = await broker.request({
    shell: defaultShellForPlatform(process.platform),
    script: 'whoami',
  });

  assert.equal(result.state, 'completed');
  assert.equal(result.exitCode, 0);
  assert.ok(result.stdout?.trim());
});

test('creates a one-time approval for an unknown command', async () => {
  const broker = new CommandBroker();
  const result = await broker.request({ shell: 'powershell', script: 'dotnet test' });

  assert.equal(result.state, 'approval-required');
  assert.ok(result.approvalToken);
});

test('does not create a process for a denied command', async () => {
  const broker = new CommandBroker();
  const result = await broker.request({
    shell: 'powershell',
    script: 'Remove-Item C:\\important -Recurse -Force',
  });

  assert.equal(result.state, 'denied');
  assert.equal(result.approvalToken, undefined);
});

test('records command decisions before returning them', async () => {
  const recorded: string[] = [];
  const broker = new CommandBroker(async (_request, result) => {
    recorded.push(result.state);
  });

  await broker.request({ shell: 'powershell', script: 'dotnet test' });
  await broker.request({ shell: 'powershell', script: 'Remove-Item C:\\important -Recurse -Force' });

  assert.deepEqual(recorded, ['approval-required', 'denied']);
});

test('runs POSIX shells through a login shell and PowerShell without a profile', () => {
  assert.deepEqual(shellCommand('zsh', 'ls', { platform: 'darwin', powershellFallback: false }), {
    command: 'zsh',
    args: ['-lc', 'ls'],
  });
  assert.deepEqual(shellCommand('bash', 'ls', { platform: 'linux', powershellFallback: false }), {
    command: 'bash',
    args: ['-lc', 'ls'],
  });
  assert.equal(
    shellCommand('powershell', 'ls', { platform: 'win32', powershellFallback: false }).command,
    'pwsh.exe',
  );
  assert.equal(
    shellCommand('powershell', 'ls', { platform: 'win32', powershellFallback: true }).command,
    'powershell.exe',
  );
});

test('drops the .exe suffix for PowerShell on POSIX', () => {
  assert.equal(
    shellCommand('powershell', 'ls', { platform: 'darwin', powershellFallback: false }).command,
    'pwsh',
  );
});

test('rejects a shell that cannot exist on the running platform', () => {
  assert.throws(
    () => shellCommand('cmd', 'dir', { platform: 'darwin', powershellFallback: false }),
    /cmd shell is not available on darwin/,
  );
  assert.throws(
    () => shellCommand('wsl', 'ls', { platform: 'darwin', powershellFallback: false }),
    /wsl shell is not available on darwin/,
  );
  assert.throws(
    () => shellCommand('zsh', 'ls', { platform: 'win32', powershellFallback: false }),
    /zsh shell is not available on win32/,
  );
});

test('reports an unavailable shell as a failed run rather than throwing', async () => {
  const broker = new CommandBroker();
  const unavailable = process.platform === 'win32' ? 'zsh' : 'cmd';
  const result = await broker.request({ shell: unavailable, script: 'whoami' });

  assert.equal(result.state, 'failed');
  assert.match(result.stderr ?? '', /is not available on/);
});

test('picks a shell that exists on each platform', () => {
  assert.equal(defaultShellForPlatform('win32'), 'powershell');
  assert.equal(defaultShellForPlatform('darwin'), 'zsh');
  assert.equal(defaultShellForPlatform('linux'), 'bash');
});
