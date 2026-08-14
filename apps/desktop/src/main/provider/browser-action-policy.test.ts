import assert from 'node:assert/strict';
import test from 'node:test';
import { allowConfirmedAction, browserActionPolicy, browserPolicyActions, confirmAllowedAction } from './browser-action-policy';

test('maps selected MCP tools to exact agent-browser policy actions', () => {
  assert.deepEqual(browserPolicyActions([
    'agent_browser_tab_list',
    'agent_browser_open',
    'agent_browser_wait_for_load',
    'agent_browser_get_text',
  ]), ['launch', 'tab_list', 'navigate', 'waitforloadstate', 'gettext']);
});

test('does not authorize interaction actions for navigation-only skills', () => {
  const actions = browserPolicyActions(['agent_browser_snapshot', 'agent_browser_get_url']);
  assert.equal(actions.includes('click'), false);
  assert.equal(actions.includes('fill'), false);
});

test('maps secure auth login to a dedicated policy action', () => {
  assert.deepEqual(browserPolicyActions(['agent_browser_auth_login']), ['launch', 'auth_login']);
});


test('uses global Ask for selected upload and download actions', async () => {
  const policy = browserActionPolicy(
    ['agent_browser_upload', 'agent_browser_download', 'agent_browser_click'],
    { upload: 'ask', download: 'ask' },
    'full-access',
  );
  assert.deepEqual(policy.confirm, ['upload', 'download']);
  assert.equal(policy.allow.includes('upload'), false);
  assert.equal(policy.allow.includes('download'), false);
  assert.equal(policy.allow.includes('click'), true);
});

test('global Allow and Deny override transfer actions without affecting other tools', async () => {
  const policy = browserActionPolicy(
    ['agent_browser_upload', 'agent_browser_download', 'agent_browser_snapshot'],
    { upload: 'deny', download: 'allow' },
    'full-access',
  );
  assert.equal(policy.deny.includes('upload'), true);
  assert.equal(policy.allow.includes('download'), true);
  assert.equal(policy.allow.includes('snapshot'), true);
});

test('read-only blocks mutations while preserving inspection and tab selection', () => {
  const policy = browserActionPolicy(
    ['agent_browser_tab_list', 'agent_browser_tab_switch', 'agent_browser_snapshot', 'agent_browser_open', 'agent_browser_click', 'agent_browser_fill'],
    { upload: 'ask', download: 'ask' },
    'read-only',
  );
  assert.equal(policy.allow.includes('tab_list'), true);
  assert.equal(policy.allow.includes('tab_switch'), true);
  assert.equal(policy.allow.includes('snapshot'), true);
  assert.equal(policy.allow.includes('navigate'), true);
  assert.equal(policy.deny.includes('click'), true);
  assert.equal(policy.deny.includes('fill'), true);
});

test('guard confirms mutations and full access allows selected capabilities', () => {
  const tools = ['agent_browser_open', 'agent_browser_click', 'agent_browser_fill', 'agent_browser_snapshot'];
  const guard = browserActionPolicy(tools, { upload: 'ask', download: 'ask' }, 'guard');
  assert.deepEqual(guard.confirm, ['click', 'fill']);
  assert.equal(guard.allow.includes('snapshot'), true);
  const full = browserActionPolicy(tools, { upload: 'ask', download: 'ask' }, 'full-access');
  assert.equal(full.allow.includes('navigate'), true);
  assert.equal(full.allow.includes('click'), true);
  assert.equal(full.allow.includes('fill'), true);
  assert.equal(full.deny.includes('eval'), true);
});

test('hard and global denies take precedence over confirmations', () => {
  const readOnly = browserActionPolicy(['agent_browser_upload'], { upload: 'ask', download: 'ask' }, 'read-only');
  assert.equal(readOnly.deny.includes('upload'), true);
  assert.equal(readOnly.confirm.includes('upload'), false);
  const guard = browserActionPolicy(['agent_browser_download'], { upload: 'ask', download: 'deny' }, 'guard');
  assert.equal(guard.deny.includes('download'), true);
  assert.equal(guard.confirm.includes('download'), false);
});

test('supports a trusted workflow moving one action across the approval boundary', () => {
  const policy = browserActionPolicy(
    ['agent_browser_click', 'agent_browser_auth_login'],
    { upload: 'ask', download: 'ask' },
    'guard',
  );
  allowConfirmedAction(policy, 'click');
  confirmAllowedAction(policy, 'auth_login');
  assert.equal(policy.allow.includes('click'), true);
  assert.equal(policy.confirm.includes('click'), false);
  assert.equal(policy.allow.includes('auth_login'), false);
  assert.equal(policy.confirm.includes('auth_login'), true);
  assert.equal(policy.allow.includes('confirm'), true);
  assert.equal(policy.allow.includes('deny'), true);
});
