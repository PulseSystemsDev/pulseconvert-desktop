export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;

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

export type ConversionProfile = 'preserve';
export type ConversionTarget = 'addon' | 'replace';
export type OptimizeCategory = 'props' | 'vehicles' | 'clothing' | 'textures';
export type OptimizeInputKind = 'archive' | 'folder';
export type InputPickerKind = 'archive-or-file' | 'folder';
export type ProgressOperation = 'convert' | 'optimize' | 'remote-convert' | 'remote-optimize';

export type JobStatus = 'scraping' | 'queued' | 'processing' | 'done' | 'failed';

export interface JobStatusPayload {
  status: JobStatus;
  queuePosition: number;
  scrapeQueuePosition: number;
  etaMs: number | null;
  progress: { label: string | null; current: number | null; total: number | null };
  health: { score: number | null; report: unknown };
  fixLog: string[];
  error: string | null;
  downloadUrl: string | null;
  previewUrl: string | null;
  expiresAt: string | null;
  batch: { total: number; done: number; currentTitle: string | null; currentIndex: number; failedItems: Array<{ title: string; error: string }> } | null;
}

export interface JobRecord extends JobStatusPayload {
  id: string;
  title: string | null;
  licenseText: string | null;
  realBrand: string | null;
  outputSizeBytes: number | null;
}

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
  hasSftpPassword: boolean;
}

export type SaveDesktopSettings = Omit<DesktopSettings, 'hasSftpPassword'> & {

  sftpPassword?: string;
};

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
  fixLog: string[];
  outputSizeBytes: number;
}

export interface OptimizeOutcome {
  ok: boolean;
  result?: OptimizeResult;
  error?: string;
}

export type CatalogKind = 'vehicles' | 'map' | 'ped' | 'eup';

export interface CatalogListItem {
  id: string;
  title: string;
  author: string | null;
  sourceUrl: string;
  thumbnailUrl: string | null;
}

export interface CatalogListResponse {
  entries: CatalogListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface CatalogSearchRequest {
  kind: CatalogKind;
  search: string;
  sort: string;
  page: number;
}

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
  searchCatalog: (request: CatalogSearchRequest) => Promise<CatalogListResponse>;
}
