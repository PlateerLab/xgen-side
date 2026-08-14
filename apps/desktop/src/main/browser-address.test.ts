import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeBrowserAddress } from './browser-address';

test('preserves the internal blank page used for a run-owned browser tab', () => {
  assert.equal(normalizeBrowserAddress('about:blank'), 'about:blank');
});

test('normalizes web addresses and searches non-address input', () => {
  assert.equal(normalizeBrowserAddress('example.com'), 'https://example.com/');
  assert.equal(normalizeBrowserAddress('docs.example.com/guide'), 'https://docs.example.com/guide');
  assert.equal(normalizeBrowserAddress('http://localhost:5173/path'), 'http://localhost:5173/path');
  assert.equal(normalizeBrowserAddress('hello world'), 'https://www.google.com/search?q=hello%20world');
  assert.equal(normalizeBrowserAddress('OpenAI'), 'https://www.google.com/search?q=OpenAI');
  assert.equal(normalizeBrowserAddress('오늘 날씨'), 'https://www.google.com/search?q=%EC%98%A4%EB%8A%98%20%EB%82%A0%EC%94%A8');
  assert.equal(normalizeBrowserAddress('name@example.com'), 'https://www.google.com/search?q=name%40example.com');
});
