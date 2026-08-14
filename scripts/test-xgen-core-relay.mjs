import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { arch, platform, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const extension = platform() === 'win32' ? '.exe' : '';
const daemonPath = join(repositoryRoot, 'bin', `xgen-daemon-${platform()}-${arch()}${extension}`);
const enginePath = join(repositoryRoot, 'bin', `agent-browser-${platform()}-${arch()}${extension}`);
const bridgePath = join(repositoryRoot, 'apps', 'desktop', 'resources', 'xgen-mcp-bridge.cjs');
const inheritedNames = platform() === 'win32'
  ? ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'PATH', 'PATHEXT', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'COMSPEC']
  : ['HOME', 'USER', 'SHELL', 'TMPDIR', 'PATH', 'LANG', 'LC_ALL'];
const engineEnvironment = Object.fromEntries(
  inheritedNames.flatMap((name) => process.env[name] ? [[name, process.env[name]]] : []),
);

for (const path of [daemonPath, enginePath, bridgePath]) {
  if (!existsSync(path)) throw new Error(`Required relay test artifact is missing: ${path}`);
}

const storageRoot = mkdtempSync(join(tmpdir(), 'xgen-core-smoke-'));
const daemon = spawn(daemonPath, [], {
  env: { XGEN_CORE_DATA_ROOT: storageRoot },
  stdio: ['pipe', 'pipe', 'pipe'],
});
const pending = new Map();
let output = '';
let daemonError = '';
daemon.stdout.setEncoding('utf8');
daemon.stderr.setEncoding('utf8');
daemon.stderr.on('data', (chunk) => { daemonError += chunk; });
daemon.stdout.on('data', (chunk) => {
  output += chunk;
  while (output.includes('\n')) {
    const newline = output.indexOf('\n');
    const line = output.slice(0, newline);
    output = output.slice(newline + 1);
    const response = JSON.parse(line);
    const handler = pending.get(response.id);
    if (handler) {
      pending.delete(response.id);
      handler(response);
    }
  }
});

const request = (method, params, sessionToken) => new Promise((resolve, reject) => {
  const id = randomUUID();
  const timer = setTimeout(() => {
    pending.delete(id);
    reject(new Error(`XGEN Core ${method} timed out.`));
  }, 10_000);
  pending.set(id, (response) => {
    clearTimeout(timer);
    if (response.ok) resolve(response.result);
    else reject(new Error(response.error?.message || `XGEN Core ${method} failed.`));
  });
  daemon.stdin.write(`${JSON.stringify({
    protocol: 'xgen.core.v1',
    id,
    method,
    ...(sessionToken ? { sessionToken } : {}),
    params,
  })}\n`);
});

try {
  const sessionToken = randomBytes(32).toString('hex');
  await request('handshake', { sessionToken });
  await request('storage.write', { key: 'settings', content: '{"schemaVersion":1}' }, sessionToken);
  const stored = await request('storage.read', { key: 'settings' }, sessionToken);
  if (stored?.content !== '{"schemaVersion":1}') throw new Error('XGEN Core storage smoke test failed.');
  const relay = await request('browser.start', {
    runId: 'relay-smoke-test',
    enginePath,
    toolProfiles: ['core'],
    environment: {
      ...engineEnvironment,
      AGENT_BROWSER_CDP: 'http://127.0.0.1:9',
      AGENT_BROWSER_SESSION: 'xgen-core-relay-smoke-test',
    },
  }, sessionToken);
  if (relay?.state !== 'ready' || typeof relay.address !== 'string' || typeof relay.token !== 'string') {
    throw new Error('XGEN Core did not create a relay.');
  }

  const initializeResponse = await initializeMcpRelay(relay.address, relay.token);
  if (initializeResponse?.id !== 1 || !initializeResponse.result) {
    throw new Error(`MCP initialize failed: ${JSON.stringify(initializeResponse)}`);
  }
  await request('browser.stop', { runId: 'relay-smoke-test' }, sessionToken);
  await request('shutdown', {}, sessionToken);
  daemon.stdin.end();
  process.stdout.write('XGEN Core browser relay smoke test passed.\n');
} finally {
  daemon.kill();
  rmSync(storageRoot, { recursive: true, force: true });
  if (daemonError) process.stderr.write(daemonError);
}

function initializeMcpRelay(address, token) {
  return new Promise((resolve, reject) => {
    const bridge = spawn(process.execPath, [bridgePath], {
      env: {
        XGEN_CORE_MCP_ADDRESS: address,
        XGEN_CORE_MCP_TOKEN: token,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => {
      bridge.kill();
      reject(new Error('Bridged MCP relay initialize timed out.'));
    }, 15_000);
    let stderr = '';
    let buffer = '';
    bridge.stdout.setEncoding('utf8');
    bridge.stderr.setEncoding('utf8');
    bridge.stderr.on('data', (chunk) => { stderr += chunk; });
    bridge.once('error', reject);
    bridge.once('close', (code) => {
      if (buffer.includes('\n')) return;
      clearTimeout(timer);
      reject(new Error(`MCP bridge exited with code ${code ?? 1}. ${stderr}`.trim()));
    });
    bridge.stdout.on('data', (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      const message = JSON.parse(buffer.slice(0, newline));
      clearTimeout(timer);
      bridge.kill();
      resolve(message);
    });
    bridge.stdin.end(`${JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'xgen-core-relay-smoke-test', version: '1.0.0' },
      },
    })}\n`);
  });
}
