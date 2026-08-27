import log from 'electron-log';
import config from './configStore';
import { loadTokens, saveTokens, clearTokens } from './tokenStore';
import { startDeviceAuthorization, pollDeviceToken, refreshAccessToken, DeviceAuthError } from './deviceAuth';
import type { AuthStatus, TokenSet } from './types';

/** Decodes a JWT's payload without verifying its signature - safe here because it's used only to
 *  populate the UI (e.g. "signed in") and nothing security-relevant. The server verifies every
 *  token independently on every API call (pulseconvert's apiAuth.ts) - this app never trusts its
 *  own read of the token for anything but display. */
function unsafeDecodeJwtPayload(jwt: string): Record<string, unknown> | null {
  try {
    const [, payload] = jwt.split('.');
    if (!payload) return null;
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

const REFRESH_SKEW_MS = 60_000; // refresh 60s before actual expiry, not exactly at it

export class AuthManager {
  private status: AuthStatus = { state: 'signed-out' };
  private listeners = new Set<(status: AuthStatus) => void>();
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private signInGeneration = 0;

  /** Deliberately does no I/O here - `loadTokens()` calls `safeStorage.isEncryptionAvailable()`,
   *  which Electron only guarantees to answer correctly after the `app` module's `ready` event has
   *  fired. This class is constructed at module top-level (main.ts), well before that, so any
   *  stored-token read has to happen in `initialize()` instead, awaited from inside
   *  `app.whenReady()`. Until that resolves, status stays the default `signed-out` - safe, since
   *  nothing can query it before then anyway. */
  constructor() {}

  /** Call once, after `app.whenReady()` resolves, before creating the renderer window. Reads any
   *  persisted tokens and moves to `signed-in` via `setStatus()` (not a raw field assignment) so
   *  the `onStatusChange` listener already registered in main.ts - which starts the command
   *  listener and forwards the status to the renderer - fires normally on a restored session. */
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
      authorization = await startDeviceAuthorization(config.get('accountsIssuer'), config.get('clientId'));
    } catch (err) {
      if (generation !== this.signInGeneration) return; // superseded by a newer sign-in/cancel
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
        result = await pollDeviceToken(config.get('accountsIssuer'), config.get('clientId'), deviceCode);
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
    this.signInGeneration++; // invalidates any in-flight request/poll from the cancelled attempt
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
        const refreshed = await refreshAccessToken(config.get('accountsIssuer'), config.get('clientId'), tokens.refreshToken!);
        const nextTokens: TokenSet = {
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
          accessTokenExpiresAt: Date.now() + refreshed.expiresIn * 1000,
          scope: refreshed.scope,
        };
        saveTokens(nextTokens);
        this.setStatus({ state: 'signed-in', discordId: this.discordIdFromToken(nextTokens.accessToken) });
        this.scheduleRefresh(nextTokens);
      } catch (err) {
        // A dead/revoked refresh token is a real, expected outcome (session revoked from the
        // dashboard, 30-day TTL lapsed while the app was closed) - fail back to signed-out
        // rather than retrying forever against a token that will never work again.
        log.warn('authManager: refresh failed, signing out', err);
        clearTokens();
        this.setStatus({ state: 'signed-out' });
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
