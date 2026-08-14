'use strict';

const net = require('node:net');

const MAX_INPUT = 16_384;

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
  if (input.length > MAX_INPUT) process.exit(2);
});
process.stdin.on('end', () => {
  void resolveCredential(input);
});

async function resolveCredential(raw) {
  try {
    const request = JSON.parse(raw);
    if (request.protocol !== 'agent-browser.plugin.v1' || request.type !== 'credential.inject' || request.capability !== 'credential.inject') {
      return reply(false);
    }
    const address = parseAddress(process.env.XGEN_CREDENTIAL_BROKER);
    const token = process.env.XGEN_CREDENTIAL_TOKEN;
    const runId = process.env.XGEN_CREDENTIAL_RUN_ID;
    if (!address || !token || !runId) return reply(false);
    const result = await callBroker(address, {
      runId,
      token,
      profileName: request.request?.profileName || '',
      itemRef: request.request?.itemRef,
      url: request.request?.url || '',
    });
    if (result.state !== 'used' || !result.injection) return reply(false);
    return reply(true, result.injection);
  } catch {
    return reply(false);
  }
}

function callBroker(address, request) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(address.port, address.host);
    let output = '';
    socket.setEncoding('utf8');
    socket.setTimeout(125_000, () => socket.destroy(new Error('timeout')));
    socket.on('connect', () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on('data', (chunk) => {
      output += chunk;
      if (output.length > MAX_INPUT) socket.destroy(new Error('response too large'));
      const newline = output.indexOf('\n');
      if (newline >= 0) {
        const line = output.slice(0, newline);
        socket.end();
        try { resolve(JSON.parse(line)); } catch (error) { reject(error); }
      }
    });
    socket.on('error', reject);
  });
}

function parseAddress(value) {
  const match = /^(127\.0\.0\.1):(\d{1,5})$/.exec(value || '');
  if (!match) return undefined;
  const port = Number(match[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return undefined;
  return { host: match[1], port };
}

function reply(success, injection) {
  process.stdout.write(JSON.stringify({
    protocol: 'agent-browser.plugin.v1',
    success,
    ...(injection ? { injection } : {}),
  }));
}
