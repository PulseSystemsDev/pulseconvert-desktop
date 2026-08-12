import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { app } from 'electron';
import log from 'electron-log';
import config from './configStore';
import { desktopFetch, desktopFetchJson, ApiError } from './apiClient';
import { convertVehicleLocally } from './localConvert';
import { loadTokens } from './tokenStore';

interface ResolveResponse {
  status: 'cached' | 'resolved';
  catalogVehicleId?: string;
  title?: string;
  downloadUrl: string;
  author?: string;
  licenseText?: string;
  realBrand?: string;
}

/** Only attaches our own bearer token when downloading from pulseconvert itself (a relative path,
 *  or an absolute URL on the same origin as apiBaseUrl) - a resolved gta5mods.com/mediafire/
 *  sharemods download URL is a third party and must never see this app's access token. */
async function downloadToFile(url: string, destPath: string): Promise<void> {
  const apiBase = config.get('apiBaseUrl');
  const absoluteUrl = url.startsWith('http') ? url : `${apiBase}${url}`;
  const isOwnApi = absoluteUrl.startsWith(apiBase);

  const headers: Record<string, string> = {};
  if (isOwnApi) {
    const tokens = loadTokens();
    if (!tokens) throw new Error('Not signed in.');
    headers.Authorization = `Bearer ${tokens.accessToken}`;
  }

  const res = await fetch(absoluteUrl, { headers });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);

  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const fileStream = fs.createWriteStream(destPath);
    Readable.fromWeb(res.body as import('stream/web').ReadableStream<Uint8Array>)
      .pipe(fileStream)
      .on('finish', resolve)
      .on('error', reject);
  });
}

function workDirFor(sessionId: string): string {
  return path.join(app.getPath('temp'), 'pulseconvert-desktop', sessionId);
}

export interface ConvertFlowResult {
  outputZipPath: string;
  resourceName: string;
  fixLog: string[];
  fromCache: boolean;
}

/**
 * The full "convert this URL" flow: ask the server whether it's already in the catalog (never
 * runs a local conversion for something already cached - just downloads the real artifact), and
 * if not, resolve + download the source archive and convert it locally. For a genuinely new
 * gta5mods.com vehicle, also fires a normal background job submission so the server's own trusted
 * pipeline picks it up for the public catalog - see localConvert.ts's module doc comment and the
 * project plan's Phase B section for why that's a plain existing /api/jobs call, not a new
 * "upload my local result" path.
 */
export async function runConvertFlow(url: string, onProgress: (label: string) => void): Promise<ConvertFlowResult> {
  const sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const workDir = workDirFor(sessionId);

  onProgress('Checking the catalog');
  const resolved = await desktopFetchJson<ResolveResponse>('/api/desktop/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, conversionProfile: 'preserve', conversionTarget: 'addon' }),
  });

  if (resolved.status === 'cached') {
    onProgress('Already converted - downloading the cached copy');
    const outputZipPath = path.join(workDir, `${resolved.title ?? 'vehicle'}.zip`);
    await downloadToFile(resolved.downloadUrl, outputZipPath);
    return { outputZipPath, resourceName: resolved.title ?? 'vehicle', fixLog: [], fromCache: true };
  }

  onProgress('Downloading source archive');
  const sourceArchivePath = path.join(workDir, 'source-archive');
  await downloadToFile(resolved.downloadUrl, sourceArchivePath);

  const result = await convertVehicleLocally(sourceArchivePath, workDir, resolved.title ?? 'converted_vehicle', url, onProgress);

  // Best-effort, fire-and-forget: seed the public catalog via the exact same job-submission path
  // a browser user hitting "Convert" on this URL would use. Never blocks returning the user's own
  // local result, and a failure here (rate limit, already queued, etc.) is not this conversion's
  // problem - the user already has their file either way.
  void seedCatalogInBackground(url);

  return { ...result, fromCache: false };
}

async function seedCatalogInBackground(url: string): Promise<void> {
  try {
    await desktopFetchJson('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceType: 'url', url, conversionProfile: 'preserve', conversionTarget: 'addon' }),
    });
  } catch (err) {
    if (err instanceof ApiError && (err.status === 429 || err.status === 409)) return; // already queued/rate-limited - fine
    log.warn('[convertFlow] background catalog-seed submission failed', err);
  }
}
