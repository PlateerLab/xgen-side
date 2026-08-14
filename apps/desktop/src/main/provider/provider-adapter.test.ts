import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { ClaudeCodeAdapter } from './claude-code-adapter';
import { CodexAdapter, codexBrowserMcpOverrides, codexCompatibilityError, codexMacExecutableCandidates, codexNpmExecutableCandidates } from './codex-adapter';
import type { LocalRunStore } from '../storage/local-run-store';
import { buildPrompt } from './provider-prompt';
import type { AgentRunRequest, SkillRoute } from '../../shared/contracts';
import type { BrowserBridge } from './provider-adapter';

const unusedStore = {} as LocalRunStore;

test('Codex adapter extracts the final agent message from JSONL', () => {
  const adapter = new CodexAdapter(unusedStore);
  const output = [
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'first' } }),
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'final answer' } }),
  ].join('\n');
  assert.equal(adapter.parseAnswer(output), 'final answer');
});

test('Codex adapter normalizes live text and MCP activity events', () => {
  const adapter = new CodexAdapter(unusedStore);
  assert.deepEqual(adapter.parseStreamLine(JSON.stringify({
    type: 'item.started',
    item: { type: 'mcp_tool_call', server: 'xgen_browser', tool: 'navigate' },
  })), [{ type: 'activity', name: 'xgen_browser.navigate', phase: 'started', detail: undefined }]);
  assert.deepEqual(adapter.parseStreamLine(JSON.stringify({
    type: 'item.completed',
    item: { type: 'agent_message', text: 'live answer' },
  })), [{ type: 'text', text: 'live answer', mode: 'replace' }]);
});

test('Codex adapter recognizes terminal exec stream events', () => {
  const adapter = new CodexAdapter(unusedStore);
  assert.equal(adapter.isStreamComplete(JSON.stringify({ type: 'turn.completed' })), true);
  assert.equal(adapter.isStreamComplete(JSON.stringify({ type: 'turn.failed' })), false);
  assert.equal(adapter.isStreamComplete(JSON.stringify({ type: 'item.completed' })), false);
  assert.equal(adapter.isStreamComplete('not json'), false);
});

test('Codex adapter pre-approves the capability-bounded XGEN browser MCP server', () => {
  const overrides = codexBrowserMcpOverrides({
    executablePath: 'C:\\XGEN Side\\electron.exe',
    args: ['C:\\XGEN Side\\resources\\xgen-mcp-bridge.cjs'],
    environment: { XGEN_CORE_MCP_TOKEN: 'relay-token' },
    toolProfiles: ['core', 'files'],
    tabId: 'tab-1',
  });

  assert.deepEqual(overrides, [
    '-c', 'mcp_servers.xgen_browser.command="C:/XGEN Side/electron.exe"',
    '-c', 'mcp_servers.xgen_browser.args=["C:/XGEN Side/resources/xgen-mcp-bridge.cjs"]',
    '-c', 'mcp_servers.xgen_browser.env={XGEN_CORE_MCP_TOKEN="relay-token"}',
    '-c', 'mcp_servers.xgen_browser.default_tools_approval_mode="approve"',
  ]);
});

test('Codex adapter locates current and legacy npm native executables', () => {
  const appData = join('C:', 'Users', 'tester', 'AppData', 'Roaming');
  const vendorRoot = join(appData, 'npm', 'node_modules', '@openai', 'codex', 'node_modules', '@openai/codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc');
  assert.deepEqual(codexNpmExecutableCandidates(appData, 'x64'), [
    join(vendorRoot, 'bin', 'codex.exe'),
    join(vendorRoot, 'codex', 'codex.exe'),
  ]);
});

test('Codex adapter locates the CLI bundled with ChatGPT on macOS', () => {
  assert.deepEqual(codexMacExecutableCandidates('/Users/tester'), [
    join('/Users/tester', '.local', 'bin', 'codex'),
    join('/Users/tester', '.npm-global', 'bin', 'codex'),
    '/Applications/ChatGPT.app/Contents/Resources/codex',
    '/Applications/Codex.app/Contents/Resources/codex',
    '/Applications/Codex.app/Contents/MacOS/codex',
  ]);
});

