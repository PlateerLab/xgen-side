import assert from 'node:assert/strict';
import test from 'node:test';
import type { AppSettings } from '../../shared/contracts';
import type { CoreBlobStore, CoreLocalDataKey } from './core-blob-store';
import { CredentialVault } from './credential-vault';
import { LocalSettingsStore } from './local-settings-store';
import { LocalWorkspaceStore } from './local-workspace-store';

class MemoryCoreStore implements CoreBlobStore {
  readonly values = new Map<CoreLocalDataKey, string>();
  async readLocalData(key: CoreLocalDataKey): Promise<string | undefined> { return this.values.get(key); }
  async writeLocalData(key: CoreLocalDataKey, content: string): Promise<void> { this.values.set(key, content); }
}

const encryption = {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from([...Buffer.from(value, 'utf8')].map((byte) => byte ^ 0x5a)),
  decryptString: (value: Buffer) => Buffer.from([...value].map((byte) => byte ^ 0x5a)).toString('utf8'),
};

test('settings and workspace persist through the authenticated core store', async () => {
  const core = new MemoryCoreStore();
  const settings = new LocalSettingsStore('/unused/settings.json', core);
  const input: AppSettings = {
    schemaVersion: 1,
    general: { defaultPermissionMode: 'read-only', localLogs: false, compact: true },
    browserPermissions: { upload: 'deny', download: 'ask' },
    mcpEnabled: { browser: true, xgen: false, filesystem: false },
    skillEnabled: { 'xgen.browser-navigation': true },
  };
  await settings.save(input);
  assert.deepEqual(await settings.load(), input);

  const workspace = new LocalWorkspaceStore('/unused/workspace.json', core);
  await workspace.saveChats({
    activeChatId: 'chat-1',
    chats: [{ id: 'chat-1', title: 'Saved through core', time: '' }],
    chatMessages: { 'chat-1': [{ id: 'message-1', role: 'user', content: 'hello' }] },
  });
  assert.equal(JSON.parse(core.values.get('workspace')!).chats[0].title, 'Saved through core');

  await workspace.saveBrowserTabs([
    { id: 'user-tab', title: 'Example', url: 'https://example.com', active: false, loading: false, canGoBack: false, canGoForward: false, owner: 'user' },
    { id: 'agent-tab', title: 'Login', url: 'https://example.com/login', active: true, loading: false, canGoBack: false, canGoForward: false, owner: 'agent', agentRunId: 'run-1', agentStatus: 'completed' },
  ]);
  assert.deepEqual(JSON.parse(core.values.get('workspace')!).browser, { urls: ['https://example.com'], activeIndex: 0 });
});

test('credential core storage receives ciphertext and never plaintext', async () => {
  const core = new MemoryCoreStore();
  const vault = new CredentialVault('/unused/credentials.vault', encryption, core);
  const saved = await vault.save({
    label: 'Example',
    origin: 'https://example.com/login',
    username: 'user@example.com',
    password: 'secret-password',
  });
  const stored = core.values.get('credentials');
  assert.ok(stored);
  assert.equal(stored.includes('secret-password'), false);
  assert.equal(stored.includes('user@example.com'), false);

  const used = await vault.useForExactOrigin(saved.id, 'https://example.com/account', async (username, password) => ({ username, password }));
  assert.deepEqual(used, { state: 'used', value: { username: 'user@example.com', password: 'secret-password' } });
});
