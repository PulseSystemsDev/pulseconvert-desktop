import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron';
import fs from 'fs';
import path from 'path';
import log from 'electron-log';
import { AuthManager } from './authManager';
import { runConvertFlow } from './convertFlow';
import { registerThisDevice, getOrCreateDeviceId } from './deviceRegistry';
import { CommandListener, type DeviceCommand } from './commandListener';
import { applyConfiguredDeploy } from './deploy/deployFlow';
import { runLocalOptimize, runManualOptimize } from './optimizeFlow';
import { desktopFetchJson } from './apiClient';
import config from './configStore';
import { clearSftpPassword, loadSftpPassword, saveSftpPassword } from './deploy/sftpCredentialsStore';
import type {
  AuthStatus,
  CatalogListResponse,
  CatalogSearchRequest,
  ConversionProfile,
  ConversionTarget,
  ConvertRequest,
  DesktopSettings,
  InputPickerKind,
  OperationProgress,
  OptimizeCategory,
  OptimizeInputKind,
  OptimizeRequest,
  SelectedInput,
} from './types';

log.transports.file.level = 'info';
log.transports.console.level = 'debug';

const authManager = new AuthManager();
const approvedOptimizeInputs = new Set<string>();
const generatedOutputs = new Set<string>();
const ARCHIVE_EXTENSIONS = new Set(['.zip', '.rar', '.7z', '.oiv', '.rpf']);
const CONVERSION_PROFILES = new Set<ConversionProfile>(['preserve']);
const CONVERSION_TARGETS = new Set<ConversionTarget>(['addon', 'replace']);
const OPTIMIZE_CATEGORIES = new Set<OptimizeCategory>(['props', 'vehicles', 'clothing', 'textures']);
const OPTIMIZE_INPUT_KINDS = new Set<OptimizeInputKind>(['archive', 'folder']);
const CATALOG_KINDS = new Set(['vehicles', 'map', 'ped', 'eup']);

let mainWindow: BrowserWindow | null = null;
let heavyOperationTail: Promise<void> = Promise.resolve();
let pendingHeavyOperations = 0;
let commandListenerActive = false;
let lastProgress: OperationProgress | null = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

function defaultOutputFolder(): string {
  return path.join(app.getPath('documents'), 'PulseConvert');
}

function configuredOutputFolder(): string {
  return config.get('outputFolder') || defaultOutputFolder();
}

