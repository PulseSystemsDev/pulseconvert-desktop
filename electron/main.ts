import './bootstrap';
import { app, BrowserWindow, dialog, ipcMain, Notification, screen, shell } from 'electron';
import fs from 'fs';
import path from 'path';
import log from 'electron-log';
import { AuthManager } from './authManager';
import { absoluteApiUrl, ApiError, desktopFetch } from './apiClient';
import { proxyApiRequest } from './apiProxy';
import { CommandListener, type DeviceCommand } from './commandListener';
import config, { accountsIssuer, apiBase } from './configStore';
import { clearPinnedFingerprint } from './deploy/sftpHostKeyStore';
import { testConfiguredSftp } from './deploy/deployFlow';
import { clearSftpPassword, loadSftpPassword, saveSftpPassword } from './deploy/sftpCredentialsStore';
import { getOrCreateDeviceId, registerThisDevice } from './deviceRegistry';
import {
  approveDropped,
  defaultOutputFolder,
  isKnownOutput,
  outputFolder,
  pickInputs,
  readApprovedText,
  registerOutput,
  requireApprovedInput,
} from './files';
import {
  deployExisting,
  downloadCatalogItem,
  downloadJob,
  optimizeDeployFolder,
  resumeInterruptedTasks,
  startConvert,
  startFix,
  startMapInspect,
  startOptimize,
  startSirenBuild,
  trackJob,
  waitForTask,
} from './operations';
import { credentialStorageKind } from './secureStore';
import { taskManager } from './taskManager';
import { checkForUpdates, getUpdateState, installUpdate, onUpdateState, setupUpdater } from './updater';
import type {
  ApiResult,
  AuthStatus,
  ConversionProfile,
  ConversionTarget,
  DesktopSettings,
  InputKind,
  OptimizeCategory,
  PickerMode,
  SelectedInput,
  Task,
} from './types';

log.transports.file.level = 'info';
log.transports.console.level = 'debug';

const authManager = new AuthManager();
const ARCHIVE_OR_FOLDER = new Set<InputKind>(['archive', 'folder']);
const OPTIMIZE_INPUTS = new Set<InputKind>(['archive', 'folder', 'file']);
const ZIP_ONLY = new Set<InputKind>(['archive']);
const OPTIMIZE_CATEGORIES = new Set<OptimizeCategory>(['props', 'vehicles', 'clothing', 'textures']);
const SUPPORTED_SOURCE_HOSTS = new Set(['gta5-mods.com', 'mediafire.com', 'sharemods.com']);
const EXTERNAL_HOSTS = new Set([
  'convert.pulsesystems.dev',
  'pulsesystems.dev',
  'accounts.pulsesystems.dev',
  'docs.pulsesystems.dev',
  'gta5-mods.com',
  'www.gta5-mods.com',
  'mediafire.com',
  'www.mediafire.com',
  'sharemods.com',
  'discord.gg',
  'github.com',
]);

let mainWindow: BrowserWindow | null = null;
let commandListenerActive = false;
let resumedTasks = false;
let quitting = false;

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

function iconPath(): string {
  return path.join(__dirname, '..', '..', 'assets', 'icon.png');
}

function restoredBounds(): Electron.Rectangle & { maximized: boolean } {
  const saved = config.get('windowBounds');
  const fallback = { width: 1360, height: 860, x: undefined as unknown as number, y: undefined as unknown as number, maximized: false };
  if (!saved) return fallback;
  const visible = screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    return saved.x !== undefined && saved.y !== undefined && saved.x < area.x + area.width - 80 && saved.y < area.y + area.height - 80 && saved.x + saved.width > area.x + 80 && saved.y >= area.y - 20;
  });
  return {
    width: Math.max(saved.width, 1040),
    height: Math.max(saved.height, 680),
    x: visible ? (saved.x as number) : (undefined as unknown as number),
    y: visible ? (saved.y as number) : (undefined as unknown as number),
    maximized: saved.maximized,
  };
}

let saveBoundsTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSaveBounds(): void {
  if (saveBoundsTimer) clearTimeout(saveBoundsTimer);
  saveBoundsTimer = setTimeout(saveBounds, 600);
}

function saveBounds(): void {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized()) return;
  const maximized = mainWindow.isMaximized();
  const bounds = maximized ? mainWindow.getNormalBounds() : mainWindow.getBounds();
  config.set('windowBounds', { ...bounds, maximized });
}

function createWindow(): void {
  const bounds = restoredBounds();
  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 1040,
    minHeight: 680,
    title: 'Pulse Convert',
    icon: process.platform === 'linux' ? iconPath() : undefined,
    backgroundColor: '#080b12',
    show: false,
    titleBarStyle: 'hidden',
    ...(process.platform === 'darwin'
      ? { trafficLightPosition: { x: 16, y: 14 } }
      : { titleBarOverlay: { color: '#080b12', symbolColor: '#c7d0dd', height: 44 } }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  if (process.env.PULSECONVERT_RENDERER_URL && !app.isPackaged) {
    void mainWindow.loadURL(process.env.PULSECONVERT_RENDERER_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  }
  mainWindow.once('ready-to-show', () => {
    if (!mainWindow) return;
    if (bounds.maximized) mainWindow.maximize();
    if (!config.get('launchMinimized')) mainWindow.show();
    else mainWindow.showInactive();
  });
  mainWindow.on('resize', scheduleSaveBounds);
  mainWindow.on('move', scheduleSaveBounds);
  mainWindow.on('close', saveBounds);
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function send(channel: string, ...args: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args);
}

function openExternal(value: unknown): void {
  if (typeof value !== 'string') return;
  try {
    const url = new URL(value);
    const allowedHosts = new Set([...EXTERNAL_HOSTS, new URL(apiBase()).hostname, new URL(accountsIssuer()).hostname]);
    if (url.protocol === 'https:' && allowedHosts.has(url.hostname)) void shell.openExternal(url.href);
    else log.warn('Blocked opening an external link to', url.hostname);
  } catch {
  }
}

app.whenReady().then(async () => {
  log.info('Pulse Convert Desktop ready, version', app.getVersion(), process.platform, process.arch);
  outputFolder();
  for (const task of taskManager.list()) if (task.outputPath) registerOutput(task.outputPath);

  await authManager.initialize();
  createWindow();
  setupUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  quitting = true;
  taskManager.persist();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

taskManager.onChange((tasks) => send('tasks:changed', tasks));
onUpdateState((state) => send('update:state', state));

const NOTIFY_TEXT: Partial<Record<Task['kind'], string>> = {
  'convert-url': 'Conversion finished',
  'convert-file': 'Conversion finished',
  'convert-pack': 'Pack finished',
  optimize: 'Optimization finished',
  fix: 'Fix finished',
  'catalog-download': 'Download finished',
  'job-download': 'Download finished',
  'siren-build': 'Siren resource ready',
  'map-inspect': 'Map inspection ready',
  deploy: 'Deploy finished',
};

taskManager.onFinish((task) => {
  if (quitting) return;
  if (task.phase === 'done' && task.outputPath && config.get('revealOnComplete') && task.origin === 'app') {
    shell.showItemInFolder(task.outputPath);
  }
  if (!config.get('notifyOnComplete') || !Notification.isSupported() || task.phase === 'cancelled') return;
  if (mainWindow?.isFocused()) return;
  const failed = task.phase === 'failed';
  const deployNote = task.deploy?.deployed ? ` and deployed to ${task.deploy.destination}` : '';
  const notification = new Notification({
    title: failed ? `${task.title} failed` : NOTIFY_TEXT[task.kind] ?? 'Finished',
    body: failed ? task.error ?? 'Something went wrong.' : `${task.title}${task.outputPath ? ' saved' : ''}${deployNote}.`,
    icon: iconPath(),
    silent: false,
  });
  notification.on('click', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    send('navigate', 'activity');
  });
  notification.show();
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data };
}

function fail(err: unknown): ApiResult<never> {
  return { ok: false, error: (err as Error)?.message || 'Something went wrong.', status: err instanceof ApiError ? err.status : 0 };
}

function requireSignedIn(): void {
  if (authManager.getStatus().state !== 'signed-in') throw new Error('Sign in first.');
}

function parseSourceUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 4096) throw new Error('Enter a valid mod link.');
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error(`"${value}" is not a complete link.`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('Only http:// and https:// links are supported.');
  if (!SUPPORTED_SOURCE_HOSTS.has(parsed.hostname.replace(/^www\./, ''))) {
    throw new Error('Only gta5-mods.com, mediafire.com, and sharemods.com links are supported.');
  }
  return parsed.href;
}

function parseConvertOptions(raw: Record<string, unknown>): { profile: ConversionProfile; target: ConversionTarget; packBundleMode: 'separate' | 'single' } {
  const packBundleMode = raw.packBundleMode ?? 'separate';
  if (packBundleMode !== 'separate' && packBundleMode !== 'single') throw new Error('Invalid pack mode.');
  return { profile: 'preserve', target: 'addon', packBundleMode };
}

async function handleDeviceCommand(command: DeviceCommand): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  if (!config.get('acceptDashboardCommands')) return { ok: false, error: 'This device is set to ignore commands from the dashboard.' };
  try {
    const payload = command.payload ? JSON.parse(command.payload) : null;
    if (command.type === 'convert_and_deploy') {
      const raw = isRecord(payload) ? payload : { url: payload };
      const task = startConvert({ urls: [parseSourceUrl(raw.url)], inputs: [], ...parseConvertOptions(raw) }, 'dashboard');
      const finished = await waitForTask(task.id);
      if (finished.phase !== 'done') return { ok: false, error: finished.error ?? 'Conversion did not finish.' };
      return { ok: true, result: { outputZipPath: finished.outputPath, resourceName: finished.title, fixLog: finished.fixLog, deploy: finished.deploy } };
    }
    if (command.type === 'run_optimize') {
      const folder = config.get('localDeployFolder');
      if (!folder) return { ok: false, error: 'No local deploy folder is configured on this device yet.' };
      return { ok: true, result: await optimizeDeployFolder(folder) };
    }
    return { ok: false, error: `Unknown command type: ${command.type}` };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

const commandListener = new CommandListener(getOrCreateDeviceId(), handleDeviceCommand);

authManager.onStatusChange((status: AuthStatus) => {
  send('auth:status-changed', status);
  if (status.state === 'awaiting-approval') openExternal(status.verificationUriComplete);
  if (status.state === 'signed-in') {
    if (!resumedTasks) {
      resumedTasks = true;
      resumeInterruptedTasks();
    }
    if (!commandListenerActive && app.isReady()) {
      commandListenerActive = true;
      void registerThisDevice();
      commandListener.start();
    }
  } else if (status.state === 'signed-out') {
    commandListenerActive = false;
    commandListener.stop();
    taskManager.cancelAll();
  }
});

ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  platform: process.platform,
  arch: process.arch,
  apiBaseUrl: apiBase(),
  deviceId: getOrCreateDeviceId(),
  credentialStorage: credentialStorageKind(),
}));

