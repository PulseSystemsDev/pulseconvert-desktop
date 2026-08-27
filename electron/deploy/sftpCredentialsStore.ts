import { app, safeStorage } from 'electron';
import fs from 'fs';
import path from 'path';

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
