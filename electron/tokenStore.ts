import { app, safeStorage } from 'electron';
import fs from 'fs';
import path from 'path';
import log from 'electron-log';
import type { TokenSet } from './types';

function tokenFilePath(): string {
  return path.join(app.getPath('userData'), 'tokens.enc');
}

export function saveTokens(tokens: TokenSet): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS-level credential encryption is not available on this machine - cannot securely store a sign-in token here.');
  }
  const encrypted = safeStorage.encryptString(JSON.stringify(tokens));
  fs.writeFileSync(tokenFilePath(), encrypted);
}

export function loadTokens(): TokenSet | null {
  const file = tokenFilePath();
  if (!fs.existsSync(file)) return null;
  if (!safeStorage.isEncryptionAvailable()) {
    log.warn('tokenStore: OS-level encryption unavailable - ignoring any stored token file.');
    return null;
  }
  try {
    const encrypted = fs.readFileSync(file);
    const decrypted = safeStorage.decryptString(encrypted);
    return JSON.parse(decrypted) as TokenSet;
  } catch (err) {
    log.warn('tokenStore: failed to decrypt stored tokens, treating as signed out', err);
    return null;
  }
}

export function clearTokens(): void {
  const file = tokenFilePath();
  if (fs.existsSync(file)) fs.unlinkSync(file);
}
