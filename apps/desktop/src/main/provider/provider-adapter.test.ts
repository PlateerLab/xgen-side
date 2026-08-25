import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { ClaudeCodeAdapter, claudeExecutableCandidates } from './claude-code-adapter';
import { CodexAdapter, codexBrowserMcpOverrides, codexCompatibilityError, codexNpmExecutableCandidates } from './codex-adapter';
import { modelIdPattern, skillIdPattern } from './identifiers';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { readClaudeModelCatalog } from './claude-model-catalog';
import { cappedPermissionReason, effectivePermissionMode } from './permission-ceiling';
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

test('the Claude model catalog reads real ids out of the installed CLI', async () => {
  const root = await mkdtemp(join(tmpdir(), 'xgen-cli-'));
  const fake = join(root, 'claude');
  // Ids straddle chunk boundaries in the real binary, so pad around them.
  await writeFile(fake, [
    'x'.repeat(5000),
    'claude-opus-4-6 claude-sonnet-5 claude-haiku-4-5 claude-fable-5',
    'claude-opus-4 claude-opus-4-8',
    'claude-opus-4-20250514 claude-sonnet-4-6-v1',
    'y'.repeat(5000),
  ].join(' '));
  try {
    const catalog = await readClaudeModelCatalog(fake);
    const ids = catalog.map((model) => model.id);
    // Grouped by family in capability order, newest version first within each family.
    assert.deepEqual(ids, ['claude-fable-5', 'claude-opus-4-8', 'claude-opus-4-6', 'claude-sonnet-5', 'claude-haiku-4-5']);
    assert.equal(catalog[1]?.label, 'Claude Opus 4.8');
    // A dated snapshot must not be offered as a version.
    assert.ok(!ids.some((id) => /\d{8}/.test(id)));
    // The bare major is dropped once its concrete versions are present.
    assert.ok(!ids.includes('claude-opus-4'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a launcher shim falls through to the versioned build beside it', async () => {
  // Windows leaves a small shim on PATH instead of a symlink, so scanning it finds nothing
  // and the versioned build the CLI reports has to be found relative to that shim.
  const root = await mkdtemp(join(tmpdir(), 'xgen-shim-'));
  await mkdir(join(root, 'bin'), { recursive: true });
  await mkdir(join(root, 'share', 'claude', 'versions'), { recursive: true });
  const shim = join(root, 'bin', 'claude.exe');
  await writeFile(shim, '@echo off\r\nrem launcher only, no model ids here\r\n');
  await writeFile(join(root, 'share', 'claude', 'versions', '9.9.9.exe'), 'claude-opus-4-6 claude-haiku-4-5');
  try {
    assert.deepEqual(
      (await readClaudeModelCatalog(shim, '9.9.9 (Claude Code)')).map((model) => model.id),
      ['claude-opus-4-6', 'claude-haiku-4-5'],
    );
    // Without a parseable version there is nothing else to try, and it must not throw.
    assert.deepEqual(await readClaudeModelCatalog(shim, 'not a version'), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('an unreadable CLI yields no catalog rather than throwing', async () => {
  assert.deepEqual(await readClaudeModelCatalog(join(tmpdir(), 'xgen-missing-cli')), []);
});

test('the permission ceiling can only lower a run, never raise it', () => {
  // Guard is wider than read-only, so a capped read-only run must stay read-only.
  assert.equal(effectivePermissionMode({ permissionMode: 'read-only' }, true), 'read-only');
  assert.equal(effectivePermissionMode({ permissionMode: 'guard' }, true), 'guard');
  assert.equal(effectivePermissionMode({ permissionMode: 'full-access' }, true), 'guard');
  assert.equal(effectivePermissionMode({ permissionMode: 'full-access' }, false), 'full-access');
  assert.equal(effectivePermissionMode({}, true), 'guard');
});

test('only an auto-routed full-access run is capped', () => {
  const mutating = [{ id: 'x', name: 'Browser Interaction', risk: 'write' } as never];
  const readOnly = [{ id: 'y', name: 'Conversation', risk: 'read' } as never];
  assert.ok(cappedPermissionReason({ mode: 'auto', permissionMode: 'full-access' }, mutating));
  assert.equal(cappedPermissionReason({ mode: 'auto', permissionMode: 'full-access' }, readOnly), undefined);
  assert.equal(cappedPermissionReason({ mode: 'auto', permissionMode: 'guard' }, mutating), undefined);
  assert.equal(cappedPermissionReason({ mode: 'auto', permissionMode: 'read-only' }, mutating), undefined);
  assert.equal(cappedPermissionReason({ mode: 'browser-agent', permissionMode: 'full-access' }, mutating), undefined);
});

test('model ids accept the bracketed context-window suffix while skill ids do not', () => {
  // The Claude CLI exposes ids such as claude-fable-5[1m]; rejecting them broke every run.
  assert.ok(modelIdPattern.test('claude-fable-5[1m]'));
  assert.ok(modelIdPattern.test('sonnet'));
  assert.ok(modelIdPattern.test('gpt-5.6-sol'));
  assert.ok(!modelIdPattern.test('claude fable'));
  assert.ok(!modelIdPattern.test('model;rm -rf /'));
  assert.ok(!skillIdPattern.test('xgen.conversation[1m]'));
  assert.ok(skillIdPattern.test('xgen.conversation'));
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
