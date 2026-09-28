import { app } from 'electron';
import log from 'electron-log';
import { autoUpdater } from 'electron-updater';
import type { UpdateState } from './types';

let state: UpdateState = { state: 'idle' };
let installRequested = false;
let pending: { version: string; notes: string | null } | null = null;
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

function plainNotes(notes: unknown): string | null {
  const raw = Array.isArray(notes)
    ? notes.map((entry) => (entry && typeof entry === 'object' && 'note' in entry ? String((entry as { note: unknown }).note ?? '') : '')).join('\n')
    : typeof notes === 'string'
      ? notes
      : '';
  const text = raw
    .replace(/<\/(p|li|h\d|div)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text ? text.slice(0, 4000) : null;
}

function fakeUpdateVersion(): string | null {
  return !app.isPackaged && process.env.PULSECONVERT_FAKE_UPDATE ? process.env.PULSECONVERT_FAKE_UPDATE : null;
}

function updatesSupported(): string | null {
  if (fakeUpdateVersion()) return null;
  if (!app.isPackaged) return 'Updates are only checked in installed builds.';
  if (process.platform === 'linux' && !process.env.APPIMAGE) return 'This install is managed by your package manager. Download new versions from the website.';
  return null;
}

function runFakeUpdate(version: string): void {
  pending = { version, notes: '- New first-run setup\n- Charts on Live stats\n- Faster catalog search\n- Fixed a crash when WebGL is unavailable' };
  setState({ state: 'available', ...pending, installRequested });
  let percent = 0;
  const timer = setInterval(() => {
    percent += 10;
    if (percent < 100) {
      setState({ state: 'downloading', ...pending!, percent, installRequested });
      return;
    }
    clearInterval(timer);
    setState({ state: 'ready', ...pending! });
    if (installRequested) log.info('[Updater] (fake) would restart and install now');
  }, 1500);
}

export function checkForUpdates(): void {
  const reason = updatesSupported();
  if (reason) {
    setState({ state: 'unsupported', reason });
    return;
  }
  if (state.state === 'downloading' || state.state === 'ready') return;
  if (fakeUpdateVersion()) {
    runFakeUpdate(fakeUpdateVersion()!);
    return;
  }
  autoUpdater.checkForUpdates().catch((err: Error) => {
    log.warn('[Updater]', err);
    setState({ state: 'error', message: err.message });
  });
}

export function installUpdate(): void {
  installRequested = true;
  if (state.state === 'ready') {
    if (fakeUpdateVersion()) {
      log.info('[Updater] (fake) would restart and install now');
      return;
    }
    autoUpdater.quitAndInstall(false, true);
    return;
  }
  if (state.state === 'available' || state.state === 'downloading') setState({ ...state, installRequested: true });
}

export function setupUpdater(): void {
  const reason = updatesSupported();
  if (reason) {
    log.info(`[Updater] ${reason}`);
    setState({ state: 'unsupported', reason });
    return;
  }
  if (fakeUpdateVersion()) {
    setTimeout(checkForUpdates, 2500);
    return;
  }

  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  // Deliberately off: the user chooses when to install via the update prompt.
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('checking-for-update', () => {
    if (state.state !== 'downloading' && state.state !== 'ready') setState({ state: 'checking' });
  });
  autoUpdater.on('update-available', (info: { version: string; releaseNotes?: unknown }) => {
    pending = { version: info.version, notes: plainNotes(info.releaseNotes) };
    setState({ state: 'available', ...pending, installRequested });
  });
  autoUpdater.on('update-not-available', () => setState({ state: 'up-to-date' }));
  autoUpdater.on('download-progress', (progress: { percent: number }) => {
    if (!pending) return;
    setState({ state: 'downloading', ...pending, percent: Math.round(progress.percent), installRequested });
  });
  autoUpdater.on('update-downloaded', (info: { version: string; releaseNotes?: unknown }) => {
    pending = { version: info.version, notes: plainNotes(info.releaseNotes) ?? pending?.notes ?? null };
    setState({ state: 'ready', ...pending });
    if (installRequested) autoUpdater.quitAndInstall(false, true);
  });
  autoUpdater.on('error', (err: Error) => {
    log.error('[Updater] Error:', err);
    setState({ state: 'error', message: err.message });
  });

  setTimeout(checkForUpdates, 5000);
  setInterval(checkForUpdates, 4 * 60 * 60 * 1000);
}
