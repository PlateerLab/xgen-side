import { app, BrowserWindow, ipcMain, session, type Session } from 'electron';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { BrowserWorkspace } from './browser-workspace';
import { CommandBroker } from './command/command-broker';
import { AgentBrowserClient } from './engine/agent-browser-client';
import { ProviderManager } from './provider/provider-manager';
import { LocalRunStore } from './storage/local-run-store';
import { LocalSettingsStore } from './storage/local-settings-store';
import type { AgentRunRequest, AppSettings, BrowserLayoutState, CommandRequest, ProviderId } from '../shared/contracts';

let mainWindow: BrowserWindow | undefined;
let workspace: BrowserWorkspace | undefined;
const engineClient = new AgentBrowserClient();
const runStore = new LocalRunStore();
const settingsStore = new LocalSettingsStore();
const commandBroker = new CommandBroker((request, result) => runStore.recordCommand(request, result));
let providerManager: ProviderManager | undefined;

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

void bootstrap();

async function bootstrap(): Promise<void> {
  const cdpPort = await reserveLoopbackPort();
  app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
  app.commandLine.appendSwitch('remote-debugging-port', String(cdpPort));
  await app.whenReady();
  await runStore.initialize();
  providerManager = new ProviderManager(runStore, engineClient, settingsStore, cdpPort);
  configureSessionSecurity();
  registerIpc();
  await createWindow();
}

app.on('window-all-closed', () => {
  app.quit();
});

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 1040,
    minHeight: 700,
    backgroundColor: '#00000000',
    title: 'XGEN Side',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  configureWindowMaterial(mainWindow);
  mainWindow.setMenuBarVisibility(false);

  workspace = new BrowserWorkspace(mainWindow, (tabs) => {
    mainWindow?.webContents.send('browser:tabs-changed', tabs);
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  // Keep the desktop shell on its own renderer after the first load. Registering
  // this guard before loadFile/loadURL prevents Electron from loading the shell
  // at all and leaves only the embedded web view visible.
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());

  await workspace.createTab();
}

function configureWindowMaterial(window: BrowserWindow): void {
  if (process.platform === 'win32') {
    try {
      window.setBackgroundMaterial('mica');
    } catch {
      // Older Windows versions keep the renderer's opaque fallback surface.
    }
    return;
  }

  if (process.platform === 'darwin') {
    window.setVibrancy('under-window');
  }
}

function configureSessionSecurity(): void {
  configurePermissions(session.defaultSession);
  configurePermissions(session.fromPartition('persist:xgen-side-default'));
}

function configurePermissions(targetSession: Session): void {
  targetSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  targetSession.setPermissionCheckHandler(() => false);
}

function registerIpc(): void {
  ipcMain.handle('engine:status', () => engineClient.status());
  ipcMain.handle('browser:list-tabs', () => workspace?.listTabs() ?? []);
  ipcMain.handle('browser:new-tab', (_event, url?: string) => workspace?.createTab(url));
  ipcMain.handle('browser:activate-tab', (_event, id: string) => workspace?.activateTab(id));
  ipcMain.handle('browser:close-tab', (_event, id: string) => workspace?.closeTab(id));
  ipcMain.handle('browser:navigate', (_event, input: string) => workspace?.navigate(input));
  ipcMain.handle('browser:back', () => workspace?.back());
  ipcMain.handle('browser:forward', () => workspace?.forward());
  ipcMain.handle('browser:reload', () => workspace?.reload());
  ipcMain.handle('browser:set-layout', (_event, layout: BrowserLayoutState) => workspace?.setLayout(layout));
  ipcMain.handle('browser:get-page-context', () => workspace?.getPageContext());
  ipcMain.handle('providers:list', () => providerManager?.list() ?? []);
  ipcMain.handle('providers:authenticate', (_event, id: ProviderId) => providerManager?.authenticate(id));
  ipcMain.handle('agent:run', (_event, request: AgentRunRequest) => providerManager?.run(request));
  ipcMain.handle('skills:route', (_event, request: AgentRunRequest) => providerManager?.previewRoute(request));
  ipcMain.handle('local-data:status', () => runStore.status());
  ipcMain.handle('local-data:open', () => providerManager?.openLocalData() ?? 'Provider manager is not ready.');
  ipcMain.handle('settings:load', () => settingsStore.load());
  ipcMain.handle('settings:save', (_event, settings: AppSettings) => settingsStore.save(settings));
  ipcMain.handle('command:run', (_event, request: CommandRequest) => commandBroker.request(sanitizeCommandRequest(request)));
  ipcMain.handle('command:approve', (_event, token: string) => commandBroker.approve(token));
}

function reserveLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not reserve a local CDP port.'));
        return;
      }
      const port = address.port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function sanitizeCommandRequest(request: CommandRequest): CommandRequest {
  if (!request || !['powershell', 'cmd', 'wsl'].includes(request.shell)) {
    throw new Error('Unsupported command shell.');
  }
  if (typeof request.script !== 'string' || request.script.length > 20_000) {
    throw new Error('Command scripts must be text shorter than 20,000 characters.');
  }
  return { shell: request.shell, script: request.script };
}
