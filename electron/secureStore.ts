import { app, safeStorage } from 'electron';
import fs from 'fs';
import path from 'path';
import log from 'electron-log';

const PLAINTEXT_MARKER = Buffer.from('PCPLAIN1\n');

function filePath(name: string): string {
  return path.join(app.getPath('userData'), name);
}

// Linux desktops without a running Secret Service (a bare window manager, some minimal distros)
// have no OS keychain for safeStorage to use. Refusing to store anything there meant sign-in
// could never persist on those machines, so on Linux only we fall back to a user-only (0600)
// file - the same protection level ~/.ssh keys and most Linux CLI tools rely on.
function canUseKeychain(): boolean {
  if (!safeStorage.isEncryptionAvailable()) return false;
  if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend?.() === 'basic_text') return false;
  return true;
}

export function credentialStorageKind(): 'os-keychain' | 'file' {
  return canUseKeychain() ? 'os-keychain' : 'file';
}

export function writeSecret(name: string, value: string): void {
  const target = filePath(name);
  if (canUseKeychain()) {
    fs.writeFileSync(target, safeStorage.encryptString(value), { mode: 0o600 });
    return;
  }
  if (process.platform !== 'linux') {
    throw new Error('OS-level credential encryption is not available on this machine, so the secret was not saved.');
  }
  log.warn(`secureStore: no OS keychain available, storing ${name} as a user-only file`);
  fs.writeFileSync(target, Buffer.concat([PLAINTEXT_MARKER, Buffer.from(value, 'utf8')]), { mode: 0o600 });
  fs.chmodSync(target, 0o600);
}

export function readSecret(name: string): string | null {
  const target = filePath(name);
  if (!fs.existsSync(target)) return null;
  try {
    const raw = fs.readFileSync(target);
    if (raw.subarray(0, PLAINTEXT_MARKER.length).equals(PLAINTEXT_MARKER)) {
      return raw.subarray(PLAINTEXT_MARKER.length).toString('utf8');
    }
    if (!safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.decryptString(raw);
  } catch (err) {
    log.warn(`secureStore: could not read ${name}`, err);
    return null;
  }
}

export function deleteSecret(name: string): void {
  fs.rmSync(filePath(name), { force: true });
}
