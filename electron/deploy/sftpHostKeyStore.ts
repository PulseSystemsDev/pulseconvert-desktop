import { app } from 'electron';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

interface PinnedHostKeys {
  [hostPortKey: string]: string;
}

function storeFilePath(): string {
  return path.join(app.getPath('userData'), 'sftp-known-hosts.json');
}

function hostPortKey(host: string, port: number): string {
  return `${host}:${port}`;
}

function readStore(): PinnedHostKeys {
  const file = storeFilePath();
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return {};
  }
}

function writeStore(store: PinnedHostKeys): void {
  fs.writeFileSync(storeFilePath(), JSON.stringify(store, null, 2));
}

export function fingerprintOf(hostKey: Buffer): string {
  return `SHA256:${createHash('sha256').update(hostKey).digest('base64').replace(/=+$/, '')}`;
}

export function getPinnedFingerprint(host: string, port: number): string | null {
  return readStore()[hostPortKey(host, port)] ?? null;
}

export function pinFingerprint(host: string, port: number, fingerprint: string): void {
  const store = readStore();
  store[hostPortKey(host, port)] = fingerprint;
  writeStore(store);
}

export function clearPinnedFingerprint(host: string, port: number): void {
  const store = readStore();
  delete store[hostPortKey(host, port)];
  writeStore(store);
}
