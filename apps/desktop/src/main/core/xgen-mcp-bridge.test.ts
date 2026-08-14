import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { join } from 'node:path';
import test from 'node:test';

test('relays MCP stdio after a private run-scoped handshake', async () => {
  const token = 'a'.repeat(64);
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const accepted = new Promise<void>((resolve, reject) => {
    server.once('connection', (socket) => {
      socket.setEncoding('utf8');
      let input = '';
      const onHandshake = (chunk: string): void => {
        input += chunk;
        const newline = input.indexOf('\n');
        if (newline < 0) return;
        const hello = JSON.parse(input.slice(0, newline)) as Record<string, unknown>;
        assert.deepEqual(hello, { protocol: 'xgen.mcp-relay.v1', token });
        socket.off('data', onHandshake);
        socket.write('{"ok":true}\n');
        socket.on('data', (message: string) => {
          assert.equal(message, 'mcp-request\n');
          socket.end('mcp-response\n');
        });
        resolve();
      };
      socket.on('data', onHandshake);
      socket.once('error', reject);
    });
  });
  const bridgePath = join(process.cwd(), 'resources', 'xgen-mcp-bridge.cjs');
  const child = spawn(process.execPath, [bridgePath], {
    env: {
      XGEN_CORE_MCP_ADDRESS: `127.0.0.1:${address.port}`,
      XGEN_CORE_MCP_TOKEN: token,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => { stdout += chunk; });
  child.stderr.on('data', (chunk: string) => { stderr += chunk; });
  child.stdin.end('mcp-request\n');
  await accepted;
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  await new Promise<void>((resolve) => server.close(() => resolve()));
  assert.equal(exitCode, 0);
  assert.equal(stdout, 'mcp-response\n');
  assert.equal(stderr, '');
  assert.equal(stdout.includes(token), false);
});

test('strips provider-controlled browser connection overrides', async () => {
  const token = 'b'.repeat(64);
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const received = new Promise<Record<string, unknown>>((resolve, reject) => {
    server.once('connection', (socket) => {
      socket.setEncoding('utf8');
      let input = '';
      socket.on('data', (chunk: string) => {
        input += chunk;
        const lines = input.split('\n');
        if (lines.length < 2) return;
        if (JSON.parse(lines[0]!).protocol === 'xgen.mcp-relay.v1') {
          socket.write('{"ok":true}\n');
          input = lines.slice(1).join('\n');
          return;
        }
        const request = JSON.parse(lines[0]!) as Record<string, unknown>;
        socket.end();
        resolve(request);
      });
      socket.once('error', reject);
    });
  });
  const bridgePath = join(process.cwd(), 'resources', 'xgen-mcp-bridge.cjs');
  const child = spawn(process.execPath, [bridgePath], {
    env: { XGEN_CORE_MCP_ADDRESS: `127.0.0.1:${address.port}`, XGEN_CORE_MCP_TOKEN: token },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stderr.resume();
  child.stdout.resume();
  child.stdin.end(`${JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name: 'agent_browser_open', arguments: { url: 'https://example.com', session: 'attacker', allowedDomains: ['example.com'], extraArgs: ['--cdp', '9222'] } },
  })}\n`);
  const request = received;
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', () => resolve());
  });
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const params = (await request).params as { arguments: Record<string, unknown> };
  assert.deepEqual(params.arguments, { url: 'https://example.com' });
});