ipcMain.on('auth:start', () => authManager.startSignIn().catch((err) => log.error('startSignIn failed', err)));
ipcMain.on('auth:cancel', () => authManager.cancelSignIn());
ipcMain.on('auth:sign-out', () => authManager.signOut());
ipcMain.handle('auth:get-status', () => authManager.getStatus());

ipcMain.handle('api:request', (_event, request: unknown) => proxyApiRequest(request));

ipcMain.handle('tasks:list', () => taskManager.list());
ipcMain.on('task:cancel', (_event, id: unknown) => typeof id === 'string' && taskManager.cancel(id));
ipcMain.on('task:dismiss', (_event, id: unknown) => typeof id === 'string' && taskManager.dismiss(id));
ipcMain.on('tasks:clear', () => taskManager.clearFinished());

function taskHandler(channel: string, start: (value: unknown) => Task): void {
  ipcMain.handle(channel, (_event, value: unknown) => {
    try {
      requireSignedIn();
      return ok({ taskId: start(value).id });
    } catch (err) {
      log.warn(`${channel} rejected`, err);
      return fail(err);
    }
  });
}

taskHandler('convert:start', (value) => {
  if (!isRecord(value)) throw new Error('Invalid conversion request.');
  const urls = Array.isArray(value.urls) ? value.urls.map(parseSourceUrl) : [];
  const inputs = Array.isArray(value.inputs) ? value.inputs.map((item) => requireApprovedInput(item, ARCHIVE_OR_FOLDER)) : [];
  if (urls.length + inputs.length > 50) throw new Error('A pack can have at most 50 items.');
  return startConvert({ urls, inputs, ...parseConvertOptions(value) });
});

