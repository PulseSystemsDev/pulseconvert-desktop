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

export type ConversionProfile = 'preserve' | 'performance';
export type ConversionTarget = 'addon' | 'replace';
export type OptimizeCategory = 'props' | 'vehicles' | 'clothing' | 'textures';
export type InputKind = 'archive' | 'folder' | 'file';
export type PickerMode = 'archives' | 'folder' | 'zip' | 'image' | 'text';
export type DeployMode = 'none' | 'local' | 'sftp';

export type ServerJobStatus = 'scraping' | 'queued' | 'processing' | 'done' | 'failed';
export type ServerJobSourceType = 'upload' | 'url' | 'batch' | 'fix' | 'optimize';

export interface SelectedInput {
  inputPath: string;
  inputKind: InputKind;
  name: string;
  sizeBytes: number | null;
}

export interface JobRecord {
  id: string;
  title: string | null;
  licenseText: string | null;
  realBrand: string | null;
  outputSizeBytes: number | null;
  status: ServerJobStatus;
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

export interface JobListItem {
  id: string;
  title: string | null;
  sourceType: ServerJobSourceType;
  status: ServerJobStatus;
  error: string | null;
  conversionTarget: ConversionTarget;
  optimizeCategory: OptimizeCategory | null;
  detectedCategory: string | null;
  inputSizeBytes: number;
  outputSizeBytes: number;
  hasOutput: boolean;
  healthScore: number | null;
  createdAt: string | null;
  completedAt: string | null;
  expiresAt: string | null;
}

export type TaskKind =
  | 'convert-url'
  | 'convert-file'
  | 'convert-pack'
  | 'optimize'
  | 'fix'
  | 'catalog-download'
  | 'job-download'
  | 'siren-build'
  | 'map-inspect'
  | 'deploy';

export type TaskPhase =
  | 'waiting'
  | 'preparing'
  | 'uploading'
  | 'submitting'
  | 'scraping'
  | 'queued'
  | 'processing'
  | 'downloading'
  | 'deploying'
  | 'done'
  | 'failed'
  | 'cancelled';

export type TaskOrigin = 'app' | 'dashboard';

export interface DeployOutcome {
  deployed: boolean;
  mode: DeployMode;
  destination?: string;
  error?: string;
}

export interface Task {
  id: string;
  kind: TaskKind;
  origin: TaskOrigin;
  title: string;
  subtitle: string | null;
  phase: TaskPhase;
  label: string;
  percent: number | null;
  jobId: string | null;
  queuePosition: number | null;
  etaMs: number | null;
  outputPath: string | null;
  outputSizeBytes: number | null;
  fixLog: string[];
  deploy: DeployOutcome | null;
  error: string | null;
  result: unknown;
  createdAt: number;
  finishedAt: number | null;
}

export interface ConvertRequest {
  urls: string[];
  inputs: string[];
  profile: ConversionProfile;
  target: ConversionTarget;
  packBundleMode: 'separate' | 'single';
}

export interface OptimizeRequest {
  inputPath: string;
  category: OptimizeCategory;
}

export interface SirenBuildRequest {
  inputPath: string;
  resourceName: string;
  dlcName: string;
  soundsetName: string;
  tones: string[];
  gamedataPath?: string;
  sounddataPath?: string;
  wavepackPath?: string;
}

export interface CatalogDownloadRequest {
  kind: 'vehicle' | 'animation';
  id: string;
  title: string;
}

export interface DesktopSettings {
  outputFolder: string;
  deployMode: DeployMode;
  localDeployFolder: string | null;
  sftpHost: string | null;
  sftpPort: number;
  sftpUsername: string | null;
  sftpRemotePath: string | null;
  hasSftpPassword: boolean;
  autoDownload: boolean;
  notifyOnComplete: boolean;
  revealOnComplete: boolean;
  acceptDashboardCommands: boolean;
  defaultTarget: ConversionTarget;
  launchMinimized: boolean;
  onboarded: boolean;
}

export type SaveDesktopSettings = Partial<Omit<DesktopSettings, 'hasSftpPassword'>> & { sftpPassword?: string };

export interface ApiRequest {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  body?: unknown;
}

export type ApiResult<T = unknown> = { ok: true; data: T } | { ok: false; error: string; status: number };

export type UpdateState =
  | { state: 'idle' }
  | { state: 'unsupported'; reason: string }
  | { state: 'checking' }
  | { state: 'available'; version: string; notes: string | null; installRequested: boolean }
  | { state: 'downloading'; version: string; notes: string | null; percent: number; installRequested: boolean }
  | { state: 'ready'; version: string; notes: string | null }
  | { state: 'up-to-date' }
  | { state: 'error'; message: string };

export interface AppInfo {
  version: string;
  platform: string;
  arch: string;
  apiBaseUrl: string;
  deviceId: string;
  credentialStorage: 'os-keychain' | 'file';
}

export interface PulseConvertDesktopAPI {
  platform: string;
  getAppInfo: () => Promise<AppInfo>;

