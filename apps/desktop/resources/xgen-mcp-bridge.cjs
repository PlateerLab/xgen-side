const net = require('node:net');
const { Transform } = require('node:stream');

const protocol = 'xgen.mcp-relay.v1';
const address = process.env.XGEN_CORE_MCP_ADDRESS;
const token = process.env.XGEN_CORE_MCP_TOKEN;

if (!address || !token || !/^[0-9a-f]{64}$/.test(token)) {
  process.stderr.write('XGEN Core MCP relay is unavailable.\n');
  process.exit(1);
}

const separator = address.lastIndexOf(':');
const host = address.slice(0, separator);
const port = Number(address.slice(separator + 1));
if (host !== '127.0.0.1' || !Number.isInteger(port) || port < 1 || port > 65_535) {
  process.stderr.write('XGEN Core MCP relay address is invalid.\n');
  process.exit(1);
}

const socket = net.createConnection({ host, port });
socket.setTimeout(5_000);
let handshake = '';

const fail = (reason = 'connection-failed') => {
  process.stderr.write(`Could not connect to the trusted XGEN Core MCP relay (${reason}).\n`);
  socket.destroy();
  process.exitCode = 1;
};

socket.once('error', (error) => fail(error?.code || 'socket-error'));
socket.once('timeout', () => fail('timeout'));
socket.once('connect', () => {
  socket.write(`${JSON.stringify({ protocol, token })}\n`);
});
socket.on('data', function onHandshake(chunk) {
  handshake += chunk.toString('utf8');
  if (handshake.length > 4_096) {
    fail('oversized-handshake');
    return;
  }
  const newline = handshake.indexOf('\n');
  if (newline < 0) return;
  let response;
  try {
    response = JSON.parse(handshake.slice(0, newline));
  } catch {
    fail('invalid-handshake');
    return;
  }
  if (response?.ok !== true) {
    fail('denied-handshake');
    return;
  }
  socket.off('data', onHandshake);
  socket.setTimeout(0);
  const remainder = handshake.slice(newline + 1);
  if (remainder) process.stdout.write(remainder);
  process.stdin.pipe(createRequestBoundary()).pipe(socket);
  socket.pipe(process.stdout);
});
socket.once('close', () => {
  if (!process.stdin.destroyed) process.stdin.pause();
});

function createRequestBoundary() {
  let pending = '';
  return new Transform({
    transform(chunk, _encoding, callback) {
      pending += chunk.toString('utf8');
      if (pending.length > 8 * 1024 * 1024) return callback(new Error('MCP request is too large.'));
      const lines = pending.split('\n');
      pending = lines.pop() || '';
      for (const line of lines) this.push(`${sanitizeRequest(line)}\n`);
      callback();
    },
    flush(callback) {
      if (pending) this.push(sanitizeRequest(pending));
      callback();
    },
  });
}

function sanitizeRequest(line) {
  let request;
  try { request = JSON.parse(line); } catch { return line; }
  if (request?.method !== 'tools/call' || !request.params?.arguments || typeof request.params.arguments !== 'object') return line;
  for (const key of ['session', 'namespace', 'extraArgs', 'allowedDomains', 'cdp', 'cdpUrl', 'provider']) {
    delete request.params.arguments[key];
  }
  return JSON.stringify(request);
}