function initializeOutputFolder(): void {
  const folder = configuredOutputFolder();
  fs.mkdirSync(folder, { recursive: true });
  if (!config.get('outputFolder')) config.set('outputFolder', folder);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 820,
    minWidth: 940,
    minHeight: 620,
    title: 'Pulse Convert Desktop',
    backgroundColor: '#080b10',
    show: false,
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin'
      ? { trafficLightPosition: { x: 16, y: 16 } }
      : { titleBarOverlay: { color: '#0c0f14', symbolColor: '#dce1e8', height: 48 } }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.webContents.on('did-finish-load', () => {
    if (lastProgress) mainWindow?.webContents.send('convert:progress', lastProgress);
  });
  mainWindow.loadFile(path.join(__dirname, '..', '..', 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  log.info('Pulse Convert Desktop ready, version', app.getVersion());
  initializeOutputFolder();
  // Must resolve before createWindow(): safeStorage (and therefore any persisted sign-in) is only
  // reliably readable after this point, and the renderer queries auth:get-status as soon as it
  // loads. authManager's onStatusChange listener (registered below) starts the command listener
  // itself once this restores a signed-in session, so no explicit check is needed here.
  await authManager.initialize();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function emitProgress(progress: OperationProgress): void {
  lastProgress = progress;
  mainWindow?.webContents.send('convert:progress', progress);
}

function reportFor(operation: OperationProgress['operation']) {
  return (label: string, current?: number, total?: number) => emitProgress({ operation, label, current, total });
}

/** One queue protects CPU-heavy native/Blender work from manual and dashboard command overlap. */
function serializeHeavyOperation<T>(operation: OperationProgress['operation'], task: () => Promise<T>): Promise<T> {
  if (pendingHeavyOperations > 0) emitProgress({ operation, label: 'Queued behind the current operation' });
  pendingHeavyOperations += 1;
  const result = heavyOperationTail.then(async () => {
    try {
      const value = await task();
      emitProgress({ operation, label: 'Operation complete' });
      return value;
    } catch (err) {
      emitProgress({ operation, label: `Operation failed: ${(err as Error).message || 'Unknown error'}` });
      throw err;
    }
  });
  heavyOperationTail = result.then(() => undefined, () => undefined);
  return result.finally(() => {
    pendingHeavyOperations = Math.max(0, pendingHeavyOperations - 1);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeConvertRequest(value: unknown): ConvertRequest & { inputPath?: string } {
  const raw = typeof value === 'string' ? { url: value, profile: 'preserve', target: 'addon' } : value;
  if (!isRecord(raw)) throw new Error('Invalid conversion request.');

  const profile = raw.profile ?? 'preserve';
  const target = raw.target ?? 'addon';
  if (!CONVERSION_PROFILES.has(profile as ConversionProfile)) throw new Error('Invalid conversion profile.');
  if (!CONVERSION_TARGETS.has(target as ConversionTarget)) throw new Error('Invalid conversion target.');

  if (typeof raw.inputPath === 'string' && raw.inputPath.length > 0) {
    if (!path.isAbsolute(raw.inputPath)) throw new Error('The selected input must be an absolute local path.');
    if (!approvedOptimizeInputs.has(pathKey(raw.inputPath))) {
      throw new Error('Choose this file through Pulse Convert before starting conversion.');
    }
    const inputPath = fs.realpathSync(raw.inputPath);
    const extension = path.extname(inputPath).toLowerCase();
    if (!ARCHIVE_EXTENSIONS.has(extension)) throw new Error('File-based conversion needs a ZIP, RAR, 7z, OIV, or RPF archive.');
    return { url: '', profile: profile as ConversionProfile, target: target as ConversionTarget, inputPath };
  }

  if (typeof raw.url !== 'string' || raw.url.trim().length === 0 || raw.url.length > 4096) {
    throw new Error('Enter a valid mod URL first.');
  }
  let parsed: URL;
  try {
    parsed = new URL(raw.url.trim());
  } catch {
    throw new Error('Enter a complete http:// or https:// mod URL.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('Only normal http:// or https:// mod URLs are supported.');
  }
  return { url: parsed.href, profile: profile as ConversionProfile, target: target as ConversionTarget };
}

function normalizeRemoteConvertRequest(payload: unknown): ConvertRequest {
  if (isRecord(payload)) {
    return normalizeConvertRequest({
      url: payload.url,
      profile: payload.profile ?? payload.conversionProfile ?? 'preserve',
      target: payload.target ?? payload.conversionTarget ?? 'addon',
    });
  }
  return normalizeConvertRequest(payload);
}

function pathKey(filePath: string): string {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function normalizeOptimizeRequest(value: unknown, requirePickerApproval: boolean): OptimizeRequest {
  if (!isRecord(value)) throw new Error('Invalid optimization request.');
  if (typeof value.inputPath !== 'string' || value.inputPath.length === 0 || value.inputPath.length > 32_000) {
    throw new Error('Choose a local archive or resource folder first.');
  }
  if (!OPTIMIZE_INPUT_KINDS.has(value.inputKind as OptimizeInputKind)) throw new Error('Invalid optimization input type.');
  if (!OPTIMIZE_CATEGORIES.has(value.category as OptimizeCategory)) throw new Error('Invalid optimization category.');
  if (!path.isAbsolute(value.inputPath)) throw new Error('The selected input must be an absolute local path.');

  let inputPath: string;
  try {
    inputPath = fs.realpathSync(value.inputPath);
  } catch {
    throw new Error('The selected input no longer exists.');
  }
  if (requirePickerApproval && !approvedOptimizeInputs.has(pathKey(inputPath))) {
    throw new Error('Choose this input through Pulse Convert before starting optimization.');
  }

  const stat = fs.statSync(inputPath);
  const inputKind = value.inputKind as OptimizeInputKind;
  if (inputKind === 'folder' && !stat.isDirectory()) throw new Error('The selected optimization input is not a folder.');
  if (inputKind === 'archive' && !stat.isFile()) throw new Error('The selected optimization input is not a file.');
  if (stat.isFile() && stat.size > 4 * 1024 * 1024 * 1024) throw new Error('The selected input exceeds the 4 GiB safety limit.');
  const extension = path.extname(inputPath).toLowerCase();
  if (inputKind === 'archive' && !ARCHIVE_EXTENSIONS.has(extension)) throw new Error('Archive input must be ZIP, RAR, 7z, OIV, or RPF.');

  return {
    inputPath,
    inputKind,
    category: value.category as OptimizeCategory,
  };
}

function registerOutput(filePath: string): void {
  generatedOutputs.add(pathKey(filePath));
}

// --- Remote commands ---

async function handleDeviceCommand(command: DeviceCommand): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  if (command.type === 'convert_and_deploy') {
    let payload: unknown;
    try {
      payload = command.payload ? JSON.parse(command.payload) : null;
      const request = normalizeRemoteConvertRequest(payload);
      return await serializeHeavyOperation('remote-convert', async () => {
        const result = await runConvertFlow(request, reportFor('remote-convert'), configuredOutputFolder());
        registerOutput(result.outputZipPath);
        const deploy = await applyConfiguredDeploy(result.outputZipPath, result.resourceName);
        return { ok: true, result: { ...result, deploy } };
      });
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  if (command.type === 'run_optimize') {
    const folder = config.get('localDeployFolder');
    if (!folder) return { ok: false, error: 'No local deploy folder is configured on this device yet.' };
    try {
      return await serializeHeavyOperation('remote-optimize', async () => {
        const summary = await runLocalOptimize(folder, configuredOutputFolder(), reportFor('remote-optimize'));
        for (const output of summary.outputs) registerOutput(output.outputZipPath);
        return { ok: true, result: summary };
      });
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  return { ok: false, error: `Unknown command type: ${command.type}` };
}

const commandListener = new CommandListener(getOrCreateDeviceId(), handleDeviceCommand);

// --- Auth IPC ---

function startCommandListener(): void {
  if (commandListenerActive || !app.isReady()) return;
  commandListenerActive = true;
  void registerThisDevice();
  commandListener.start();
}

authManager.onStatusChange((status: AuthStatus) => {
  mainWindow?.webContents.send('auth:status-changed', status);
  if (status.state === 'signed-in') {
    startCommandListener();
  } else if (status.state === 'signed-out') {
    commandListenerActive = false;
    commandListener.stop();
  }
});

ipcMain.on('auth:start', () => authManager.startSignIn().catch((err) => log.error('startSignIn failed', err)));
ipcMain.on('auth:cancel', () => authManager.cancelSignIn());
ipcMain.on('auth:sign-out', () => authManager.signOut());
ipcMain.handle('auth:get-status', () => authManager.getStatus());

ipcMain.on('shell:open-external', (_event, value: unknown) => {
  if (typeof value !== 'string') return;
  try {
    const url = new URL(value);
    const accountsOrigin = new URL(config.get('accountsIssuer')).origin;
    if (url.protocol === 'https:' && url.origin === accountsOrigin) void shell.openExternal(url.href);
  } catch {
    // Ignore malformed/untrusted renderer input.
  }
});

// --- Convert / optimize IPC ---

ipcMain.handle('convert:start', async (_event, value: unknown) => {
  try {
    const request = normalizeConvertRequest(value);
    return await serializeHeavyOperation('convert', async () => {
      const result = await runConvertFlow(request, reportFor('convert'), configuredOutputFolder());
      registerOutput(result.outputZipPath);
      const deploy = await applyConfiguredDeploy(result.outputZipPath, result.resourceName);
      return { ok: true, result: { ...result, deploy } };
    });
  } catch (err) {
    log.error('convert:start failed', err);
    return { ok: false, error: (err as Error).message || 'Conversion failed.' };
  }
});

ipcMain.handle('optimize:start', async (_event, value: unknown) => {
  try {
    const request = normalizeOptimizeRequest(value, true);
    return await serializeHeavyOperation('optimize', async () => {
      const result = await runManualOptimize(request, reportFor('optimize'), configuredOutputFolder());
      registerOutput(result.outputZipPath);
      return { ok: true, result };
    });
  } catch (err) {
    log.error('optimize:start failed', err);
    return { ok: false, error: (err as Error).message || 'Optimization failed.' };
  }
});

ipcMain.on('shell:show-in-folder', (_event, value: unknown) => {
  if (typeof value !== 'string' || !path.isAbsolute(value) || !generatedOutputs.has(pathKey(value))) return;
  if (fs.existsSync(value)) shell.showItemInFolder(value);
});

ipcMain.handle('input:choose', async (_event, kind: unknown): Promise<SelectedInput | null> => {
  if (!mainWindow || (kind !== 'archive-or-file' && kind !== 'folder')) return null;
  const pickerKind = kind as InputPickerKind;
  const result = await dialog.showOpenDialog(mainWindow, pickerKind === 'folder'
    ? { properties: ['openDirectory'] }
    : {
        properties: ['openFile'],
        filters: [{ name: 'GTA V resource archives', extensions: ['zip', 'rar', '7z', 'oiv', 'rpf'] }],
      });
  if (result.canceled || result.filePaths.length !== 1) return null;

  const inputPath = fs.realpathSync(result.filePaths[0]);
  const stat = fs.statSync(inputPath);
  const extension = path.extname(inputPath).toLowerCase();
  let inputKind: OptimizeInputKind;
  if (stat.isDirectory()) inputKind = 'folder';
  else if (ARCHIVE_EXTENSIONS.has(extension)) inputKind = 'archive';
  else return null;
  approvedOptimizeInputs.add(pathKey(inputPath));
  return { inputPath, inputKind, name: path.basename(inputPath), sizeBytes: stat.isFile() ? stat.size : null };
});

// --- Settings IPC ---

function currentSettings(): DesktopSettings {
  return {
    deployMode: config.get('deployMode'),
    localDeployFolder: config.get('localDeployFolder'),
    sftpHost: config.get('sftpHost'),
    sftpPort: config.get('sftpPort'),
    sftpUsername: config.get('sftpUsername'),
    sftpRemotePath: config.get('sftpRemotePath'),
    outputFolder: config.get('outputFolder') || defaultOutputFolder(),
    hasSftpPassword: loadSftpPassword() !== null,
  };
}

function nullableString(value: unknown, fallback: string | null): string | null {
  if (value === undefined) return fallback;
  if (value === null) return null;
  if (typeof value !== 'string') throw new Error('A settings text value was invalid.');
  if (value.length > 32_000) throw new Error('A settings text value was too long.');
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function nullableAbsolutePath(value: unknown, fallback: string | null, label: string): string | null {
  const normalized = nullableString(value, fallback);
  if (normalized !== null && !path.isAbsolute(normalized)) throw new Error(`${label} must be an absolute path.`);
  return normalized;
}

ipcMain.handle('settings:get', (): DesktopSettings => currentSettings());

ipcMain.handle('settings:save', (_event, value: unknown): { ok: boolean; error?: string } => {
  try {
    if (!isRecord(value)) throw new Error('Invalid settings payload.');
    const previous = currentSettings();
    const deployMode = value.deployMode ?? previous.deployMode;
    if (!['none', 'local', 'sftp'].includes(String(deployMode))) throw new Error('Invalid deploy mode.');
    const rawPort = value.sftpPort ?? previous.sftpPort;
    if (typeof rawPort !== 'number' || !Number.isInteger(rawPort) || rawPort < 1 || rawPort > 65_535) {
      throw new Error('SFTP port must be a whole number from 1 to 65535.');
    }

    const outputFolder = nullableAbsolutePath(value.outputFolder, previous.outputFolder, 'Output folder') || defaultOutputFolder();
    const updates = {
      deployMode: deployMode as DesktopSettings['deployMode'],
      localDeployFolder: nullableAbsolutePath(value.localDeployFolder, previous.localDeployFolder, 'Local deploy folder'),
      sftpHost: nullableString(value.sftpHost, previous.sftpHost),
      sftpPort: rawPort,
      sftpUsername: nullableString(value.sftpUsername, previous.sftpUsername),
      sftpRemotePath: nullableString(value.sftpRemotePath, previous.sftpRemotePath),
      outputFolder,
    };
    const changesPassword = Object.prototype.hasOwnProperty.call(value, 'sftpPassword') && value.sftpPassword !== undefined;
    if (changesPassword) {
      if (typeof value.sftpPassword !== 'string') throw new Error('SFTP password must be text.');
      if (value.sftpPassword.length > 4096) throw new Error('SFTP password is too long.');
      if (value.sftpPassword.length > 0 && !safeStorage.isEncryptionAvailable()) {
        throw new Error('OS-level credential encryption is unavailable; the password was not saved.');
      }
    }

    fs.mkdirSync(outputFolder, { recursive: true });
    const previousPassword = changesPassword ? loadSftpPassword() : null;
    try {
      if (changesPassword) {
        if ((value.sftpPassword as string).length === 0) clearSftpPassword();
        else saveSftpPassword(value.sftpPassword as string);
      }
      config.set(updates);
    } catch (commitError) {
      if (changesPassword) {
        try {
          if (previousPassword === null) clearSftpPassword();
          else saveSftpPassword(previousPassword);
        } catch (rollbackError) {
          log.error('Could not roll back SFTP credential after settings failure', rollbackError);
        }
      }
      throw commitError;
    }
    return { ok: true };
  } catch (err) {
    log.warn('settings:save rejected', err);
    return { ok: false, error: (err as Error).message };
  }
});

ipcMain.handle('settings:choose-folder', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
});

// --- Catalog IPC ---

ipcMain.handle('catalog:search', async (_event, value: unknown): Promise<CatalogListResponse> => {
  if (!isRecord(value) || !CATALOG_KINDS.has(String(value.kind))) throw new Error('Invalid catalog search request.');
  const request = value as unknown as CatalogSearchRequest;
  const page = Number.isInteger(request.page) && request.page > 0 ? request.page : 1;
  const search = typeof request.search === 'string' ? request.search.slice(0, 200) : '';
  const sort = typeof request.sort === 'string' ? request.sort : 'latest';
  const params = new URLSearchParams({ search, sort, page: String(page), pageSize: '24' });
  let response: CatalogListResponse;
  if (request.kind === 'vehicles') {
    response = await desktopFetchJson<CatalogListResponse>(`/api/catalog/vehicles/list?${params.toString()}`);
  } else {
    params.set('kind', request.kind);
    response = await desktopFetchJson<CatalogListResponse>(`/api/catalog-content/list?${params.toString()}`);
  }

  const apiBase = config.get('apiBaseUrl').replace(/\/$/, '');
  return {
    ...response,
    entries: response.entries.map((entry) => ({
      ...entry,
      thumbnailUrl: entry.thumbnailUrl && entry.thumbnailUrl.startsWith('/') ? `${apiBase}${entry.thumbnailUrl}` : entry.thumbnailUrl,
    })),
  };
});
