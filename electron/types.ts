export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  /** Unix ms timestamp - computed from the token response's `expires_in` at fetch time, not
   *  re-derived from the JWT itself (the access token is opaque to this app; only the server
   *  ever verifies it - see pulseconvert's apiAuth.ts). */
  accessTokenExpiresAt: number;
  scope: string;
}

export type AuthStatus =
  | { state: 'signed-out' }
  | { state: 'starting' }
  | { state: 'awaiting-approval'; userCode: string; verificationUri: string; verificationUriComplete: string; expiresAt: number }
  | { state: 'signed-in'; discordId: string | null }
  | { state: 'denied' }
  | { state: 'expired' }
  | { state: 'error'; message: string };

export interface DeploySettings {
  deployMode: 'none' | 'local' | 'sftp';
  localDeployFolder: string | null;
  sftpHost: string | null;
  sftpPort: number;
  sftpUsername: string | null;
  sftpRemotePath: string | null;
}

export interface DeployOutcome {
  deployed: boolean;
  mode: 'none' | 'local' | 'sftp';
  destination?: string;
  error?: string;
}

export interface ConvertResult {
  outputZipPath: string;
  resourceName: string;
  fixLog: string[];
  fromCache: boolean;
  deploy?: DeployOutcome;
}

export interface ConvertOutcome {
  ok: boolean;
  result?: ConvertResult;
  error?: string;
}

/** Shape exposed to the renderer via contextBridge - see preload.ts. Mirrors this repo's sibling
 *  d:\Desktop\PulseMDT\desktop project's own `PulseDesktopAPI` naming convention. */
export interface PulseConvertDesktopAPI {
  platform: string;
  version: string;
  isDesktop: true;
  startSignIn: () => void;
  cancelSignIn: () => void;
  signOut: () => void;
  getAuthStatus: () => Promise<AuthStatus>;
  onAuthStatusChange: (cb: (status: AuthStatus) => void) => () => void;
  openExternal: (url: string) => void;
  startConvert: (url: string) => Promise<ConvertOutcome>;
  onConvertProgress: (cb: (label: string) => void) => () => void;
  showInFolder: (filePath: string) => void;
  getSettings: () => Promise<DeploySettings>;
  saveSettings: (settings: DeploySettings & { sftpPassword?: string }) => Promise<{ ok: boolean }>;
  chooseFolder: () => Promise<string | null>;
}
