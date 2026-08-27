import config from './configStore';
import { loadTokens, saveTokens } from './tokenStore';
import { refreshAccessToken } from './deviceAuth';
import type { TokenSet } from './types';

const REFRESH_SKEW_MS = 60_000;

async function getValidAccessToken(): Promise<string> {
  const tokens = loadTokens();
  if (!tokens) throw new Error('Not signed in.');

  if (Date.now() < tokens.accessTokenExpiresAt - REFRESH_SKEW_MS) {
    return tokens.accessToken;
  }
  if (!tokens.refreshToken) {
    throw new Error('Sign-in expired. Please sign in again.');
  }

  const refreshed = await refreshAccessToken(config.get('accountsIssuer'), config.get('clientId'), tokens.refreshToken);
  const next: TokenSet = {
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    accessTokenExpiresAt: Date.now() + refreshed.expiresIn * 1000,
    scope: refreshed.scope,
  };
  saveTokens(next);
  return next.accessToken;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function desktopFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getValidAccessToken();
  const url = path.startsWith('http') ? path : `${config.get('apiBaseUrl')}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError((body as { error?: string }).error ?? `Request failed (${res.status})`, res.status);
  }
  return res;
}

export async function desktopFetchJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await desktopFetch(path, init);
  return res.json() as Promise<T>;
}
