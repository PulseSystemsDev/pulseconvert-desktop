import log from 'electron-log';
import { deleteSecret, readSecret, writeSecret } from './secureStore';
import type { TokenSet } from './types';

const TOKEN_FILE = 'tokens.enc';

export function saveTokens(tokens: TokenSet): void {
  writeSecret(TOKEN_FILE, JSON.stringify(tokens));
}

export function loadTokens(): TokenSet | null {
  const raw = readSecret(TOKEN_FILE);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TokenSet;
  } catch (err) {
    log.warn('tokenStore: stored tokens were unreadable, treating as signed out', err);
    return null;
  }
}

export function clearTokens(): void {
  deleteSecret(TOKEN_FILE);
}
