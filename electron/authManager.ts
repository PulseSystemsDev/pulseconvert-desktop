import log from 'electron-log';
import { accountsIssuer, clientId } from './configStore';
import { loadTokens, saveTokens, clearTokens } from './tokenStore';
import { startDeviceAuthorization, pollDeviceToken, DeviceAuthError } from './deviceAuth';
import { ApiError, getValidAccessToken } from './apiClient';
import type { AuthStatus, TokenSet } from './types';

function unsafeDecodeJwtPayload(jwt: string): Record<string, unknown> | null {
  try {
    const [, payload] = jwt.split('.');
    if (!payload) return null;
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

const REFRESH_SKEW_MS = 60_000;

export class AuthManager {
  private status: AuthStatus = { state: 'signed-out' };
  private listeners = new Set<(status: AuthStatus) => void>();
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private signInGeneration = 0;

  async initialize(): Promise<void> {
    const stored = loadTokens();
    if (stored) {
      this.setStatus({ state: 'signed-in', discordId: this.discordIdFromToken(stored.accessToken) });
      this.scheduleRefresh(stored);
    }
  }

  getStatus(): AuthStatus {
    return this.status;
  }

  onStatusChange(cb: (status: AuthStatus) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private setStatus(status: AuthStatus): void {
    this.status = status;
    for (const cb of this.listeners) cb(status);
  }

  private discordIdFromToken(accessToken: string): string | null {
    const payload = unsafeDecodeJwtPayload(accessToken);
    return typeof payload?.sub === 'string' ? payload.sub : null;
  }

  async startSignIn(): Promise<void> {
    this.clearTimers();
    const generation = ++this.signInGeneration;
    this.setStatus({ state: 'starting' });

    let authorization;
    try {
      authorization = await startDeviceAuthorization(accountsIssuer(), clientId());
    } catch (err) {
      if (generation !== this.signInGeneration) return;
      this.setStatus({ state: 'error', message: (err as Error).message });
      return;
    }
    if (generation !== this.signInGeneration) return;

    this.setStatus({
      state: 'awaiting-approval',
      userCode: authorization.userCode,
      verificationUri: authorization.verificationUri,
      verificationUriComplete: authorization.verificationUriComplete,
      expiresAt: authorization.expiresAt,
    });

    this.pollForToken(generation, authorization.deviceCode, authorization.intervalSeconds, authorization.expiresAt);
  }

  private pollForToken(generation: number, deviceCode: string, intervalSeconds: number, expiresAt: number): void {
    const tick = async () => {
      if (generation !== this.signInGeneration) return;
      if (Date.now() >= expiresAt) {
        this.setStatus({ state: 'expired' });
        return;
      }

      let result;
      try {
        result = await pollDeviceToken(accountsIssuer(), clientId(), deviceCode);
      } catch (err) {
        if (generation !== this.signInGeneration) return;
        if (err instanceof DeviceAuthError && err.code === 'access_denied') {
          this.setStatus({ state: 'denied' });
          return;
        }
        if (err instanceof DeviceAuthError && err.code === 'expired_token') {
          this.setStatus({ state: 'expired' });
          return;
        }
        this.setStatus({ state: 'error', message: (err as Error).message });
        return;
      }
      if (generation !== this.signInGeneration) return;

      if ('pending' in result) {
        this.pollTimer = setTimeout(tick, intervalSeconds * 1000);
        return;
      }
      if ('slowDown' in result) {
        intervalSeconds += 5;
        this.pollTimer = setTimeout(tick, intervalSeconds * 1000);
        return;
      }

      const tokens: TokenSet = {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        accessTokenExpiresAt: Date.now() + result.expiresIn * 1000,
        scope: result.scope,
      };
      try {
        saveTokens(tokens);
      } catch (err) {
        this.setStatus({ state: 'error', message: (err as Error).message });
        return;
      }
      this.setStatus({ state: 'signed-in', discordId: this.discordIdFromToken(tokens.accessToken) });
      this.scheduleRefresh(tokens);
    };

    this.pollTimer = setTimeout(tick, intervalSeconds * 1000);
  }

  cancelSignIn(): void {
    this.signInGeneration++;
    this.clearTimers();
    this.setStatus({ state: 'signed-out' });
  }

  signOut(): void {
    this.signInGeneration++;
    this.clearTimers();
    clearTokens();
    this.setStatus({ state: 'signed-out' });
  }

  private scheduleRefresh(tokens: TokenSet): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    if (!tokens.refreshToken) return;

    const delay = Math.max(tokens.accessTokenExpiresAt - Date.now() - REFRESH_SKEW_MS, 5_000);
    this.refreshTimer = setTimeout(async () => {
      try {
        await getValidAccessToken();
        const nextTokens = loadTokens();
        if (!nextTokens) return;
        this.setStatus({ state: 'signed-in', discordId: this.discordIdFromToken(nextTokens.accessToken) });
        this.scheduleRefresh(nextTokens);
      } catch (err) {
        if (err instanceof DeviceAuthError || (err instanceof ApiError && err.status === 401)) {
          log.warn('authManager: refresh token rejected, signing out', err);
          clearTokens();
          this.setStatus({ state: 'signed-out' });
          return;
        }
        log.warn('authManager: refresh failed, retrying in 30s', err);
        this.refreshTimer = setTimeout(() => this.scheduleRefresh(loadTokens() ?? tokens), 30_000);
      }
    }, delay);
  }

  private clearTimers(): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.pollTimer = null;
    this.refreshTimer = null;
  }
}