taskHandler('optimize:start', (value) => {
  if (!isRecord(value) || !OPTIMIZE_CATEGORIES.has(value.category as OptimizeCategory)) throw new Error('Pick what kind of resource this is.');
  const input = requireApprovedInput(value.inputPath, OPTIMIZE_INPUTS);
  if (input.inputKind === 'file' && value.category !== 'textures') throw new Error('A standalone .ytd can only be optimized as Textures.');
  return startOptimize(input, value.category as OptimizeCategory);
});

taskHandler('fix:start', (value) => startFix(requireApprovedInput(value, ARCHIVE_OR_FOLDER)));

taskHandler('map-inspect:start', (value) => {
  const input = requireApprovedInput(value, ZIP_ONLY);
  if (!/\.(zip|oiv)$/i.test(input.inputPath)) throw new Error('The map inspector needs a .zip archive.');
  return startMapInspect(input);
});

taskHandler('siren:start', (value) => {
  if (!isRecord(value)) throw new Error('Invalid siren request.');
  const input = requireApprovedInput(value.inputPath, ZIP_ONLY);
  if (!/\.zip$/i.test(input.inputPath)) throw new Error('Upload your audio bank files as a .zip.');
  const text = (key: string, max: number, required = true): string => {
    const raw = value[key];
    if (raw === undefined && !required) return '';
    if (typeof raw !== 'string' || (required && !raw.trim()) || raw.length > max) throw new Error(`Check the ${key} field.`);
    return raw.trim();
  };
  const tones = Array.isArray(value.tones) ? value.tones.filter((tone): tone is string => typeof tone === 'string' && tone.trim().length > 0).map((tone) => tone.trim()) : [];
  if (tones.length === 0 || tones.length > 64) throw new Error('Add between 1 and 64 siren tones.');
  return startSirenBuild(input, {
    inputPath: input.inputPath,
    resourceName: text('resourceName', 60),
    dlcName: text('dlcName', 60),
    soundsetName: text('soundsetName', 120),
    tones,
    gamedataPath: text('gamedataPath', 255, false),
    sounddataPath: text('sounddataPath', 255, false),
    wavepackPath: text('wavepackPath', 255, false),
  });
});

taskHandler('catalog:download', (value) => {
  if (!isRecord(value) || (value.kind !== 'vehicle' && value.kind !== 'animation') || typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value.id)) {
    throw new Error('Invalid catalog item.');
  }
  return downloadCatalogItem({ kind: value.kind, id: value.id, title: typeof value.title === 'string' ? value.title.slice(0, 200) : 'Catalog item' });
});

function jobIdFrom(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) throw new Error('Invalid job.');
  return value;
}

ipcMain.handle('job:download', (_event, jobId: unknown, title: unknown) => {
  try {
    requireSignedIn();
    return ok({ taskId: downloadJob(jobIdFrom(jobId), typeof title === 'string' ? title : null).id });
  } catch (err) {
    return fail(err);
  }
});

ipcMain.handle('job:track', (_event, jobId: unknown, title: unknown) => {
  try {
    requireSignedIn();
    const id = jobIdFrom(jobId);
    const existing = taskManager.list().find((task) => task.jobId === id && !['done', 'failed', 'cancelled'].includes(task.phase));
    if (existing) return ok({ taskId: existing.id });
    return ok({ taskId: trackJob(id, typeof title === 'string' ? title : null).id });
  } catch (err) {
    return fail(err);
  }
});

