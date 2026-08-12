import Store from 'electron-store';

interface DesktopConfig {
  /** Pulse Accounts issuer origin - overridable for local dev against a non-production instance. */
  accountsIssuer: string;
  /** This app's own registered OIDC client_id (public client, no secret - see
   *  PulseAccounts/packages/db/src/seedClients.ts). Not sensitive; a client_id is never a secret. */
  clientId: string;
  /** pulseconvert's own API base URL. */
  apiBaseUrl: string;
  /** Manual override when detectBlenderPath() (localNative.ts) can't find Blender itself. */
  blenderPath: string | null;
  /** Manual override for the bundled rpf-tool - only useful for local development against an
   *  unpackaged build; production builds always find the bundled one via extraResources. */
  rpfToolPath: string | null;
  /** Manual override if system 7-Zip isn't on PATH under the expected "7z"/"7zz" name. */
  sevenZipPath: string | null;
  /** Where converted resources get written - see localDeploy.ts (Phase D). Defaults to a
   *  PulseConvert folder under the OS Documents directory, set properly once `app` is ready
   *  (electron's path helpers aren't available at module-eval time), see main.ts's startup. */
  outputFolder: string | null;
  /** Stable identity for this install, generated once (crypto.randomUUID()) on first launch and
   *  registered with the server (see deviceRegistry.ts) - persists across app restarts and
   *  re-signing-in, since dashboard-queued commands target this id, not the current session. */
  deviceId: string | null;

  // --- Phase D: auto-deploy. Deliberately configured entirely on-device, never sent through a
  // dashboard command payload - see sftpCredentialsStore.ts's doc comment for why the password
  // specifically lives in its own safeStorage-encrypted file, not here. ---
  deployMode: 'none' | 'local' | 'sftp';
  localDeployFolder: string | null;
  sftpHost: string | null;
  sftpPort: number;
  sftpUsername: string | null;
  sftpRemotePath: string | null;
}

const store = new Store<DesktopConfig>({
  name: 'pulseconvert-desktop-config',
  defaults: {
    accountsIssuer: process.env.PULSE_ACCOUNTS_ISSUER || 'https://accounts.pulsesystems.dev',
    clientId: process.env.PULSE_ACCOUNTS_DESKTOP_CLIENT_ID || 'pulseconvert-desktop',
    apiBaseUrl: process.env.PULSECONVERT_API_URL || 'https://convert.pulsesystems.dev',
    blenderPath: null,
    rpfToolPath: null,
    sevenZipPath: null,
    outputFolder: null,
    deviceId: null,
    deployMode: 'none',
    localDeployFolder: null,
    sftpHost: null,
    sftpPort: 22,
    sftpUsername: null,
    sftpRemotePath: null,
  },
  schema: {
    accountsIssuer: { type: 'string' },
    clientId: { type: 'string' },
    apiBaseUrl: { type: 'string' },
    blenderPath: { type: ['string', 'null'] },
    rpfToolPath: { type: ['string', 'null'] },
    sevenZipPath: { type: ['string', 'null'] },
    outputFolder: { type: ['string', 'null'] },
    deviceId: { type: ['string', 'null'] },
    deployMode: { type: 'string', enum: ['none', 'local', 'sftp'] },
    localDeployFolder: { type: ['string', 'null'] },
    sftpHost: { type: ['string', 'null'] },
    sftpPort: { type: 'number' },
    sftpUsername: { type: ['string', 'null'] },
    sftpRemotePath: { type: ['string', 'null'] },
  },
});

export default store;
