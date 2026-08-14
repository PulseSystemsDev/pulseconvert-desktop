import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { app } from 'electron';
import log from 'electron-log';
import config from './configStore';
import { desktopFetchJson, ApiError } from './apiClient';
import { convertVehicleLocally } from './localConvert';
import { loadTokens } from './tokenStore';
import type { ConvertRequest } from './types';

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
  const apiOrigin = new URL(apiBase).origin;
  const absoluteUrl = new URL(url, `${apiBase.replace(/\/$/, '')}/`);
  if (!['http:', 'https:'].includes(absoluteUrl.protocol)) throw new Error('Download URL used an unsupported protocol.');
  const isOwnApi = absoluteUrl.origin === apiOrigin;

  const headers: Record<string, string> = {};
  if (isOwnApi) {
    const tokens = loadTokens();
    if (!tokens) throw new Error('Not signed in.');
    headers.Authorization = `Bearer ${tokens.accessToken}`;
  }

  const res = await fetch(absoluteUrl, { headers });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
  const advertisedBytes = Number(res.headers.get('content-length'));
  const maxDownloadBytes = 4 * 1024 * 1024 * 1024;
  if (Number.isFinite(advertisedBytes) && advertisedBytes > maxDownloadBytes) {
    throw new Error('Download exceeds the 4 GiB local-processing safety limit.');
  }

  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  let receivedBytes = 0;
  const guardedBody = Readable.fromWeb(res.body as import('stream/web').ReadableStream<Uint8Array>);
  guardedBody.on('data', (chunk: Buffer) => {
    receivedBytes += chunk.length;
    if (receivedBytes > maxDownloadBytes) guardedBody.destroy(new Error('Download exceeds the 4 GiB local-processing safety limit.'));
  });
  try {
    await pipeline(
      guardedBody,
      fs.createWriteStream(destPath),
    );
  } catch (err) {
    fs.rmSync(destPath, { force: true });
    throw err;
  }
}

function workDirFor(sessionId: string): string {
  return path.join(app.getPath('temp'), 'pulseconvert-desktop', sessionId);
}

function removeWorkDir(workDir: string): void {
  const base = path.resolve(app.getPath('temp'), 'pulseconvert-desktop');
  const resolved = path.resolve(workDir);
  if (resolved.startsWith(base + path.sep)) fs.rmSync(resolved, { recursive: true, force: true });
}

function safeOutputStem(value: string): string {
  const cleaned = value.toLowerCase().replace(/\.zip$/i, '').replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned.slice(0, 60) || 'converted_vehicle';
}

function uniqueOutputPath(resourceName: string): string {
  const outputFolder = config.get('outputFolder') || path.join(app.getPath('documents'), 'PulseConvert');
  fs.mkdirSync(outputFolder, { recursive: true });
  const stem = safeOutputStem(resourceName);
  let candidate = path.join(outputFolder, `${stem}.zip`);
  let suffix = 2;
  while (fs.existsSync(candidate)) candidate = path.join(outputFolder, `${stem}_${suffix++}.zip`);
  return candidate;
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
export async function runConvertFlow(
  request: ConvertRequest,
  onProgress: (label: string, current?: number, total?: number) => void,
): Promise<ConvertFlowResult> {
  const { url, profile, target } = request;
  const sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const workDir = workDirFor(sessionId);

  onProgress('Checking the catalog');
  const resolved = await desktopFetchJson<ResolveResponse>('/api/desktop/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, conversionProfile: profile, conversionTarget: target }),
  });

  if (resolved.status === 'cached') {
    onProgress('Already converted - downloading the cached copy');
    const resourceName = safeOutputStem(resolved.title ?? 'vehicle');
    const outputZipPath = uniqueOutputPath(resourceName);
    await downloadToFile(resolved.downloadUrl, outputZipPath);
    return { outputZipPath, resourceName, fixLog: [], fromCache: true };
  }

  try {
    onProgress('Downloading source archive');
    const sourceArchivePath = path.join(workDir, 'source-archive');
    await downloadToFile(resolved.downloadUrl, sourceArchivePath);

    const result = await convertVehicleLocally(
      sourceArchivePath,
      workDir,
      resolved.title ?? 'converted_vehicle',
      url,
      onProgress,
      profile,
      target,
    );
    const persistentOutputPath = uniqueOutputPath(result.resourceName);
    try {
      fs.copyFileSync(result.outputZipPath, persistentOutputPath);
    } catch (err) {
      fs.rmSync(persistentOutputPath, { force: true });
      throw err;
    }

    // Best-effort, fire-and-forget: seed the public catalog via the same job-submission path a
    // browser conversion uses. It never blocks returning the user's local result.
    void seedCatalogInBackground(request);
    return { ...result, outputZipPath: persistentOutputPath, fromCache: false };
  } finally {
    removeWorkDir(workDir);
  }
}

async function seedCatalogInBackground(request: ConvertRequest): Promise<void> {
  try {
    await desktopFetchJson('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceType: 'url',
        url: request.url,
        conversionProfile: request.profile,
        conversionTarget: request.target,
      }),
    });
  } catch (err) {
    if (err instanceof ApiError && (err.status === 429 || err.status === 409)) return; // already queued/rate-limited - fine
    log.warn('[convertFlow] background catalog-seed submission failed', err);
  }
}