ipcMain.handle('deploy:output', (_event, filePath: unknown) => {
  try {
    if (typeof filePath !== 'string' || !isKnownOutput(filePath) || !fs.existsSync(filePath)) throw new Error('That output file is no longer available.');
    return ok({ taskId: deployExisting(filePath).id });
  } catch (err) {
    return fail(err);
  }
});

ipcMain.handle('files:pick', (_event, mode: unknown, multiple: unknown) => {
  if (!['archives', 'folder', 'zip', 'image', 'text'].includes(String(mode))) return [];
  return pickInputs(mainWindow, mode as PickerMode, multiple === true);
});
ipcMain.handle('files:approve-dropped', (_event, paths: unknown): SelectedInput[] => approveDropped(paths));
ipcMain.handle('files:read-text', (_event, inputPath: unknown) => {
  try {
    return readApprovedText(inputPath);
  } catch {
    return null;
  }
});

ipcMain.handle('settings:choose-folder', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
});

const MAX_PREVIEW_BYTES = 120 * 1024 * 1024;

ipcMain.handle('preview:fetch', async (_event, source: unknown): Promise<ApiResult<ArrayBuffer>> => {
  try {
    if (!isRecord(source) || (source.kind !== 'job' && source.kind !== 'vehicle')) throw new Error('Invalid preview.');
    const id = jobIdFrom(source.id);
    const res =
      source.kind === 'job'
        ? await desktopFetch(`/api/jobs/${id}/preview`)
        : await fetch(absoluteApiUrl(`/api/vehicles/${id}/preview`)).then(async (response) => {
            if (!response.ok) throw new ApiError('No 3D preview is available for this vehicle.', response.status);
            return response;
          });
    const length = Number(res.headers.get('content-length'));
    if (Number.isFinite(length) && length > MAX_PREVIEW_BYTES) throw new Error('This 3D preview is too large to show here.');
    const buffer = await res.arrayBuffer();
    if (buffer.byteLength > MAX_PREVIEW_BYTES) throw new Error('This 3D preview is too large to show here.');
    return ok(buffer);
  } catch (err) {
    return fail(err);
  }
});

const SCREENSHOT_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

ipcMain.handle('screenshot:submit', async (_event, jobId: unknown) => {
  try {
    requireSignedIn();
    const id = jobIdFrom(jobId);
    const [picked] = await pickInputs(mainWindow, 'image', false);
    if (!picked) return ok({ submitted: false });
    const type = SCREENSHOT_TYPES[path.extname(picked.inputPath).toLowerCase()];
    if (!type) throw new Error('Pick a PNG, JPEG, or WebP image.');
    if ((picked.sizeBytes ?? 0) > 8 * 1024 * 1024) throw new Error('Screenshots can be at most 8 MB.');
    const form = new FormData();
    form.set('image', new Blob([fs.readFileSync(picked.inputPath)], { type }), picked.name);
    await desktopFetch(`/api/jobs/${id}/screenshot`, { method: 'POST', body: form });
    return ok({ submitted: true });
  } catch (err) {
    return fail(err);
  }
});

ipcMain.on('shell:show-in-folder', (_event, value: unknown) => {
  if (typeof value === 'string' && isKnownOutput(value) && fs.existsSync(value)) shell.showItemInFolder(value);
});
ipcMain.on('shell:open-output', () => void shell.openPath(outputFolder()));
ipcMain.on('shell:open-external', (_event, value: unknown) => openExternal(value));

function currentSettings(): DesktopSettings {
  return {
    outputFolder: config.get('outputFolder') || defaultOutputFolder(),
    deployMode: config.get('deployMode'),
    localDeployFolder: config.get('localDeployFolder'),
    sftpHost: config.get('sftpHost'),
    sftpPort: config.get('sftpPort'),
    sftpUsername: config.get('sftpUsername'),
    sftpRemotePath: config.get('sftpRemotePath'),
    hasSftpPassword: loadSftpPassword() !== null,
    autoDownload: config.get('autoDownload'),
    notifyOnComplete: config.get('notifyOnComplete'),
    revealOnComplete: config.get('revealOnComplete'),
    acceptDashboardCommands: config.get('acceptDashboardCommands'),
    defaultTarget: config.get('defaultTarget'),
    launchMinimized: config.get('launchMinimized'),
    onboarded: config.get('onboarded'),
  };
}

