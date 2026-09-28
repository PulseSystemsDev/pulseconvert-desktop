import { app } from 'electron';
import log from 'electron-log';
import { autoUpdater } from 'electron-updater';
import type { UpdateState } from './types';

let state: UpdateState = { state: 'idle' };
const listeners = new Set<(state: UpdateState) => void>();

function setState(next: UpdateState): void {
  state = next;
  for (const listener of listeners) listener(state);
}

export function getUpdateState(): UpdateState {
  return state;
}

export function onUpdateState(listener: (state: UpdateState) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function updatesSupported(): string | null {
  if (!app.isPackaged) return 'Updates are only checked in installed builds.';
  // electron-updater can replace an AppImage or an NSIS install in place; a .deb is owned by the
  // system package manager, so those installs update through a new download instead.
  if (process.platform === 'linux' && !process.env.APPIMAGE) return 'This install is managed by your package manager. Download new versions from the website.';
  return null;
}

export function checkForUpdates(): void {
  const reason = updatesSupported();
  if (reason) {
    setState({ state: 'unsupported', reason });
    return;
  }
  autoUpdater.checkForUpdates().catch((err: Error) => {
    log.warn('[Updater]', err);
    setState({ state: 'error', message: err.message });
  });
}

export function installUpdate(): void {
  if (state.state === 'ready') autoUpdater.quitAndInstall();
}

export function setupUpdater(): void {
  const reason = updatesSupported();
  if (reason) {
    log.info(`[Updater] ${reason}`);
    setState({ state: 'unsupported', reason });
    return;
  }

  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  let pendingVersion: string | null = null;
  autoUpdater.on('checking-for-update', () => setState({ state: 'checking' }));
  autoUpdater.on('update-available', (info: { version: string }) => {
    pendingVersion = info.version;
    setState({ state: 'available', version: info.version });
  });
  autoUpdater.on('update-not-available', () => setState({ state: 'up-to-date' }));
  autoUpdater.on('download-progress', (progress: { percent: number }) =>
    setState({ state: 'downloading', version: pendingVersion, percent: Math.round(progress.percent) }),
  );
  autoUpdater.on('update-downloaded', (info: { version: string }) => setState({ state: 'ready', version: info.version }));
  autoUpdater.on('error', (err: Error) => {
    log.error('[Updater] Error:', err);
    setState({ state: 'error', message: err.message });
  });

  setTimeout(checkForUpdates, 5000);
  setInterval(checkForUpdates, 4 * 60 * 60 * 1000);
}
