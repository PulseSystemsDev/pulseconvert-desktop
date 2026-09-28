import { accountsIssuer, apiBase, clientId } from './configStore';
import { loadTokens, saveTokens } from './tokenStore';
import { refreshAccessToken } from './deviceAuth';
import type { TokenSet } from './types';

const REFRESH_SKEW_MS = 60_000;

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let refreshInFlight: Promise<TokenSet> | null = null;

async function refreshTokens(tokens: TokenSet): Promise<TokenSet> {
  if (!tokens.refreshToken) throw new ApiError('Your sign-in expired. Please sign in again.', 401);
  const refreshed = await refreshAccessToken(accountsIssuer(), clientId(), tokens.refreshToken);
  const next: TokenSet = {
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    accessTokenExpiresAt: Date.now() + refreshed.expiresIn * 1000,
    scope: refreshed.scope,
  };
  saveTokens(next);
  return next;
}

export async function getValidAccessToken(): Promise<string> {
  const tokens = loadTokens();
  if (!tokens) throw new ApiError('Not signed in.', 401);
  if (Date.now() < tokens.accessTokenExpiresAt - REFRESH_SKEW_MS) return tokens.accessToken;

  // Several requests can notice an expired token at once; share one refresh so a rotating
  // refresh token is never spent twice.
  refreshInFlight ??= refreshTokens(tokens).finally(() => {
    refreshInFlight = null;
  });
  return (await refreshInFlight).accessToken;
}

export function absoluteApiUrl(pathOrUrl: string): URL {
  return new URL(pathOrUrl, `${apiBase()}/`);
}

export function isOwnApiUrl(url: URL): boolean {
  return url.origin === new URL(apiBase()).origin;
}

async function errorFrom(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  const fallback = res.status === 429 ? 'Rate limit reached. Try again a little later.' : `Request failed (${res.status})`;
  return new ApiError(body.error ?? fallback, res.status);
}

export async function desktopFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getValidAccessToken();
  const res = await fetch(absoluteApiUrl(path), {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw await errorFrom(res);
  return res;
}

export async function desktopFetchJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await desktopFetch(path, init);
  return res.json() as Promise<T>;
}

export async function publicFetchJson<T>(path: string): Promise<T> {
  const res = await fetch(absoluteApiUrl(path));
  if (!res.ok) throw await errorFrom(res);
  return res.json() as Promise<T>;
}

export function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return desktopFetchJson<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
}