test('Codex adapter replaces an incompatible model catalog error with update guidance', () => {
  assert.equal(
    codexCompatibilityError('failed to decode models response: unknown variant `max`, expected one of none, low, medium, high, xhigh'),
    '설치된 Codex CLI가 최신 모델 목록과 호환되지 않습니다. Codex CLI를 최신 버전으로 업데이트한 뒤 Settings > AI Providers에서 상태를 새로고침하세요.',
  );
  assert.equal(codexCompatibilityError('network request failed'), undefined);
});

test('Claude adapter prefers the final result from stream JSON', () => {
  const adapter = new ClaudeCodeAdapter(unusedStore);
  const output = [
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'draft answer' }] } }),
    JSON.stringify({ type: 'result', result: 'final answer' }),
  ].join('\n');
  assert.equal(adapter.parseAnswer(output), 'final answer');
});

test('Claude adapter falls back to assistant text when no result event is present', () => {
  const adapter = new ClaudeCodeAdapter(unusedStore);
  const output = JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'text', text: 'answer from assistant event' }] },
  });
  assert.equal(adapter.parseAnswer(output), 'answer from assistant event');
});

test('browser prompt uses the active agent-browser tab instead of the Electron CDP target id', () => {
  const request: AgentRunRequest = {
    providerId: 'codex',
    model: 'gpt-5.6-sol',
    mode: 'browser-agent',
    prompt: '네이버 로그인해줘',
    permissionMode: 'guard',
  };
  const route: SkillRoute = {
    id: 'browser-route',
    resolvedMode: 'browser-agent',
    reason: 'Browser control is required.',
    browserVisible: true,
    agentBrowserRequired: true,
    browserActionCategories: ['navigate'],
    skills: [],
    steps: [],
  };
  const browser: BrowserBridge = {
    executablePath: '/Applications/XGEN Side.app/Electron',
    args: ['/Applications/XGEN Side.app/resources/xgen-mcp-bridge.cjs'],
    environment: {},
    toolProfiles: ['core', 'tabs'],
    tabId: 'workspace-tab-id',
    targetId: 'B30B9D39532AA6F4D083B796CF2583BC',
  };

  const prompt = buildPrompt(request, route, '', browser);

  assert.match(prompt, /use the tab marked active/);
  assert.match(prompt, /only the tab ids or labels returned by the tab list/);
  assert.doesNotMatch(prompt, /B30B9D39532AA6F4D083B796CF2583BC/);
  assert.doesNotMatch(prompt, /switch to the exact target id/);
});

test('attachment prompt preserves source files and requires new verified artifacts', () => {
  const attachment = { id: '11111111-1111-4111-8111-111111111111', name: 'brief.docx', kind: 'docx' as const, size: 2048 };
  const request: AgentRunRequest = {
    providerId: 'codex',
    model: 'gpt-5.6-sol',
    mode: 'chat',
    prompt: '수정본을 만들어줘',
    permissionMode: 'guard',
    attachments: [attachment],
  };
  const route: SkillRoute = {
    id: 'document-route',
    resolvedMode: 'chat',
    reason: 'Local document task.',
    browserVisible: false,
    agentBrowserRequired: false,
    browserActionCategories: [],
    skills: [],
    steps: [],
  };
  const prompt = buildPrompt(request, route, '', undefined, [{ ...attachment, relativePath: 'attachments/brief.docx' }]);
  assert.match(prompt, /<attached_files>/);
  assert.match(prompt, /attachments\/brief\.docx/);
  assert.match(prompt, /Never overwrite files under attachments\//);
  assert.match(prompt, /directly under artifacts\//);
});

test('Claude adapter normalizes partial text deltas', () => {
  const adapter = new ClaudeCodeAdapter(unusedStore);
  assert.deepEqual(adapter.parseStreamLine(JSON.stringify({
    type: 'stream_event',
    event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'partial' } },
  })), [{ type: 'text', text: 'partial', mode: 'append' }]);
});
