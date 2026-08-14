import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeWorkspaceState } from './workspace-state';

test('sanitizes persisted chats and browser tabs', () => {
  const state = sanitizeWorkspaceState({
    activeChatId: 'chat-1',
    chats: [{ id: 'chat-1', title: '  Saved   chat  ', time: '방금' }],
    chatMessages: {
      'chat-1': [{
        id: 'message-1',
        role: 'user',
        content: 'hello',
        artifacts: [{
          id: 'artifact-1',
          sessionId: '86e6492d-c830-4ec8-9e12-274dadbdcd24',
          name: '수정 결과.docx',
          kind: 'docx',
          relativePath: 'artifacts/수정 결과.docx',
          size: 128,
        }],
      }],
      orphan: [{ id: 'message-2', role: 'assistant', content: 'ignored' }],
    },
    browser: { urls: ['https://example.com/path', 'file:///private/data'], activeIndex: 4 },
  });
  assert.equal(state.activeChatId, 'chat-1');
  assert.equal(state.chats[0]?.title, 'Saved chat');
  assert.equal(state.chatMessages['chat-1']?.[0]?.content, 'hello');
  assert.equal(state.chatMessages['chat-1']?.[0]?.artifacts?.[0]?.name, '수정 결과.docx');
  assert.equal(state.chatMessages.orphan, undefined);
  assert.deepEqual(state.browser, { urls: ['https://example.com/path'], activeIndex: 0 });
});

test('recovers a usable default workspace from invalid data', () => {
  const state = sanitizeWorkspaceState({ chats: [], browser: { urls: ['javascript:alert(1)'] } });
  assert.equal(state.chats[0]?.title, 'New Chat');
  assert.deepEqual(state.browser.urls, ['about:blank']);
});

test('persists the observed run timeline and rejects unsafe snapshot payloads', () => {
  const state = sanitizeWorkspaceState({
    activeChatId: 'chat-1',
    chats: [{ id: 'chat-1', title: 'Naver login', time: '' }],
    chatMessages: {
      'chat-1': [{
        id: 'overview-1',
        role: 'assistant',
        content: '',
        overview: {
          status: 'running',
          prompt: '네이버 로그인해줘',
          route: {
            id: 'route-1',
            resolvedMode: 'browser-agent',
            reason: 'Login requires a browser',
            browserVisible: true,
            agentBrowserRequired: true,
            browserActionCategories: ['navigate', 'click'],
            skills: [],
            steps: [],
          },
          activities: [{ id: 'activity-1', name: 'xgen_browser.agent_browser_tab_list', phase: 'completed' }],
          snapshots: [
            { id: 'safe', tabId: 'tab-1', title: 'NAVER', url: 'https://naver.com', capturedAt: '2026-08-13T00:00:00Z', reason: 'state', imageDataUrl: 'data:image/jpeg;base64,AA==' },
            { id: 'raw-login', tabId: 'tab-1', title: 'Login', url: 'https://example.com/login', capturedAt: '2026-08-13T00:00:00Z', reason: 'state', imageDataUrl: 'data:image/jpeg;base64,AA==' },
            { id: 'redacted-login', tabId: 'tab-1', title: 'Login', url: 'https://example.com/login', capturedAt: '2026-08-13T00:00:00Z', reason: '보호된 로그인 화면 상단 · state', imageDataUrl: 'data:image/jpeg;base64,AA==' },
            { id: 'unsafe', imageDataUrl: 'file:///private/passwords' },
          ],
        },
      }],
    },
    browser: { urls: ['about:blank'], activeIndex: 0 },
  });
  const overview = state.chatMessages['chat-1']?.[0]?.overview;
  assert.equal(overview?.status, 'cancelled');
  assert.equal(overview?.activities?.[0]?.name, 'xgen_browser.agent_browser_tab_list');
  assert.deepEqual(overview?.snapshots?.map((snapshot) => snapshot.id), ['safe', 'redacted-login']);
});
