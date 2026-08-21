import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { ClaudeCodeAdapter, claudeExecutableCandidates } from './claude-code-adapter';
import { CodexAdapter, codexBrowserMcpOverrides, codexCompatibilityError, codexNpmExecutableCandidates } from './codex-adapter';
import type { LocalRunStore } from '../storage/local-run-store';

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
    executablePath: 'C:\\XGEN Side\\agent-browser.exe',
    environment: { AGENT_BROWSER_ACTION_POLICY: 'C:\\runs\\browser-policy.json' },
    toolProfiles: ['core', 'files'],
    tabId: 'tab-1',
  });

  assert.deepEqual(overrides, [
    '-c', 'mcp_servers.xgen_browser.command="C:/XGEN Side/agent-browser.exe"',
    '-c', 'mcp_servers.xgen_browser.args=["mcp","--tools","core,files"]',
    '-c', 'mcp_servers.xgen_browser.env={AGENT_BROWSER_ACTION_POLICY="C:/runs/browser-policy.json"}',
    '-c', 'mcp_servers.xgen_browser.default_tools_approval_mode="approve"',
  ]);
});

test('Codex adapter locates current and legacy npm native executables', () => {
  const appData = join('C:', 'Users', 'tester', 'AppData', 'Roaming');
  const vendorRoot = join(appData, 'npm', 'node_modules', '@openai', 'codex', 'node_modules', '@openai/codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc');
  assert.deepEqual(codexNpmExecutableCandidates(appData, 'x64', 'win32'), [
    join(vendorRoot, 'bin', 'codex.exe'),
    join(vendorRoot, 'codex', 'codex.exe'),
  ]);
});

test('Codex adapter locates npm native executables inside a macOS npm prefix', () => {
  const root = join('/opt', 'homebrew', 'lib');
  const vendorRoot = join(root, 'node_modules', '@openai', 'codex', 'node_modules', '@openai/codex-darwin-arm64', 'vendor', 'aarch64-apple-darwin');
  assert.deepEqual(codexNpmExecutableCandidates(root, 'arm64', 'darwin'), [
    join(vendorRoot, 'bin', 'codex'),
    join(vendorRoot, 'codex', 'codex'),
  ]);
});

test('Claude adapter probes the POSIX installer directories', () => {
  const home = join('/Users', 'tester');
  assert.deepEqual(claudeExecutableCandidates('darwin', home), [
    join(home, '.local', 'bin', 'claude'),
    join(home, '.claude', 'local', 'claude'),
    join(home, 'bin', 'claude'),
    join('/opt', 'homebrew', 'bin', 'claude'),
    join('/usr', 'local', 'bin', 'claude'),
  ]);
  assert.deepEqual(claudeExecutableCandidates('win32', join('C:', 'Users', 'tester')), [
    join(process.env.USERPROFILE ?? join('C:', 'Users', 'tester'), '.local', 'bin', 'claude.exe'),
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

test('Claude adapter normalizes partial text deltas', () => {
  const adapter = new ClaudeCodeAdapter(unusedStore);
  assert.deepEqual(adapter.parseStreamLine(JSON.stringify({
    type: 'stream_event',
    event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'partial' } },
  })), [{ type: 'text', text: 'partial', mode: 'append' }]);
});