function nullableString(value: unknown, fallback: string | null, max = 4096): string | null {
  if (value === undefined) return fallback;
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > max) throw new Error('A settings value was invalid.');
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function nullableAbsolutePath(value: unknown, fallback: string | null, label: string): string | null {
  const normalized = nullableString(value, fallback, 32_000);
  if (normalized !== null && !path.isAbsolute(normalized)) throw new Error(`${label} must be a full folder path.`);
  return normalized;
}

function booleanSetting(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new Error('A settings toggle was invalid.');
  return value;
}

ipcMain.handle('settings:get', (): DesktopSettings => currentSettings());

ipcMain.handle('settings:save', (_event, value: unknown): ApiResult<DesktopSettings> => {
  try {
    if (!isRecord(value)) throw new Error('Invalid settings.');
    const previous = currentSettings();
    const deployMode = value.deployMode ?? previous.deployMode;
    if (!['none', 'local', 'sftp'].includes(String(deployMode))) throw new Error('Invalid deploy mode.');
    const port = value.sftpPort ?? previous.sftpPort;
    if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('SFTP port must be a whole number from 1 to 65535.');
    const defaultTarget = value.defaultTarget ?? previous.defaultTarget;
    if (defaultTarget !== 'addon' && defaultTarget !== 'replace') throw new Error('Invalid default target.');

    const folder = nullableAbsolutePath(value.outputFolder, previous.outputFolder, 'Output folder') || defaultOutputFolder();
    const updates = {
      outputFolder: folder,
      deployMode: deployMode as DesktopSettings['deployMode'],
      localDeployFolder: nullableAbsolutePath(value.localDeployFolder, previous.localDeployFolder, 'Local resources folder'),
      sftpHost: nullableString(value.sftpHost, previous.sftpHost, 255),
      sftpPort: port,
      sftpUsername: nullableString(value.sftpUsername, previous.sftpUsername, 255),
      sftpRemotePath: nullableString(value.sftpRemotePath, previous.sftpRemotePath, 1024),
      autoDownload: booleanSetting(value.autoDownload, previous.autoDownload),
      notifyOnComplete: booleanSetting(value.notifyOnComplete, previous.notifyOnComplete),
      revealOnComplete: booleanSetting(value.revealOnComplete, previous.revealOnComplete),
      acceptDashboardCommands: booleanSetting(value.acceptDashboardCommands, previous.acceptDashboardCommands),
      defaultTarget: defaultTarget as ConversionTarget,
      launchMinimized: booleanSetting(value.launchMinimized, previous.launchMinimized),
      onboarded: booleanSetting(value.onboarded, previous.onboarded),
    };

    if (value.sftpPassword !== undefined) {
      if (typeof value.sftpPassword !== 'string' || value.sftpPassword.length > 4096) throw new Error('Invalid SFTP password.');
      if (value.sftpPassword.length === 0) clearSftpPassword();
      else saveSftpPassword(value.sftpPassword);
    }
    fs.mkdirSync(folder, { recursive: true });
    config.set(updates);
    return ok(currentSettings());
  } catch (err) {
    log.warn('settings:save rejected', err);
    return fail(err);
  }
});

ipcMain.handle('sftp:test', async () => {
  try {
    return ok(await testConfiguredSftp());
  } catch (err) {
    return fail(err);
  }
});

ipcMain.handle('sftp:forget-host-key', () => {
  const host = config.get('sftpHost');
  if (host) clearPinnedFingerprint(host, config.get('sftpPort'));
});

ipcMain.handle('update:get', () => getUpdateState());
ipcMain.on('update:check', () => checkForUpdates());
ipcMain.on('update:install', () => installUpdate());

