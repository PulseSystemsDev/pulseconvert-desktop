import { deleteSecret, readSecret, writeSecret } from '../secureStore';

const CREDENTIAL_FILE = 'sftp-credentials.enc';

export function saveSftpPassword(password: string): void {
  writeSecret(CREDENTIAL_FILE, password);
}

export function loadSftpPassword(): string | null {
  return readSecret(CREDENTIAL_FILE);
}

export function clearSftpPassword(): void {
  deleteSecret(CREDENTIAL_FILE);
}
