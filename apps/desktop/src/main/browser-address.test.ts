import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeBrowserAddress } from './browser-address';

test('preserves the internal blank page used for a run-owned browser tab', () => {
  assert.equal(normalizeBrowserAddress('about:blank'), 'about:blank');
});

test('normalizes web addresses and searches non-address input', () => {
  assert.equal(normalizeBrowserAddress('example.com'), 'https://example.com/');
  assert.equal(normalizeBrowserAddress('hello world'), 'https://www.google.com/search?q=hello%20world');
});