  getAuthStatus: () => Promise<AuthStatus>;
  onAuthStatus: (cb: (status: AuthStatus) => void) => () => void;
  startSignIn: () => void;
  cancelSignIn: () => void;
  signOut: () => void;

  api: <T = unknown>(request: ApiRequest) => Promise<ApiResult<T>>;
  resolveUrl: (path: string | null) => string | null;

  getTasks: () => Promise<Task[]>;
  onTasks: (cb: (tasks: Task[]) => void) => () => void;
  startConvert: (request: ConvertRequest) => Promise<ApiResult<{ taskId: string }>>;
  startOptimize: (request: OptimizeRequest) => Promise<ApiResult<{ taskId: string }>>;
  startFix: (inputPath: string) => Promise<ApiResult<{ taskId: string }>>;
  startSirenBuild: (request: SirenBuildRequest) => Promise<ApiResult<{ taskId: string }>>;
  startMapInspect: (inputPath: string) => Promise<ApiResult<{ taskId: string }>>;
  downloadCatalogItem: (request: CatalogDownloadRequest) => Promise<ApiResult<{ taskId: string }>>;
  downloadJob: (jobId: string, title: string | null) => Promise<ApiResult<{ taskId: string }>>;
  trackJob: (jobId: string, title: string | null) => Promise<ApiResult<{ taskId: string }>>;
  deployOutput: (filePath: string) => Promise<ApiResult<{ taskId: string }>>;
  cancelTask: (taskId: string) => void;
  dismissTask: (taskId: string) => void;
  clearFinishedTasks: () => void;

  pickInputs: (mode: PickerMode, multiple: boolean) => Promise<SelectedInput[]>;
  approveDroppedFiles: (files: File[]) => Promise<SelectedInput[]>;
  readTextFile: (inputPath: string) => Promise<string | null>;
  chooseFolder: () => Promise<string | null>;

  fetchPreview: (source: { kind: 'job' | 'vehicle'; id: string }) => Promise<ApiResult<ArrayBuffer>>;
  submitScreenshot: (jobId: string) => Promise<ApiResult<{ submitted: boolean }>>;

  showInFolder: (filePath: string) => void;
  openOutputFolder: () => void;
  openExternal: (url: string) => void;

  getSettings: () => Promise<DesktopSettings>;
  saveSettings: (settings: SaveDesktopSettings) => Promise<ApiResult<DesktopSettings>>;
  testSftp: () => Promise<ApiResult<{ fingerprint: string }>>;
  forgetSftpHostKey: () => Promise<void>;

  getUpdateState: () => Promise<UpdateState>;
  onUpdateState: (cb: (state: UpdateState) => void) => () => void;
  checkForUpdates: () => void;
  installUpdate: () => void;

  onNavigate: (cb: (route: string) => void) => () => void;
}
