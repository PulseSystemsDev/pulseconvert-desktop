import { app, BrowserWindow, ipcMain, shell, dialog } from 'electron';
import path from 'path';
import log from 'electron-log';
import { AuthManager } from './authManager';
import { runConvertFlow } from './convertFlow';
import { registerThisDevice, getOrCreateDeviceId } from './deviceRegistry';
import { CommandListener, type DeviceCommand } from './commandListener';
import { applyConfiguredDeploy } from './deploy/deployFlow';
import { runLocalOptimize } from './optimizeFlow';
import config from './configStore';
import { saveSftpPassword, clearSftpPassword } from './deploy/sftpCredentialsStore';
import type { AuthStatus, DeploySettings } from './types';

log.transports.file.level = 'info';
log.transports.console.level = 'debug';

const authManager = new AuthManager();
let mainWindow: BrowserWindow | null = null;

// Single instance lock - focus the existing window instead of opening a second one, matching the
// sibling PulseMDT desktop client's own convention (d:\Desktop\PulseMDT\desktop\electron\main.ts).
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 680,
    minWidth: 420,
    minHeight: 560,
    title: 'Pulse Convert Desktop',
    backgroundColor: '#14151a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  // __dirname here is dist/electron/ (tsup's output dir, not the source electron/ dir) - the
  // renderer/ folder is never bundled by tsup (see tsup.config.ts's entry list), it's loaded
  // straight from the project root at runtime, two levels up from dist/electron/.
  mainWindow.loadFile(path.join(__dirname, '..', '..', 'renderer', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  log.info('Pulse Convert Desktop ready, version', app.getVersion());
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// --- Remote commands (Phase C) ---

async function handleDeviceCommand(command: DeviceCommand): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  if (command.type === 'convert_and_deploy') {
    let url: string | undefined;
    try {
      url = command.payload ? (JSON.parse(command.payload) as { url?: string }).url : undefined;
    } catch {
      // fall through to the "no URL" error below
    }
    if (!url) return { ok: false, error: 'No URL was included with this command.' };

    const result = await runConvertFlow(url, (label) => mainWindow?.webContents.send('convert:progress', label));
    const deploy = await applyConfiguredDeploy(result.outputZipPath, result.resourceName);
    return {
      ok: true,
      result: { resourceName: result.resourceName, outputZipPath: result.outputZipPath, fromCache: result.fromCache, deploy },
    };
  }

  if (command.type === 'run_optimize') {
    const folder = config.get('localDeployFolder');
    if (!folder) return { ok: false, error: 'No local deploy folder is configured on this device yet.' };
    try {
      const summary = await runLocalOptimize(folder, (label) => mainWindow?.webContents.send('convert:progress', label));
      return { ok: true, result: summary };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  return { ok: false, error: `Unknown command type: ${command.type}` };
}

const commandListener = new CommandListener(getOrCreateDeviceId(), handleDeviceCommand);

// --- IPC: auth ---

authManager.onStatusChange((status: AuthStatus) => {
  mainWindow?.webContents.send('auth:status-changed', status);

  if (status.state === 'signed-in') {
    void registerThisDevice();
    commandListener.start();
  } else if (status.state === 'signed-out') {
    commandListener.stop();
  }
});

// Cold start already signed in (a stored, still-valid token from a previous session) - the
// listener above only fires on a *transition* into signed-in, so a fresh launch that starts
// already-authenticated needs its own kick.
if (authManager.getStatus().state === 'signed-in') {
  void registerThisDevice();
  commandListener.start();
}

ipcMain.on('auth:start', () => {
  authManager.startSignIn().catch((err) => log.error('startSignIn failed', err));
});

ipcMain.on('auth:cancel', () => {
  authManager.cancelSignIn();
});

ipcMain.on('auth:sign-out', () => {
  authManager.signOut();
});

ipcMain.handle('auth:get-status', () => authManager.getStatus());

ipcMain.on('shell:open-external', (_e, url: string) => {
  // Only ever an https URL Pulse Accounts itself returned (verification_uri_complete) - never
  // renderer-supplied arbitrary input, since the renderer only ever has what main.ts already
  // pushed it via auth:status-changed.
  if (typeof url === 'string' && url.startsWith('https://')) {
    void shell.openExternal(url);
  }
});

// --- IPC: convert ---

let converting = false;

ipcMain.handle('convert:start', async (_e, url: string) => {
  if (converting) return { ok: false, error: 'A conversion is already in progress.' };
  if (typeof url !== 'string' || !url.trim()) return { ok: false, error: 'Enter a mod URL first.' };

  converting = true;
  try {
    const result = await runConvertFlow(url.trim(), (label) => {
      mainWindow?.webContents.send('convert:progress', label);
    });
    const deploy = await applyConfiguredDeploy(result.outputZipPath, result.resourceName);
    return { ok: true, result: { ...result, deploy } };
  } catch (err) {
    log.error('convert:start failed', err);
    return { ok: false, error: (err as Error).message || 'Conversion failed.' };
  } finally {
    converting = false;
  }
});

ipcMain.on('shell:show-in-folder', (_e, filePath: string) => {
  if (typeof filePath === 'string') shell.showItemInFolder(filePath);
});

// --- IPC: deploy settings (Phase D) ---

ipcMain.handle('settings:get', (): DeploySettings => ({
  deployMode: config.get('deployMode'),
  localDeployFolder: config.get('localDeployFolder'),
  sftpHost: config.get('sftpHost'),
  sftpPort: config.get('sftpPort'),
  sftpUsername: config.get('sftpUsername'),
  sftpRemotePath: config.get('sftpRemotePath'),
}));

ipcMain.handle('settings:save', (_e, settings: DeploySettings & { sftpPassword?: string }) => {
  config.set('deployMode', settings.deployMode);
  config.set('localDeployFolder', settings.localDeployFolder);
  config.set('sftpHost', settings.sftpHost);
  config.set('sftpPort', settings.sftpPort);
  config.set('sftpUsername', settings.sftpUsername);
  config.set('sftpRemotePath', settings.sftpRemotePath);
  if (settings.sftpPassword) {
    saveSftpPassword(settings.sftpPassword);
  } else if (settings.sftpPassword === '') {
    clearSftpPassword();
  }
  return { ok: true };
});

ipcMain.handle('settings:choose-folder', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});
