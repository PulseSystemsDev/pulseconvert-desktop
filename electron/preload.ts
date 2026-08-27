import { contextBridge, ipcRenderer } from 'electron';
import type {
  AuthStatus,
  CatalogListResponse,
  CatalogSearchRequest,
  ConvertOutcome,
  ConvertRequest,
  DesktopSettings,
  InputPickerKind,
  OperationProgress,
  OptimizeOutcome,
  OptimizeRequest,
  SaveDesktopSettings,
  SelectedInput,
} from './types';

contextBridge.exposeInMainWorld('pulseConvertDesktop', {
  platform: process.platform,
  version: process.env.npm_package_version ?? '0.1.0',
  isDesktop: true,

  startSignIn: () => ipcRenderer.send('auth:start'),
  cancelSignIn: () => ipcRenderer.send('auth:cancel'),
  signOut: () => ipcRenderer.send('auth:sign-out'),
  getAuthStatus: (): Promise<AuthStatus> => ipcRenderer.invoke('auth:get-status'),
  onAuthStatusChange: (cb: (status: AuthStatus) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, status: AuthStatus) => cb(status);
    ipcRenderer.on('auth:status-changed', handler);
    return () => ipcRenderer.removeListener('auth:status-changed', handler);
  },
  openExternal: (url: string) => ipcRenderer.send('shell:open-external', url),

  startConvert: (request: ConvertRequest | string): Promise<ConvertOutcome> => ipcRenderer.invoke('convert:start', request),
  startOptimize: (request: OptimizeRequest): Promise<OptimizeOutcome> => ipcRenderer.invoke('optimize:start', request),
  onConvertProgress: (cb: (progress: OperationProgress) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, progress: OperationProgress) => cb(progress);
    ipcRenderer.on('convert:progress', handler);
    return () => ipcRenderer.removeListener('convert:progress', handler);
  },

  showInFolder: (filePath: string) => ipcRenderer.send('shell:show-in-folder', filePath),
  getSettings: (): Promise<DesktopSettings> => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: SaveDesktopSettings) => ipcRenderer.invoke('settings:save', settings),
  chooseFolder: (): Promise<string | null> => ipcRenderer.invoke('settings:choose-folder'),
  chooseInput: (kind: InputPickerKind): Promise<SelectedInput | null> => ipcRenderer.invoke('input:choose', kind),
  searchCatalog: (request: CatalogSearchRequest): Promise<CatalogListResponse> => ipcRenderer.invoke('catalog:search', request),
});
