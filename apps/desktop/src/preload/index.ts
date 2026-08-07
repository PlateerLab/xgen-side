import { contextBridge, ipcRenderer } from 'electron';
import type {
  BrowserTabState,
  BrowserLayoutState,
  CommandRequest,
  CommandResult,
  AgentRunRequest,
  AgentRunResult,
  AppSettings,
  LocalDataStatus,
  ProviderId,
  ProviderStatus,
  XgenSideApi,
} from '../shared/contracts';

const api: XgenSideApi = {
  engine: {
    status: () => ipcRenderer.invoke('engine:status'),
  },
  browser: {
    listTabs: () => ipcRenderer.invoke('browser:list-tabs'),
    newTab: (url?: string) => ipcRenderer.invoke('browser:new-tab', url),
    activateTab: (id: string) => ipcRenderer.invoke('browser:activate-tab', id),
    closeTab: (id: string) => ipcRenderer.invoke('browser:close-tab', id),
    navigate: (input: string) => ipcRenderer.invoke('browser:navigate', input),
    back: () => ipcRenderer.invoke('browser:back'),
    forward: () => ipcRenderer.invoke('browser:forward'),
    reload: () => ipcRenderer.invoke('browser:reload'),
    setLayout: (layout: BrowserLayoutState) => ipcRenderer.invoke('browser:set-layout', layout),
    getPageContext: () => ipcRenderer.invoke('browser:get-page-context'),
    onTabsChanged: (listener: (tabs: BrowserTabState[]) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, tabs: BrowserTabState[]): void => listener(tabs);
      ipcRenderer.on('browser:tabs-changed', handler);
      return () => ipcRenderer.removeListener('browser:tabs-changed', handler);
    },
  },
  providers: {
    list: (): Promise<ProviderStatus[]> => ipcRenderer.invoke('providers:list'),
    authenticate: (id: ProviderId) => ipcRenderer.invoke('providers:authenticate', id),
  },
  agent: {
    run: (request: AgentRunRequest): Promise<AgentRunResult> => ipcRenderer.invoke('agent:run', request),
  },
  skills: {
    route: (request: AgentRunRequest) => ipcRenderer.invoke('skills:route', request),
  },
  localData: {
    status: (): Promise<LocalDataStatus> => ipcRenderer.invoke('local-data:status'),
    open: (): Promise<string> => ipcRenderer.invoke('local-data:open'),
  },
  settings: {
    load: (): Promise<AppSettings> => ipcRenderer.invoke('settings:load'),
    save: (settings: AppSettings): Promise<AppSettings> => ipcRenderer.invoke('settings:save', settings),
  },
  command: {
    run: (request: CommandRequest): Promise<CommandResult> => ipcRenderer.invoke('command:run', request),
    approve: (token: string): Promise<CommandResult> => ipcRenderer.invoke('command:approve', token),
  },
};

contextBridge.exposeInMainWorld('xgenSide', api);
