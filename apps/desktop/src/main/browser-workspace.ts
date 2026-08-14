import { BrowserWindow, WebContentsView, type WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import { normalizeBrowserAddress } from './browser-address';
import { openBrowserCdpGateway, type BrowserCdpGatewayConnection } from './security/browser-cdp-gateway';
import type { BrowserAgentStatus, BrowserHistoryEntry, BrowserLayoutState, BrowserSnapshot, BrowserTabOwner, BrowserTabState, PageContext } from '../shared/contracts';

interface BrowserTab {
  id: string;
  view: WebContentsView;
  title: string;
  url: string;
  loading: boolean;
  owner: BrowserTabOwner;
  agentRunId?: string;
  agentStatus?: BrowserAgentStatus;
  credentialProtected: boolean;
}

export interface BrowserCredentialAutofillTarget {
  contents: WebContents;
  protect(): void;
}

export interface AgentBrowserTarget {
  tab: BrowserTabState;
  targetId?: string;
}

export class BrowserWorkspace {
  private readonly tabs = new Map<string, BrowserTab>();
  private readonly cdpGateways = new Map<string, BrowserCdpGatewayConnection>();
  private readonly history: BrowserHistoryEntry[] = [];
  private activeTabId: string | undefined;
  private attachedTabId: string | undefined;
  private layoutState: BrowserLayoutState = {
    visible: false,
    leftWidth: 260,
    rightWidth: 0,
    chromeHeight: 76,
  };

  constructor(
    private readonly window: BrowserWindow,
    private readonly notify: (tabs: BrowserTabState[]) => void,
  ) {
    window.on('resize', () => this.layout());
  }

  async createTab(url = 'about:blank'): Promise<BrowserTabState[]> {
    await this.createManagedTab(url, 'user');
    return this.snapshot();
  }

  async createAgentTab(agentRunId: string, url = 'about:blank'): Promise<AgentBrowserTarget> {
    if ([...this.tabs.values()].some((tab) => tab.credentialProtected)) {
      throw new Error('Close the credential-protected tab before starting browser automation.');
    }
    const existing = [...this.tabs.values()].find((tab) => tab.agentRunId === agentRunId);
    const tab = existing ?? await this.createManagedTab(url, 'agent', agentRunId);
    tab.agentStatus = 'running';
    this.emit();
    return { tab: this.tabState(tab), targetId: await this.automationTargetId(tab.id) };
  }

  async openAgentCdpGateway(tabId: string, agentRunId: string): Promise<string> {
    const tab = this.tabs.get(tabId);
    if (!tab || tab.agentRunId !== agentRunId || tab.credentialProtected) {
      throw new Error('The Agent browser tab is unavailable.');
    }
    await this.closeAgentCdpGateway(agentRunId);
    const gateway = await openBrowserCdpGateway(tab.view.webContents);
    this.cdpGateways.set(agentRunId, gateway);
    return gateway.url;
  }

  async closeAgentCdpGateway(agentRunId: string): Promise<void> {
    const gateway = this.cdpGateways.get(agentRunId);
    if (!gateway) return;
    this.cdpGateways.delete(agentRunId);
    await gateway.close();
  }

  async attachActiveTabToAgentRun(agentRunId: string): Promise<AgentBrowserTarget | undefined> {
    const tab = this.activeTab();
    if (!tab || [...this.tabs.values()].some((candidate) => candidate.credentialProtected)) return undefined;
    tab.agentRunId = agentRunId;
    tab.agentStatus = 'running';
    this.emit();
    return { tab: this.tabState(tab), targetId: await this.automationTargetId(tab.id) };
  }

  updateAgentRunStatus(agentRunId: string, status: BrowserAgentStatus): BrowserTabState[] {
    for (const tab of this.tabs.values()) {
      if (tab.agentRunId === agentRunId) tab.agentStatus = status;
    }
    return this.emit();
  }

  private async createManagedTab(url: string, owner: BrowserTabOwner, agentRunId?: string): Promise<BrowserTab> {
    const id = randomUUID();
    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition: 'persist:xgen-side-default',
      },
    });
    view.setVisible(false);
    const tab: BrowserTab = {
      id,
      view,
      title: owner === 'agent' ? 'Agent browser' : 'New tab',
      url: 'about:blank',
      loading: false,
      owner,
      agentRunId,
      agentStatus: agentRunId ? 'running' : undefined,
      credentialProtected: false,
    };

    this.tabs.set(id, tab);
    this.attachTabEvents(tab);
    this.activateTab(id);
    await view.webContents.loadURL(normalizeBrowserAddress(url));
    return tab;
  }

  activateTab(id: string): BrowserTabState[] {
    const next = this.tabs.get(id);
    if (!next) return this.snapshot();

    this.activeTabId = id;
    this.syncAttachedView();
    this.layout();
    return this.emit();
  }

  closeTab(id: string): BrowserTabState[] {
    const tab = this.tabs.get(id);
    if (!tab) return this.snapshot();

    const wasActive = this.activeTabId === id;
    if (this.attachedTabId === id) {
      tab.view.setVisible(false);
      this.window.contentView.removeChildView(tab.view);
      this.attachedTabId = undefined;
    }
    if (tab.agentRunId) void this.closeAgentCdpGateway(tab.agentRunId);
    tab.view.webContents.close();
    this.tabs.delete(id);

    if (wasActive) {
      this.activeTabId = undefined;
      const successor = this.tabs.values().next().value as BrowserTab | undefined;
      if (successor) this.activateTab(successor.id);
      else void this.createTab();
    }

    return this.emit();
  }

  listTabs(): BrowserTabState[] {
    return this.snapshot();
  }

  historySince(sinceMs: number, tabId?: string): BrowserHistoryEntry[] {
    return this.history
      .filter((entry) => entry.visitedAtMs >= sinceMs && (!tabId || entry.tabId === tabId))
      .map((entry) => ({ ...entry }));
  }

  activeUrl(): string | undefined {
    return this.activeTab()?.url;
  }

  urlForTab(id: string): string | undefined {
    return this.tabs.get(id)?.url;
  }

  credentialAutofillTarget(id: string): BrowserCredentialAutofillTarget | undefined {
    const tab = this.tabs.get(id);
    const hasRunningAgent = [...this.tabs.values()].some((candidate) => candidate.agentStatus === 'running');
    if (!tab || tab.id !== this.activeTabId || tab.id !== this.attachedTabId || tab.owner !== 'user' || tab.agentRunId || hasRunningAgent) {
      return undefined;
    }
    const contents = tab.view.webContents;
    if (contents.isDestroyed()) return undefined;
    return {
      contents,
      protect: () => {
        if (this.tabs.get(id) === tab) {
          tab.credentialProtected = true;
          if (tab.agentRunId) void this.closeAgentCdpGateway(tab.agentRunId);
        }
      },
    };
  }

  agentCredentialAutofillTarget(id: string, agentRunId: string): BrowserCredentialAutofillTarget | undefined {
    const tab = this.tabs.get(id);
    if (!tab || tab.id !== this.activeTabId || tab.id !== this.attachedTabId || tab.agentRunId !== agentRunId) {
      return undefined;
    }
    const contents = tab.view.webContents;
    if (contents.isDestroyed()) return undefined;
    return {
      contents,
      protect: () => {
        if (this.tabs.get(id) === tab) {
          tab.credentialProtected = true;
          void this.closeAgentCdpGateway(agentRunId);
        }
      },
    };
  }

  async automationTargetId(id: string): Promise<string | undefined> {
    const tab = this.tabs.get(id);
    if ([...this.tabs.values()].some((candidate) => candidate.credentialProtected)) return undefined;
    const contents = tab?.view.webContents;
    if (!contents || contents.isDestroyed()) return undefined;
    const attachedHere = !contents.debugger.isAttached();
    try {
      if (attachedHere) contents.debugger.attach('1.3');
      const response = await contents.debugger.sendCommand('Target.getTargetInfo') as unknown;
      if (!isRecord(response) || !isRecord(response.targetInfo)) return undefined;
      return typeof response.targetInfo.targetId === 'string' ? response.targetInfo.targetId : undefined;
    } catch {
      return undefined;
    } finally {
      if (attachedHere && contents.debugger.isAttached()) contents.debugger.detach();
    }
  }

  async navigate(input: string): Promise<BrowserTabState[]> {
    const tab = this.activeTab();
    if (!tab) return this.snapshot();
    await tab.view.webContents.loadURL(normalizeBrowserAddress(input));
    return this.snapshot();
  }

  back(): BrowserTabState[] {
    const contents = this.activeTab()?.view.webContents;
    if (contents?.navigationHistory.canGoBack()) contents.navigationHistory.goBack();
    return this.snapshot();
  }

  forward(): BrowserTabState[] {
    const contents = this.activeTab()?.view.webContents;
    if (contents?.navigationHistory.canGoForward()) contents.navigationHistory.goForward();
    return this.snapshot();
  }

  reload(): BrowserTabState[] {
    this.activeTab()?.view.webContents.reload();
    return this.snapshot();
  }

  async getPageContext(): Promise<PageContext | undefined> {
    const tab = this.activeTab();
    if (!tab || tab.credentialProtected || tab.view.webContents.isDestroyed()) return undefined;
    const extracted = await tab.view.webContents.executeJavaScript(`(() => {
      const selection = window.getSelection()?.toString() || '';
      const root = document.querySelector('main, article, [role="main"]') || document.body;
      return {
        title: document.title || '',
        url: location.href,
        selection: selection.slice(0, 20000),
        text: (root?.innerText || '').slice(0, 120000)
      };
    })()`, true) as { title?: string; url?: string; selection?: string; text?: string };
    return {
      tabId: tab.id,
      title: extracted.title || tab.title,
      url: extracted.url || tab.url,
      selection: extracted.selection || '',
      text: extracted.text || '',
      capturedAt: new Date().toISOString(),
    };
  }

  setLayout(layout: BrowserLayoutState): void {
    this.layoutState = {
      visible: Boolean(layout.visible),
      leftWidth: clampLayoutValue(layout.leftWidth, 0, 420),
      rightWidth: clampLayoutValue(layout.rightWidth, 0, 560),
      chromeHeight: clampLayoutValue(layout.chromeHeight, 56, 110),
      placement: layout.placement === 'right-dock' ? 'right-dock' : 'workspace',
      dockInset: clampLayoutValue(layout.dockInset ?? 10, 0, 32),
    };
    this.syncAttachedView();
    this.layout();
  }

  private activeTab(): BrowserTab | undefined {
    return this.activeTabId ? this.tabs.get(this.activeTabId) : undefined;
  }

  private attachTabEvents(tab: BrowserTab): void {
    const { webContents } = tab.view;

    webContents.setWindowOpenHandler(({ url }) => {
      void this.createManagedTab(url, tab.owner, tab.agentRunId);
      return { action: 'deny' };
    });
    webContents.on('will-navigate', (event, url) => {
      if (!isAllowedBrowserUrl(url)) event.preventDefault();
    });
    webContents.on('did-start-loading', () => {
      tab.loading = true;
      this.emit();
    });
    webContents.on('did-stop-loading', () => {
      tab.loading = false;
      tab.url = webContents.getURL();
      tab.title = webContents.getTitle() || tab.url;
      this.recordHistory(tab);
      this.emit();
    });
    webContents.on('did-navigate', (_event, url) => {
      tab.url = url;
      this.emit();
    });
    webContents.on('did-navigate-in-page', (_event, url) => {
      tab.url = url;
      this.recordHistory(tab);
      this.emit();
    });
    webContents.on('page-title-updated', (_event, title) => {
      tab.title = title;
      this.emit();
    });
  }

  private layout(): void {
    const size = this.window.getContentSize();
    const width = size[0] ?? 1040;
    const height = size[1] ?? 700;
    const active = this.activeTab();
    if (!this.layoutState.visible || this.attachedTabId !== active?.id) return;

    if (this.layoutState.placement === 'right-dock') {
      const inset = this.layoutState.dockInset ?? 10;
      const dockWidth = Math.max(360, this.layoutState.rightWidth - inset * 2);
      active?.view.setBounds({
        x: Math.max(this.layoutState.leftWidth, width - this.layoutState.rightWidth + inset),
        y: this.layoutState.chromeHeight,
        width: dockWidth,
        height: Math.max(240, height - this.layoutState.chromeHeight - inset),
      });
      return;
    }

    const browserWidth = Math.max(320, width - this.layoutState.leftWidth - this.layoutState.rightWidth);
    active?.view.setBounds({
      x: this.layoutState.leftWidth,
      y: this.layoutState.chromeHeight,
      width: browserWidth,
      height: Math.max(240, height - this.layoutState.chromeHeight),
    });
  }

  private syncAttachedView(): void {
    const active = this.activeTab();
    if (!this.layoutState.visible || !active) {
      if (this.attachedTabId) {
        const attached = this.tabs.get(this.attachedTabId);
        if (attached) {
          attached.view.setVisible(false);
          this.window.contentView.removeChildView(attached.view);
        }
        this.attachedTabId = undefined;
      }
      return;
    }

    if (this.attachedTabId === active.id) {
      active.view.setVisible(true);
      return;
    }
    if (this.attachedTabId) {
      const attached = this.tabs.get(this.attachedTabId);
      if (attached) {
        attached.view.setVisible(false);
        this.window.contentView.removeChildView(attached.view);
      }
    }
    this.window.contentView.addChildView(active.view);
    active.view.setVisible(true);
    this.attachedTabId = active.id;
  }

  private snapshot(): BrowserTabState[] {
    return [...this.tabs.values()].map((tab) => this.tabState(tab));
  }

  private tabState(tab: BrowserTab): BrowserTabState {
    return {
      id: tab.id,
      title: tab.title,
      url: tab.url,
      active: tab.id === this.activeTabId,
      loading: tab.loading,
      canGoBack: tab.view.webContents.navigationHistory.canGoBack(),
      canGoForward: tab.view.webContents.navigationHistory.canGoForward(),
      owner: tab.owner,
      agentRunId: tab.agentRunId,
      agentStatus: tab.agentStatus,
    };
  }

  private emit(): BrowserTabState[] {
    const tabs = this.snapshot();
    this.notify(tabs);
    return tabs;
  }

  async captureSnapshot(reason: string, tabId?: string): Promise<BrowserSnapshot | undefined> {
    const requestedTab = tabId ? this.tabs.get(tabId) : undefined;
    const activeTab = this.activeTab();
    const tab = requestedTab && requestedTab.url !== 'about:blank'
      ? requestedTab
      : activeTab && activeTab.url !== 'about:blank'
        ? activeTab
        : [...this.tabs.values()].findLast((candidate) => candidate.url !== 'about:blank' && !candidate.credentialProtected);
    if (!tab || tab.credentialProtected || tab.view.webContents.isDestroyed() || tab.url === 'about:blank') return undefined;
    const temporarilyAttached = this.attachedTabId !== tab.id;
    if (temporarilyAttached) {
      const size = this.window.getContentSize();
      const windowWidth = size[0] ?? 1280;
      const windowHeight = size[1] ?? 720;
      this.window.contentView.addChildView(tab.view);
      tab.view.setBounds({
        x: Math.max(300, windowWidth - 530),
        y: 70,
        width: Math.min(520, windowWidth - 310),
        height: Math.max(320, windowHeight - 80),
      });
      tab.view.setVisible(true);
    }
    const sensitivePage = /(?:login|signin|auth|passkey|qrcode)/i.test(tab.url);
    const redactionToken = `xgen-${randomUUID()}`;
    try {
      if (sensitivePage) {
        await tab.view.webContents.executeJavaScript(`(() => {
          const token = ${JSON.stringify(redactionToken)};
          const sensitive = new Set([
            ...document.querySelectorAll('input[type="password"], input[autocomplete*="password" i], input[autocomplete*="one-time-code" i], canvas'),
            ...[...document.querySelectorAll('*')].filter((element) => /(?:^|[-_])(qr|qrcode|otp|passkey)(?:[-_]|$)/i.test(String(element.id || '') + ' ' + String(element.className || ''))),
          ]);
          for (const element of sensitive) element.setAttribute('data-xgen-redaction', token);
          const style = document.createElement('style');
          style.id = token;
          style.textContent = '[data-xgen-redaction="' + token + '"] { filter: blur(14px) !important; }';
          document.documentElement.appendChild(style);
        })()`, true).catch(() => undefined);
      }
      await delay(80);
      const bounds = tab.view.getBounds();
      const safeRect = {
        x: 0,
        y: 0,
        width: bounds.width,
        height: sensitivePage
          ? Math.min(150, bounds.height)
          : Math.min(Math.round(bounds.width * 10 / 16), bounds.height),
      };
      const image = await withTimeout(tab.view.webContents.capturePage(safeRect), 2_500);
      if (!image || image.isEmpty()) return undefined;
      return {
        id: randomUUID(),
        tabId: tab.id,
        title: tab.title || tab.url,
        url: tab.url,
        capturedAt: new Date().toISOString(),
        reason: sensitivePage ? `보호된 로그인 화면 상단 · ${reason}` : reason,
        imageDataUrl: image.toDataURL(),
      };
    } finally {
      if (sensitivePage && !tab.view.webContents.isDestroyed()) {
        await tab.view.webContents.executeJavaScript(`(() => {
          const token = ${JSON.stringify(redactionToken)};
          document.getElementById(token)?.remove();
          for (const element of document.querySelectorAll('[data-xgen-redaction="' + token + '"]')) element.removeAttribute('data-xgen-redaction');
        })()`, true).catch(() => undefined);
      }
      if (temporarilyAttached) {
        tab.view.setVisible(false);
        this.window.contentView.removeChildView(tab.view);
      }
    }
  }

  private recordHistory(tab: BrowserTab): void {
    if (!tab.url || tab.url === 'about:blank') return;
    const previous = this.history[this.history.length - 1];
    if (previous?.tabId === tab.id && previous.url === tab.url && Date.now() - previous.visitedAtMs < 2_000) return;
    const visitedAtMs = Date.now();
    this.history.push({
      tabId: tab.id,
      title: tab.title || tab.url,
      url: tab.url,
      visitedAt: new Date(visitedAtMs).toISOString(),
      visitedAtMs,
    });
    if (this.history.length > 2_000) this.history.splice(0, this.history.length - 2_000);
  }
}

function clampLayoutValue(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

function isAllowedBrowserUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol;
    return protocol === 'http:' || protocol === 'https:' || protocol === 'about:';
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

async function withTimeout<T>(promise: Promise<T>, durationMs: number): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), durationMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
