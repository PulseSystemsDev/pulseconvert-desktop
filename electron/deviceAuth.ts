/**
 * Low-level RFC 8628 (OAuth 2.0 Device Authorization Grant) HTTP client against Pulse Accounts.
 * No client secret anywhere here - pulseconvert-desktop is registered as a public client (see
 * PulseAccounts/packages/db/src/seedClients.ts), which is the whole point of this grant: a
 * distributed app has nowhere safe to keep a static secret. Endpoint paths are oidc-provider's
 * own defaults (verified by reading the installed package, not assumed) - PulseAccounts'
 * provider.ts never overrides `routes`, so `/device/auth` and `/token` apply as-is.
 */

export interface DeviceAuthorizationResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  /** Unix ms this device code stops being pollable. */
  expiresAt: number;
  /** Seconds to wait between poll attempts - respected, and bumped on a `slow_down` response. */
  intervalSeconds: number;
}

export class DeviceAuthError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'DeviceAuthError';
  }
}

function normalizeIssuer(issuer: string): string {
  return issuer.endsWith('/') ? issuer.slice(0, -1) : issuer;
}

export async function startDeviceAuthorization(issuer: string, clientId: string): Promise<DeviceAuthorizationResponse> {
  const res = await fetch(`${normalizeIssuer(issuer)}/device/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, scope: 'openid profile email' }),
  });

  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new DeviceAuthError(typeof body.error_description === 'string' ? body.error_description : 'Could not start device sign-in.', typeof body.error === 'string' ? body.error : 'unknown_error');
  }

  const expiresIn = typeof body.expires_in === 'number' ? body.expires_in : 600;
  return {
    deviceCode: String(body.device_code),
    userCode: String(body.user_code),
    verificationUri: String(body.verification_uri),
    verificationUriComplete: String(body.verification_uri_complete ?? body.verification_uri),
    expiresAt: Date.now() + expiresIn * 1000,
    intervalSeconds: typeof body.interval === 'number' ? body.interval : 5,
  };
}

export interface TokenResponse {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
  scope: string;
}

/** Single poll attempt against the token endpoint - the caller (authManager.ts) owns the
 *  interval/backoff loop so it can be cancelled cleanly from a "sign-in cancelled" action. */
export async function pollDeviceToken(issuer: string, clientId: string, deviceCode: string): Promise<TokenResponse | { pending: true } | { slowDown: true }> {
  const res = await fetch(`${normalizeIssuer(issuer)}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: deviceCode,
      client_id: clientId,
    }),
  });

  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (res.ok) {
    return {
      accessToken: String(body.access_token),
      refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : null,
      expiresIn: typeof body.expires_in === 'number' ? body.expires_in : 600,
      scope: typeof body.scope === 'string' ? body.scope : '',
    };
  }

  const error = typeof body.error === 'string' ? body.error : 'unknown_error';
  if (error === 'authorization_pending') return { pending: true };
  if (error === 'slow_down') return { slowDown: true };
  throw new DeviceAuthError(typeof body.error_description === 'string' ? body.error_description : error, error);
}

export async function refreshAccessToken(issuer: string, clientId: string, refreshToken: string): Promise<TokenResponse> {
  const res = await fetch(`${normalizeIssuer(issuer)}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId }),
  });

  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new DeviceAuthError(typeof body.error_description === 'string' ? body.error_description : 'Could not refresh sign-in.', typeof body.error === 'string' ? body.error : 'unknown_error');
  }

  return {
    accessToken: String(body.access_token),
    refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : refreshToken,
    expiresIn: typeof body.expires_in === 'number' ? body.expires_in : 600,
    scope: typeof body.scope === 'string' ? body.scope : '',
  };
}
