import { BrowserWindow, WebContentsView } from 'electron';
import { randomUUID } from 'node:crypto';
import type { BrowserLayoutState, BrowserTabState, PageContext } from '../shared/contracts';

interface BrowserTab {
  id: string;
  view: WebContentsView;
  title: string;
  url: string;
  loading: boolean;
}

export class BrowserWorkspace {
  private readonly tabs = new Map<string, BrowserTab>();
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

  async createTab(url = 'https://www.google.com/'): Promise<BrowserTabState[]> {
    const id = randomUUID();
    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition: 'persist:xgen-side-default',
      },
    });
    const tab: BrowserTab = {
      id,
      view,
      title: 'New tab',
      url: 'about:blank',
      loading: false,
    };

    this.tabs.set(id, tab);
    this.attachTabEvents(tab);
    this.activateTab(id);
    await view.webContents.loadURL(normalizeAddressInput(url));
    return this.snapshot();
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
      this.window.contentView.removeChildView(tab.view);
      this.attachedTabId = undefined;
    }
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

  async navigate(input: string): Promise<BrowserTabState[]> {
    const tab = this.activeTab();
    if (!tab) return this.snapshot();
    await tab.view.webContents.loadURL(normalizeAddressInput(input));
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
    if (!tab || tab.view.webContents.isDestroyed()) return undefined;
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
      rightWidth: clampLayoutValue(layout.rightWidth, 0, 480),
      chromeHeight: clampLayoutValue(layout.chromeHeight, 56, 110),
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
      void this.createTab(url);
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
      this.emit();
    });
    webContents.on('did-navigate', (_event, url) => {
      tab.url = url;
      this.emit();
    });
    webContents.on('did-navigate-in-page', (_event, url) => {
      tab.url = url;
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
        if (attached) this.window.contentView.removeChildView(attached.view);
        this.attachedTabId = undefined;
      }
      return;
    }

    if (this.attachedTabId === active.id) return;
    if (this.attachedTabId) {
      const attached = this.tabs.get(this.attachedTabId);
      if (attached) this.window.contentView.removeChildView(attached.view);
    }
    this.window.contentView.addChildView(active.view);
    this.attachedTabId = active.id;
  }

  private snapshot(): BrowserTabState[] {
    return [...this.tabs.values()].map((tab) => ({
      id: tab.id,
      title: tab.title,
      url: tab.url,
      active: tab.id === this.activeTabId,
      loading: tab.loading,
      canGoBack: tab.view.webContents.navigationHistory.canGoBack(),
      canGoForward: tab.view.webContents.navigationHistory.canGoForward(),
    }));
  }

  private emit(): BrowserTabState[] {
    const tabs = this.snapshot();
    this.notify(tabs);
    return tabs;
  }
}

function clampLayoutValue(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

function normalizeAddressInput(input: string): string {
  const value = input.trim();
  if (!value) return 'about:blank';

  try {
    const parsed = new URL(value.includes('://') ? value : `https://${value}`);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.toString();
  } catch {
    // Fall through to search.
  }

  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
}

function isAllowedBrowserUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol;
    return protocol === 'http:' || protocol === 'https:' || protocol === 'about:';
  } catch {
    return false;
  }
}
