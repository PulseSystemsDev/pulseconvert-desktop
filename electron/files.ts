import { app, BrowserWindow, dialog } from 'electron';
import fs from 'fs';
import path from 'path';
import config from './configStore';
import type { InputKind, PickerMode, SelectedInput } from './types';

export const ARCHIVE_EXTENSIONS = new Set(['.zip', '.rar', '.7z', '.oiv', '.rpf']);
const STANDALONE_EXTENSIONS = new Set(['.ytd']);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const TEXT_EXTENSIONS = new Set(['.txt']);
export const MAX_INPUT_BYTES = 4 * 1024 * 1024 * 1024;

const approvedInputs = new Set<string>();
const knownOutputs = new Set<string>();

export function pathKey(filePath: string): string {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function defaultOutputFolder(): string {
  return path.join(app.getPath('documents'), 'PulseConvert');
}

export function outputFolder(): string {
  const folder = config.get('outputFolder') || defaultOutputFolder();
  fs.mkdirSync(folder, { recursive: true });
  return folder;
}

export function registerOutput(filePath: string): void {
  knownOutputs.add(pathKey(filePath));
}

export function isKnownOutput(filePath: string): boolean {
  return path.isAbsolute(filePath) && knownOutputs.has(pathKey(filePath));
}

function describe(inputPath: string): SelectedInput | null {
  let real: string;
  try {
    real = fs.realpathSync(inputPath);
  } catch {
    return null;
  }
  const stat = fs.statSync(real);
  const extension = path.extname(real).toLowerCase();
  let inputKind: InputKind;
  if (stat.isDirectory()) inputKind = 'folder';
  else if (ARCHIVE_EXTENSIONS.has(extension)) inputKind = 'archive';
  else if (STANDALONE_EXTENSIONS.has(extension) || IMAGE_EXTENSIONS.has(extension) || TEXT_EXTENSIONS.has(extension)) inputKind = 'file';
  else return null;
  if (stat.isFile() && stat.size > MAX_INPUT_BYTES) return null;
  approvedInputs.add(pathKey(real));
  return { inputPath: real, inputKind, name: path.basename(real), sizeBytes: stat.isFile() ? stat.size : null };
}

/** Every local path the renderer hands back must have come from a native picker or a real
 *  drag-and-drop, so a compromised renderer can't upload arbitrary files off the disk. */
export function requireApprovedInput(inputPath: unknown, allowed: ReadonlySet<InputKind>): SelectedInput {
  if (typeof inputPath !== 'string' || !path.isAbsolute(inputPath)) throw new Error('Choose a file through Pulse Convert first.');
  let real: string;
  try {
    real = fs.realpathSync(inputPath);
  } catch {
    throw new Error('That file no longer exists.');
  }
  if (!approvedInputs.has(pathKey(real))) throw new Error('Choose this file through Pulse Convert first.');
  const selected = describe(real);
  if (!selected) throw new Error('That file type is not supported here.');
  if (!allowed.has(selected.inputKind)) throw new Error('That kind of input is not supported here.');
  return selected;
}

const FILTERS: Record<PickerMode, Electron.FileFilter[]> = {
  archives: [{ name: 'GTA V mod archives', extensions: ['zip', 'rar', '7z', 'oiv', 'rpf', 'ytd'] }],
  folder: [],
  zip: [{ name: 'ZIP archive', extensions: ['zip'] }],
  image: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
  text: [{ name: 'Text file', extensions: ['txt'] }],
};

export async function pickInputs(window: BrowserWindow | null, mode: PickerMode, multiple: boolean): Promise<SelectedInput[]> {
  if (!window) return [];
  const properties: Array<'openFile' | 'openDirectory' | 'multiSelections'> = [mode === 'folder' ? 'openDirectory' : 'openFile'];
  if (multiple) properties.push('multiSelections');
  const result = await dialog.showOpenDialog(window, { properties, filters: FILTERS[mode] });
  if (result.canceled) return [];
  return result.filePaths.map(describe).filter((item): item is SelectedInput => item !== null);
}

export function approveDropped(paths: unknown): SelectedInput[] {
  if (!Array.isArray(paths)) return [];
  return paths
    .filter((item): item is string => typeof item === 'string' && path.isAbsolute(item))
    .slice(0, 100)
    .map(describe)
    .filter((item): item is SelectedInput => item !== null);
}

export function readApprovedText(inputPath: unknown): string | null {
  const selected = requireApprovedInput(inputPath, new Set<InputKind>(['file']));
  if (path.extname(selected.inputPath).toLowerCase() !== '.txt' || (selected.sizeBytes ?? 0) > 1024 * 1024) return null;
  return fs.readFileSync(selected.inputPath, 'utf8');
}

export function safeStem(value: string, fallback: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/\.(zip|rar|7z|oiv|rpf|ytd)$/i, '')
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned.slice(0, 60) || fallback;
}

export function uniqueOutputPath(stem: string, extension = '.zip'): string {
  const folder = outputFolder();
  let candidate = path.join(folder, `${stem}${extension}`);
  let suffix = 2;
  while (fs.existsSync(candidate)) candidate = path.join(folder, `${stem} (${suffix++})${extension}`);
  return candidate;
}
