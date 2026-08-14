import assert from 'node:assert/strict';
import test from 'node:test';
import { CommandBroker } from './command-broker';

test('executes an allowed read-only command without approval', async () => {
  const broker = new CommandBroker();
  const result = await broker.request({ shell: process.platform === 'win32' ? 'cmd' : 'zsh', script: 'whoami' });

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
