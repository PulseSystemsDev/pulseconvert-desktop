export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  /** Unix ms timestamp computed from the token response's expires_in value. */
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

export type ConversionProfile = 'preserve' | 'performance';
export type ConversionTarget = 'addon' | 'replace';
export type OptimizeCategory = 'props' | 'vehicles' | 'clothing' | 'textures';
export type OptimizeQuality = 'balanced' | 'performance' | 'aggressive';
export type OptimizeInputKind = 'archive' | 'file' | 'folder';
export type InputPickerKind = 'archive-or-file' | 'folder';
export type ProgressOperation = 'convert' | 'optimize' | 'remote-convert' | 'remote-optimize';

export interface OperationProgress {
  operation: ProgressOperation;
  label: string;
  current?: number;
  total?: number;
}

export interface ConvertRequest {
  url: string;
  profile: ConversionProfile;
  target: ConversionTarget;
}

export interface OptimizeRequest {
  inputPath: string;
  inputKind: OptimizeInputKind;
  category: OptimizeCategory;
  quality: OptimizeQuality;
}

export interface SelectedInput {
  inputPath: string;
  inputKind: OptimizeInputKind;
  name: string;
  sizeBytes: number | null;
}

export interface DeploySettings {
  deployMode: 'none' | 'local' | 'sftp';
  localDeployFolder: string | null;
  sftpHost: string | null;
  sftpPort: number;
  sftpUsername: string | null;
  sftpRemotePath: string | null;
}

export interface DesktopSettings extends DeploySettings {
  outputFolder: string | null;
  blenderPath: string | null;
  rpfToolPath: string | null;
  sevenZipPath: string | null;
  hasSftpPassword: boolean;
}

export type SaveDesktopSettings = Omit<DesktopSettings, 'hasSftpPassword'> & {
  /** Omitted means retain the stored secret; an explicit blank string clears it. */
  sftpPassword?: string;
};

export interface NativeToolReadiness {
  available: boolean;
  path: string | null;
  source: 'bundled' | 'override' | 'detected' | 'path' | 'missing';
  required: boolean;
  detail: string;
}

export interface SystemReadiness {
  ready: boolean;
  outputFolder: string;
  tools: {
    rpfTool: NativeToolReadiness;
    blender: NativeToolReadiness;
    sevenZip: NativeToolReadiness;
  };
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

export interface OversizedYtd {
  name: string;
  bytes: number;
}

export interface OptimizeResult {
  outputZipPath: string;
  resourceName: string;
  category: OptimizeCategory;
  quality: OptimizeQuality;
  beforeBytes: number;
  afterBytes: number;
  savedBytes: number;
  reductionPercent: number;
  scannedCount: number;
  optimizedCount: number;
  fixLog: string[];
  totalStreamBytes: number;
  oversizedYtd: OversizedYtd[];
}

export interface OptimizeOutcome {
  ok: boolean;
  result?: OptimizeResult;
  error?: string;
}

/** Narrow contextBridge surface exposed to the sandboxed renderer. */
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
  startConvert: (request: ConvertRequest | string) => Promise<ConvertOutcome>;
  startOptimize: (request: OptimizeRequest) => Promise<OptimizeOutcome>;
  onConvertProgress: (cb: (progress: OperationProgress) => void) => () => void;
  showInFolder: (filePath: string) => void;
  getSettings: () => Promise<DesktopSettings>;
  saveSettings: (settings: SaveDesktopSettings) => Promise<{ ok: boolean; error?: string }>;
  chooseFolder: () => Promise<string | null>;
  chooseInput: (kind: InputPickerKind) => Promise<SelectedInput | null>;
  getSystemReadiness: () => Promise<SystemReadiness>;
}
