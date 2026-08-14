import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { join } from 'node:path';
import test from 'node:test';
import { CredentialBroker } from './credential-broker';

const tabId = '123e4567-e89b-42d3-a456-426614174000';

test('injects an exact-origin credential once without returning plaintext', async () => {
  const injection = {
    async inject(runId: string, requestedTabId: string, pageUrl: string) {
      assert.equal(runId, 'run-1');
      assert.equal(requestedTabId, tabId);
      if (new URL(pageUrl).origin !== 'https://nid.naver.com') return { state: 'not-found' as const };
      return { state: 'filled' as const, usernameFilled: true, submitted: true };
    },
  };
  const broker = new CredentialBroker(injection);
  await broker.start();
  const connection = broker.registerRun('run-1', tabId, (approval) => {
    assert.equal(JSON.parse(approval.detail).origin, 'https://nid.naver.com');
    assert.equal(broker.respond('run-1', approval.id, 'allow'), true);
  });
  const request = {
    runId: 'run-1',
    token: connection.token,
    profileName: 'nid.naver.com',
    url: 'https://nid.naver.com/nidlogin.login',
  };
  const first = await requestBroker(connection.address, request);
  assert.equal(first.state, 'used');
  assert.deepEqual(first.injection, {
    state: 'filled',
    usernameFilled: true,
    submitted: true,
  });
  assert.equal(JSON.stringify(first).includes('password'), false);
  const second = await requestBroker(connection.address, request);
  assert.equal(second.state, 'denied');
  await broker.close();
});

test('denies invalid tokens without touching the trusted injector', async () => {
  let used = false;
  const broker = new CredentialBroker({
    async inject() {
      used = true;
      return { state: 'not-found' as const };
    },
  });
  await broker.start();
  const connection = broker.registerRun('run-2', tabId, () => assert.fail('invalid tokens must not request approval'));
  const response = await requestBroker(connection.address, {
    runId: 'run-2',
    token: '0'.repeat(64),
    profileName: 'example.com',
    url: 'https://example.com/login',
  });
  assert.equal(response.state, 'denied');
  assert.equal(used, false);
  await broker.close();
});

test('credential plugin forwards only injection state without writing stderr', async () => {
  const broker = new CredentialBroker({
    async inject() {
      return { state: 'filled' as const, usernameFilled: true, submitted: true };
    },
  });
  await broker.start();
  const connection = broker.registerRun('run-plugin', tabId, (approval) => {
    assert.equal(broker.respond('run-plugin', approval.id, 'allow'), true);
  });
  const result = await runPlugin(join(process.cwd(), 'resources', 'xgen-credential-plugin.cjs'), {
    XGEN_CREDENTIAL_BROKER: connection.address,
    XGEN_CREDENTIAL_TOKEN: connection.token,
    XGEN_CREDENTIAL_RUN_ID: 'run-plugin',
  }, {
    protocol: 'agent-browser.plugin.v1',
    type: 'credential.inject',
    capability: 'credential.inject',
    request: { profileName: 'nid.naver.com', url: 'https://nid.naver.com/nidlogin.login' },
  });
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), {
    protocol: 'agent-browser.plugin.v1',
    success: true,
    injection: {
      state: 'filled',
      usernameFilled: true,
      submitted: true,
    },
  });
  assert.equal(result.stdout.includes('plugin-secret'), false);
  assert.equal(result.stdout.includes('password'), false);
  await broker.close();
});

function requestBroker(address: string, request: object): Promise<Record<string, unknown>> {
  const [host, portText] = address.split(':');
  return new Promise((resolve, reject) => {
    const socket = connect(Number(portText), host);
    let output = '';
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on('data', (chunk) => {
      output += chunk;
      const newline = output.indexOf('\n');
      if (newline < 0) return;
      socket.end();
      resolve(JSON.parse(output.slice(0, newline)) as Record<string, unknown>);
    });
    socket.on('error', reject);
  });
}

function runPlugin(path: string, environment: Record<string, string>, request: object): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path], {
      env: { ...process.env, ...environment },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`plugin exited ${code}`)));
    child.stdin.end(JSON.stringify(request));
  });
}
