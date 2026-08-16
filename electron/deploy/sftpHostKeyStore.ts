import { app } from 'electron';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * Trust-on-first-use SFTP host key pinning - the same model every real SSH client uses
 * (~/.ssh/known_hosts): the first connection to a given host:port records the server's public
 * key fingerprint, and every later connection is compared against what was pinned. Previously
 * sftpDeploy.ts's client.connect() passed no hostVerifier/hostHash at all, so ssh2 accepted
 * whatever key any server presented on every single connection, including the first - deploy
 * credentials and file contents went over a channel whose server identity was never checked at
 * all, not just "not pinned yet" (see this app's own README, which understated the gap as
 * missing pinning rather than missing verification entirely).
 *
 * Not secret data - a fingerprint is meant to be compared, not hidden - so this is plain JSON in
 * userData, unlike sftpCredentialsStore.ts's safeStorage-encrypted password file.
 */

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

/** SHA256 fingerprint of a raw host public key, formatted like OpenSSH's own `ssh-keygen -l` output so it's recognizable/comparable against what a server operator would see independently. */
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

/** For a deliberate, user-initiated re-trust after a legitimate host key change (server reinstall/migration) - never called automatically. */
export function clearPinnedFingerprint(host: string, port: number): void {
  const store = readStore();
  delete store[hostPortKey(host, port)];
  writeStore(store);
}
