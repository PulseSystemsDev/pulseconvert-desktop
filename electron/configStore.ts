import Store from 'electron-store';

interface DesktopConfig {

  accountsIssuer: string;

  clientId: string;

  apiBaseUrl: string;

  blenderPath: string | null;

  rpfToolPath: string | null;

  sevenZipPath: string | null;

  outputFolder: string | null;

  deviceId: string | null;

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
