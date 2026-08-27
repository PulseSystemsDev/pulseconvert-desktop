import { app, BrowserWindow } from 'electron';
import log from 'electron-log';
import { autoUpdater } from 'electron-updater';

export function setupUpdater(getMainWindow: () => BrowserWindow | null): void {
  if (!app.isPackaged) {
    log.info('[Updater] Skipping auto-update in development');
    return;
  }

  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    log.info('[Updater] Checking for update...');
  });

  autoUpdater.on('update-available', (info: { version: string }) => {
    log.info('[Updater] Update available:', info.version);
    getMainWindow()?.webContents.send('update:available', info.version);
  });

  autoUpdater.on('update-not-available', () => {
    log.info('[Updater] App is up to date');
  });

  autoUpdater.on('download-progress', (progress: { percent: number }) => {
    log.info(`[Updater] Download progress: ${Math.round(progress.percent)}%`);
    getMainWindow()?.webContents.send('update:progress', Math.round(progress.percent));
  });

  autoUpdater.on('update-downloaded', (info: { version: string }) => {
    log.info('[Updater] Update downloaded, will install on quit:', info.version);
    getMainWindow()?.webContents.send('update:ready', info.version);
  });

  autoUpdater.on('error', (err: Error) => {
    log.error('[Updater] Error:', err);
  });

  setTimeout(() => {
    autoUpdater.checkForUpdatesAndNotify().catch((err: Error) => log.warn('[Updater]', err));
  }, 5000);

  setInterval(() => {
    autoUpdater.checkForUpdatesAndNotify().catch((err: Error) => log.warn('[Updater]', err));
  }, 4 * 60 * 60 * 1000);
}
