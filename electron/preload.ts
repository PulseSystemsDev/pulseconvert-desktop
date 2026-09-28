import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { ApiRequest, AuthStatus, PulseConvertDesktopAPI, Task, UpdateState } from './types';

function subscribe<T>(channel: string, cb: (value: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, value: T) => cb(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

let apiBaseUrl = '';
void ipcRenderer.invoke('app:info').then((info: { apiBaseUrl: string }) => {
  apiBaseUrl = info.apiBaseUrl;
});

const bridge: PulseConvertDesktopAPI = {
  platform: process.platform,
  getAppInfo: () => ipcRenderer.invoke('app:info'),

  getAuthStatus: () => ipcRenderer.invoke('auth:get-status'),
  onAuthStatus: (cb) => subscribe<AuthStatus>('auth:status-changed', cb),
  startSignIn: () => ipcRenderer.send('auth:start'),
  cancelSignIn: () => ipcRenderer.send('auth:cancel'),
  signOut: () => ipcRenderer.send('auth:sign-out'),

  api: (request: ApiRequest) => ipcRenderer.invoke('api:request', request),
  resolveUrl: (value) => {
    if (!value) return null;
    if (/^https?:\/\//i.test(value)) return value;
    return apiBaseUrl ? `${apiBaseUrl}${value.startsWith('/') ? '' : '/'}${value}` : null;
  },

  getTasks: () => ipcRenderer.invoke('tasks:list'),
  onTasks: (cb) => subscribe<Task[]>('tasks:changed', cb),
  startConvert: (request) => ipcRenderer.invoke('convert:start', request),
  startOptimize: (request) => ipcRenderer.invoke('optimize:start', request),
  startFix: (inputPath) => ipcRenderer.invoke('fix:start', inputPath),
  startSirenBuild: (request) => ipcRenderer.invoke('siren:start', request),
  startMapInspect: (inputPath) => ipcRenderer.invoke('map-inspect:start', inputPath),
  downloadCatalogItem: (request) => ipcRenderer.invoke('catalog:download', request),
  downloadJob: (jobId, title) => ipcRenderer.invoke('job:download', jobId, title),
  trackJob: (jobId, title) => ipcRenderer.invoke('job:track', jobId, title),
  deployOutput: (filePath) => ipcRenderer.invoke('deploy:output', filePath),
  cancelTask: (taskId) => ipcRenderer.send('task:cancel', taskId),
  dismissTask: (taskId) => ipcRenderer.send('task:dismiss', taskId),
  clearFinishedTasks: () => ipcRenderer.send('tasks:clear'),

  pickInputs: (mode, multiple) => ipcRenderer.invoke('files:pick', mode, multiple),
  // webUtils only resolves a path for a File that came from a real drag-and-drop or file input,
  // so the renderer can't invent paths here - the main process still re-checks every one.
  approveDroppedFiles: (files) => {
    const paths = files.map((file) => {
      try {
        return webUtils.getPathForFile(file);
      } catch {
        return '';
      }
    });
    return ipcRenderer.invoke('files:approve-dropped', paths.filter(Boolean));
  },
  readTextFile: (inputPath) => ipcRenderer.invoke('files:read-text', inputPath),
  chooseFolder: () => ipcRenderer.invoke('settings:choose-folder'),

  fetchPreview: (source) => ipcRenderer.invoke('preview:fetch', source),
  submitScreenshot: (jobId) => ipcRenderer.invoke('screenshot:submit', jobId),

  showInFolder: (filePath) => ipcRenderer.send('shell:show-in-folder', filePath),
  openOutputFolder: () => ipcRenderer.send('shell:open-output'),
  openExternal: (url) => ipcRenderer.send('shell:open-external', url),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
  testSftp: () => ipcRenderer.invoke('sftp:test'),
  forgetSftpHostKey: () => ipcRenderer.invoke('sftp:forget-host-key'),

  getUpdateState: () => ipcRenderer.invoke('update:get'),
  onUpdateState: (cb) => subscribe<UpdateState>('update:state', cb),
  checkForUpdates: () => ipcRenderer.send('update:check'),
  installUpdate: () => ipcRenderer.send('update:install'),

  onNavigate: (cb) => subscribe<string>('navigate', cb),
};

contextBridge.exposeInMainWorld('pulseConvertDesktop', bridge);
