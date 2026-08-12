import { contextBridge, ipcRenderer } from 'electron';
import type { AuthStatus, ConvertOutcome, DeploySettings } from './types';

contextBridge.exposeInMainWorld('pulseConvertDesktop', {
  platform: process.platform,
  version: process.env.npm_package_version ?? '0.1.0',
  isDesktop: true,

  startSignIn: () => {
    ipcRenderer.send('auth:start');
  },
  cancelSignIn: () => {
    ipcRenderer.send('auth:cancel');
  },
  signOut: () => {
    ipcRenderer.send('auth:sign-out');
  },
  getAuthStatus: (): Promise<AuthStatus> => {
    return ipcRenderer.invoke('auth:get-status');
  },
  onAuthStatusChange: (cb: (status: AuthStatus) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, status: AuthStatus) => cb(status);
    ipcRenderer.on('auth:status-changed', handler);
    return () => ipcRenderer.removeListener('auth:status-changed', handler);
  },
  openExternal: (url: string) => {
    ipcRenderer.send('shell:open-external', url);
  },
  startConvert: (url: string): Promise<ConvertOutcome> => {
    return ipcRenderer.invoke('convert:start', url);
  },
  onConvertProgress: (cb: (label: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, label: string) => cb(label);
    ipcRenderer.on('convert:progress', handler);
    return () => ipcRenderer.removeListener('convert:progress', handler);
  },
  showInFolder: (filePath: string) => {
    ipcRenderer.send('shell:show-in-folder', filePath);
  },
  getSettings: (): Promise<DeploySettings> => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: DeploySettings & { sftpPassword?: string }) => ipcRenderer.invoke('settings:save', settings),
  chooseFolder: (): Promise<string | null> => ipcRenderer.invoke('settings:choose-folder'),
});
