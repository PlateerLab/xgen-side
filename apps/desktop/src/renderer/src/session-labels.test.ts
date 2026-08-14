import assert from 'node:assert/strict';
import test from 'node:test';
import type { BrowserTabState } from '../../shared/contracts';
import { browserTabTitle, promptTitle } from './session-labels';

function tab(overrides: Partial<BrowserTabState>): BrowserTabState {
  return {
    active: true,
    canGoBack: false,
    canGoForward: false,
    id: 'tab-1',
    loading: false,
    owner: 'user',
    title: '',
    url: 'about:blank',
    ...overrides,
  };
}

test('uses a concise chat title for Ask AI transitions', () => {
  assert.equal(promptTitle('  여러   공백을 포함한 질문  '), '여러 공백을 포함한 질문');
  assert.equal(promptTitle('a'.repeat(40)), `${'a'.repeat(31)}…`);
});

test('labels blank and searched browser tabs', () => {
  assert.equal(browserTabTitle(tab({})), 'New tab');
  assert.equal(browserTabTitle(tab({ title: 'https://www.google.com/search?q=OpenAI%20Codex', url: 'https://www.google.com/search?q=OpenAI%20Codex' })), 'OpenAI Codex');
});

test('recovers a search title from a Google challenge redirect', () => {
  const continued = encodeURIComponent('https://www.google.com/search?q=XGEN%20Side');
  assert.equal(browserTabTitle(tab({ title: 'https://www.google.com/search?q=XGEN%20Side', url: `https://www.google.com/sorry/index?continue=${continued}&q=challenge` })), 'XGEN Side');
});
