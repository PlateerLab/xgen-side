import assert from 'node:assert/strict';
import test from 'node:test';
import { selectBrowserCdpEndpoint } from './browser-cdp';

test('uses the browser CDP port when the active page target exists', () => {
  const endpoint = selectBrowserCdpEndpoint(5975, 'https://www.google.com/', [
    { type: 'page', url: 'http://localhost:5173/' },
    { type: 'page', url: 'https://www.google.com/' },
  ]);

  assert.equal(endpoint, '5975');
});

test('does not expose CDP when no visible browser page exists', () => {
  const endpoint = selectBrowserCdpEndpoint(5975, 'about:blank', [
    { type: 'page', url: 'http://localhost:5173/' },
  ]);

  assert.equal(endpoint, undefined);
});
