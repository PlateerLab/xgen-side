import { contextBridge, ipcRenderer } from 'electron';
import type {
  BrowserTabState,
  BrowserLayoutState,
  CommandRequest,
  CommandResult,
  AgentRunEvent,
  AgentRunHandle,
  AgentRunRequest,
  AgentRunResult,
  AppSettings,
  LocalDataStatus,
  LocalMarkdownFile,
  ProviderId,
  ProviderStatus,
  XgenSideApi,
} from '../shared/contracts';

let runSequence = 0;
const runListeners = new Map<string, (event: AgentRunEvent) => void>();

ipcRenderer.on('agent:run-event', (_event, envelope: { requestId: string; event: AgentRunEvent }) => {
  runListeners.get(envelope.requestId)?.(envelope.event);
});

function startAgentRun(
  request: AgentRunRequest,
  listener?: (event: AgentRunEvent) => void,
): AgentRunHandle {
  const id = `renderer-${Date.now()}-${++runSequence}`;
  if (listener) runListeners.set(id, listener);
  const result = (ipcRenderer.invoke('agent:run', request, id) as Promise<AgentRunResult>)
    .finally(() => setTimeout(() => runListeners.delete(id), 0));
  return {
    id,
    result,
    cancel: () => ipcRenderer.invoke('agent:cancel', id),
  };
}

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
    start: startAgentRun,
  },
  skills: {
    list: () => ipcRenderer.invoke('skills:list'),
    route: (request: AgentRunRequest) => ipcRenderer.invoke('skills:route', request),
  },
  localData: {
    status: (): Promise<LocalDataStatus> => ipcRenderer.invoke('local-data:status'),
    open: (): Promise<string> => ipcRenderer.invoke('local-data:open'),
    listMarkdown: (): Promise<LocalMarkdownFile[]> => ipcRenderer.invoke('local-data:list-markdown'),
    readMarkdown: (relativePath: string): Promise<string> => ipcRenderer.invoke('local-data:read-markdown', relativePath),
    writeMarkdown: (relativePath: string, content: string): Promise<void> => ipcRenderer.invoke('local-data:write-markdown', relativePath, content),
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
