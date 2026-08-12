import { app, safeStorage } from 'electron';
import fs from 'fs';
import path from 'path';

/**
 * An SFTP password is exactly as sensitive as the OAuth refresh token tokenStore.ts protects -
 * same safeStorage (OS keychain/DPAPI) treatment, deliberately kept in its own file rather than
 * folded into configStore.ts's plain-JSON electron-store, which holds the non-secret parts of
 * the same deploy settings (host/port/username/remote path - see configStore.ts). Per the
 * project's Phase D design decision, this password is configured directly on this device and
 * never transmitted to or stored by PulseConvert's own servers - a dashboard-queued
 * "convert_and_deploy" command only ever carries a mod URL, never credentials.
 */

function credentialsFilePath(): string {
  return path.join(app.getPath('userData'), 'sftp-credentials.enc');
}

export function saveSftpPassword(password: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS-level credential encryption is not available on this machine - cannot securely store the SFTP password.');
  }
  fs.writeFileSync(credentialsFilePath(), safeStorage.encryptString(password));
}

export function loadSftpPassword(): string | null {
  const file = credentialsFilePath();
  if (!fs.existsSync(file)) return null;
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    return safeStorage.decryptString(fs.readFileSync(file));
  } catch {
    return null;
  }
}

export function clearSftpPassword(): void {
  const file = credentialsFilePath();
  if (fs.existsSync(file)) fs.unlinkSync(file);
}
