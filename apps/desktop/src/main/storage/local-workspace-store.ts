import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { BrowserTabState, PersistedWorkspaceState } from '../../shared/contracts';
import { defaultWorkspaceState, isRestorableUrl, sanitizeWorkspaceState } from './workspace-state';
import type { CoreBlobStore } from './core-blob-store';

export class LocalWorkspaceStore {
  private state: PersistedWorkspaceState = structuredClone(defaultWorkspaceState);
  private initialized = false;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly path: string,
    private readonly blobs?: CoreBlobStore,
  ) {}

  async load(): Promise<PersistedWorkspaceState> {
    if (!this.initialized) {
      try {
        const coreValue = await this.blobs?.readLocalData('workspace');
        const legacyValue = coreValue === undefined ? await readFile(this.path, 'utf8') : undefined;
        this.state = sanitizeWorkspaceState(JSON.parse(coreValue ?? legacyValue ?? ''));
        if (this.blobs && coreValue === undefined) await this.blobs.writeLocalData('workspace', JSON.stringify(this.state));
      } catch {
        this.state = structuredClone(defaultWorkspaceState);
      }
      this.initialized = true;
    }
    return structuredClone(this.state);
  }

  async saveChats(input: Pick<PersistedWorkspaceState, 'activeChatId' | 'chats' | 'chatMessages'>): Promise<void> {
    await this.load();
    const sanitized = sanitizeWorkspaceState({ ...this.state, ...input });
    await this.commit(sanitized);
  }

  async saveBrowserTabs(tabs: BrowserTabState[]): Promise<void> {
    await this.load();
    // Agent tabs are run-scoped capabilities. Restoring one would revive a stale
    // automation or authentication URL without its original approval context.
    const userTabs = tabs.filter((tab) => tab.owner === 'user' && isRestorableUrl(tab.url)).slice(0, 50);
    const activeTab = userTabs.findIndex((tab) => tab.active);
    const browser = {
      urls: userTabs.length ? userTabs.map((tab) => tab.url) : ['about:blank'],
      activeIndex: activeTab >= 0 ? activeTab : 0,
    };
    await this.commit({ ...this.state, browser });
  }

  private commit(next: PersistedWorkspaceState): Promise<void> {
    this.state = next;
    this.writeQueue = this.writeQueue.then(async () => {
      if (this.blobs) {
        await this.blobs.writeLocalData('workspace', JSON.stringify(this.state));
        return;
      }
      await mkdir(dirname(this.path), { recursive: true });
      const temporaryPath = `${this.path}.tmp`;
      await writeFile(temporaryPath, JSON.stringify(this.state, null, 2), 'utf8');
      await rename(temporaryPath, this.path);
    });
    return this.writeQueue;
  }
}
