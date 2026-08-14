'use strict';

const MAX_INPUT = 16_384;
let input = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
  if (input.length > MAX_INPUT) process.exit(2);
});
process.stdin.on('end', () => {
  let request;
  try { request = JSON.parse(input); } catch { return reply(false); }
  if (request.protocol !== 'agent-browser.plugin.v1' || request.capability !== 'browser.provider') return reply(false);
  if (request.type === 'browser.close') return reply(true);
  const cdpUrl = process.env.XGEN_PRIVATE_CDP_URL;
  if (request.type !== 'browser.launch' || !/^ws:\/\/127\.0\.0\.1:\d+\/xgen-cdp\/[0-9a-f]{64}$/.test(cdpUrl || '')) return reply(false);
  reply(true, { cdpUrl, directPage: true });
});

function reply(success, browser) {
  process.stdout.write(JSON.stringify({
    protocol: 'agent-browser.plugin.v1',
    success,
    ...(browser ? { browser } : {}),
  }));
}
