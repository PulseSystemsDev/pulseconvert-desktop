import { BrowserWindow, Notification, session, shell, type Session } from 'electron';
import fs from 'fs';
import path from 'path';
import log from 'electron-log';
import { postJson } from './apiClient';
import { apiBase } from './configStore';
import { outputFolder } from './files';

const PARTITION = 'persist:pulse-web-tools';
const windows = new Map<string, BrowserWindow>();
let prepared: Session | null = null;

function sameSite(url: string): boolean {
  try {
    return new URL(url).origin === new URL(apiBase()).origin;
  } catch {
    return false;
  }
}

function uniquePath(folder: string, name: string): string {
  const ext = path.extname(name);
  const stem = path.basename(name, ext) || 'download';
  let candidate = path.join(folder, `${stem}${ext}`);
  for (let n = 2; fs.existsSync(candidate); n++) candidate = path.join(folder, `${stem} (${n})${ext}`);
  return candidate;
}

/** One session for all site tool windows: downloads go to the output folder, and no permissions are granted. */
function toolSession(): Session {
  if (prepared) return prepared;
  const ses = session.fromPartition(PARTITION);
  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === 'clipboard-sanitized-write'));
  ses.on('will-download', (_event, item) => {
    const folder = outputFolder();
    fs.mkdirSync(folder, { recursive: true });
    const target = uniquePath(folder, path.basename(item.getFilename()));
    item.setSavePath(target);
    item.once('done', (_e, state) => {
      if (state !== 'completed') return;
      const note = new Notification({ title: 'Saved', body: `${path.basename(target)} is in your output folder.` });
      note.on('click', () => shell.showItemInFolder(target));
      note.show();
    });
  });
  prepared = ses;
  return ses;
}

/**
 * Opens a site page (a tool, Workspaces or the tool-access admin page) in its own window, signed in as the
 * desktop user through a single-use handoff link. The site checks tool access on every page and request.
 */
export async function openWebTool(pagePath: string, title: string): Promise<void> {
  const existing = windows.get(pagePath);
  if (existing && !existing.isDestroyed()) {
    existing.show();
    existing.focus();
    return;
  }
  const { url } = await postJson<{ url: string }>('/api/desktop/handoff', { path: pagePath });
  if (!sameSite(url)) throw new Error('The server returned a link to another site.');

  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: `${title} - Pulse Convert`,
    backgroundColor: '#111112',
    autoHideMenuBar: true,
    webPreferences: {
      session: toolSession(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  windows.set(pagePath, win);
  win.on('closed', () => windows.delete(pagePath));
  win.webContents.setWindowOpenHandler(({ url: next }) => {
    if (sameSite(next)) void win.loadURL(next);
    else if (/^https:\/\//i.test(next)) void shell.openExternal(next);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, next) => {
    if (sameSite(next)) return;
    event.preventDefault();
    if (/^https:\/\//i.test(next)) void shell.openExternal(next);
  });
  win.webContents.on('page-title-updated', (event) => event.preventDefault());
  await win.loadURL(url).catch((err) => log.warn('Web tool failed to load', err));
}
