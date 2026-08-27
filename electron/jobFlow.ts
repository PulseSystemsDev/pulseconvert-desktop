import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import yazl from 'yazl';
import config from './configStore';
import { desktopFetch, desktopFetchJson, ApiError } from './apiClient';
import { loadTokens } from './tokenStore';
import type { ConversionProfile, ConversionTarget, JobRecord, JobStatusPayload, OptimizeCategory } from './types';

const POLL_INTERVAL_MS = 2000;

export class JobFailedError extends Error {}

export async function downloadToFile(url: string, destPath: string): Promise<void> {
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

  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  try {
    await pipeline(
      Readable.fromWeb(res.body as import('stream/web').ReadableStream<Uint8Array>),
      fs.createWriteStream(destPath),
    );
  } catch (err) {
    fs.rmSync(destPath, { force: true });
    throw err;
  }
}

export async function submitConvertJob(
  url: string | undefined,
  uploadId: string | undefined,
  profile: ConversionProfile,
  target: ConversionTarget,
): Promise<{ jobId: string }> {
  const body = uploadId
    ? { sourceType: 'upload', uploadId, conversionProfile: profile, conversionTarget: target }
    : { sourceType: 'url', url, conversionProfile: profile, conversionTarget: target };
  return desktopFetchJson<{ jobId: string }>('/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function submitOptimizeJob(uploadId: string, optimizeCategory: OptimizeCategory): Promise<{ jobId: string }> {
  return desktopFetchJson<{ jobId: string }>('/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceType: 'optimize', uploadId, optimizeCategory }),
  });
}

function labelFor(payload: JobStatusPayload): string {
  if (payload.status === 'scraping') return 'Finding the mod source';
  if (payload.status === 'queued') {
    return payload.queuePosition > 0 ? `Queued on the server (position ${payload.queuePosition})` : 'Queued on the server';
  }
  return payload.progress.label ?? 'Processing on the server';
}

export async function pollJobUntilDone(
  jobId: string,
  onProgress: (label: string, current?: number, total?: number) => void,
): Promise<JobRecord> {
  for (;;) {
    const job = await desktopFetchJson<JobRecord>(`/api/jobs/${jobId}`);
    if (job.status === 'done') return job;
    if (job.status === 'failed') throw new JobFailedError(job.error ?? 'The server could not complete this job.');

    const label = labelFor(job);
    if (job.status === 'processing' && job.progress.current != null && job.progress.total) {
      onProgress(label, job.progress.current, job.progress.total);
    } else {
      onProgress(label);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

export async function downloadJobOutput(job: JobRecord, destPath: string): Promise<void> {
  if (!job.downloadUrl) throw new Error('The server marked this job done but did not return a download URL.');
  await downloadToFile(job.downloadUrl, destPath);
}

export function assertNotRateLimited(err: unknown): void {
  if (err instanceof ApiError && (err.status === 429 || err.status === 409)) {
    throw new Error(err.message);
  }
}

export function zipFolder(sourceDir: string, outputZipPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    let settled = false;
    const finishError = (err: Error) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    const walk = (dir: string, prefix: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) continue;
        const full = path.join(dir, entry.name);
        const archivePath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) walk(full, archivePath);
        else if (entry.isFile()) zip.addFile(full, archivePath);
      }
    };
    walk(sourceDir, '');
    fs.mkdirSync(path.dirname(outputZipPath), { recursive: true });
    const output = fs.createWriteStream(outputZipPath);
    output.once('error', finishError);
    zip.outputStream.once('error', finishError);
    output.once('close', () => {
      if (settled) return;
      settled = true;
      resolve();
    });
    zip.outputStream.pipe(output);
    zip.end();
  });
}

export { desktopFetch };
