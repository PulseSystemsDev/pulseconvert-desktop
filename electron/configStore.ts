import Store from 'electron-store';
import type { ConversionTarget, DeployMode, Task } from './types';

interface DesktopConfig {
  accountsIssuer: string;
  clientId: string;
  apiBaseUrl: string;
  outputFolder: string | null;
  deviceId: string | null;
  deployMode: DeployMode;
  localDeployFolder: string | null;
  sftpHost: string | null;
  sftpPort: number;
  sftpUsername: string | null;
  sftpRemotePath: string | null;
  autoDownload: boolean;
  notifyOnComplete: boolean;
  revealOnComplete: boolean;
  acceptDashboardCommands: boolean;
  defaultTarget: ConversionTarget;
  launchMinimized: boolean;
  onboarded: boolean;
  windowBounds: { x?: number; y?: number; width: number; height: number; maximized: boolean } | null;
  taskHistory: Task[];
}

const store = new Store<DesktopConfig>({
  name: 'pulseconvert-desktop-config',
  defaults: {
    accountsIssuer: 'https://accounts.pulsesystems.dev',
    clientId: 'pulseconvert-desktop',
    apiBaseUrl: 'https://convert.pulsesystems.dev',
    outputFolder: null,
    deviceId: null,
    deployMode: 'none',
    localDeployFolder: null,
    sftpHost: null,
    sftpPort: 22,
    sftpUsername: null,
    sftpRemotePath: null,
    autoDownload: true,
    notifyOnComplete: true,
    revealOnComplete: false,
    acceptDashboardCommands: true,
    defaultTarget: 'addon',
    launchMinimized: false,
    onboarded: false,
    windowBounds: null,
    taskHistory: [],
  },
  schema: {
    accountsIssuer: { type: 'string' },
    clientId: { type: 'string' },
    apiBaseUrl: { type: 'string' },
    outputFolder: { type: ['string', 'null'] },
    deviceId: { type: ['string', 'null'] },
    deployMode: { type: 'string', enum: ['none', 'local', 'sftp'] },
    localDeployFolder: { type: ['string', 'null'] },
    sftpHost: { type: ['string', 'null'] },
    sftpPort: { type: 'number' },
    sftpUsername: { type: ['string', 'null'] },
    sftpRemotePath: { type: ['string', 'null'] },
    autoDownload: { type: 'boolean' },
    notifyOnComplete: { type: 'boolean' },
    revealOnComplete: { type: 'boolean' },
    acceptDashboardCommands: { type: 'boolean' },
    defaultTarget: { type: 'string', enum: ['addon', 'replace'] },
    launchMinimized: { type: 'boolean' },
    onboarded: { type: 'boolean' },
    windowBounds: { type: ['object', 'null'] },
    taskHistory: { type: 'array' },
  },
});

export function apiBase(): string {
  return (process.env.PULSECONVERT_API_URL || store.get('apiBaseUrl')).replace(/\/+$/, '');
}

export function accountsIssuer(): string {
  return process.env.PULSE_ACCOUNTS_ISSUER || store.get('accountsIssuer');
}

export function clientId(): string {
  return process.env.PULSE_ACCOUNTS_DESKTOP_CLIENT_ID || store.get('clientId');
}

export default store;
