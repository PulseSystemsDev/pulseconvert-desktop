import fs from 'fs';
import path from 'path';
import yazl from 'yazl';
import { absoluteApiUrl, ApiError, desktopFetch, desktopFetchJson, getValidAccessToken, isOwnApiUrl, postJson } from './apiClient';

// Cloudflare refuses request bodies over 100 MB, whatever chunk size the server asks for.
const MAX_CHUNK_BYTES = 99_000_000;

interface UploadInitResponse {
  uploadId: string;
  chunkSize: number;
}

const CHUNK_ATTEMPTS = 4;

export class CancelledError extends Error {
  constructor() {
    super('Cancelled.');
    this.name = 'CancelledError';
  }
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new CancelledError();
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new CancelledError());
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new CancelledError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function isRetryable(err: unknown): boolean {
  if (err instanceof CancelledError) return false;
  if (err instanceof ApiError) return err.status >= 500 || err.status === 408;
  return true;
}

export async function uploadLocalFile(
  filePath: string,
  onProgress: (bytesSent: number, totalBytes: number) => void,
  signal?: AbortSignal,
): Promise<{ uploadId: string }> {
  const stat = fs.statSync(filePath);
  const filename = path.basename(filePath);
  const init = await postJson<UploadInitResponse>('/api/upload/init', { filename, size: stat.size, mimeType: 'application/octet-stream' }, signal);

  const fd = fs.openSync(filePath, 'r');
  try {
    let sent = 0;
    let index = 0;
    while (sent < stat.size) {
      throwIfAborted(signal);
      const chunkLength = Math.min(init.chunkSize, MAX_CHUNK_BYTES, stat.size - sent);
      const buffer = Buffer.alloc(chunkLength);
      fs.readSync(fd, buffer, 0, chunkLength, sent);

      for (let attempt = 1; ; attempt++) {
        try {
          await desktopFetch(`/api/upload/chunk?uploadId=${encodeURIComponent(init.uploadId)}&index=${index}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: buffer,
            signal,
          });
          break;
        } catch (err) {
          if (signal?.aborted) throw new CancelledError();
          if (attempt >= CHUNK_ATTEMPTS || !isRetryable(err)) throw err;
          await sleep(1000 * 2 ** (attempt - 1), signal);
        }
      }

      sent += chunkLength;
      index += 1;
      onProgress(sent, stat.size);
    }
  } finally {
    fs.closeSync(fd);
  }

  await postJson('/api/upload/complete', { uploadId: init.uploadId }, signal);
  return { uploadId: init.uploadId };
}

export async function downloadToFile(
  url: string,
  destPath: string,
  onProgress?: (received: number, total: number | null) => void,
  signal?: AbortSignal,
  init: RequestInit = {},
): Promise<number> {
  const target = absoluteApiUrl(url);
  if (!['http:', 'https:'].includes(target.protocol)) throw new Error('Download URL used an unsupported protocol.');

  // The access token is only ever attached to Pulse Convert's own origin - never to a
  // third-party host a job's download URL might point at.
  const headers: Record<string, string> = { ...((init.headers as Record<string, string>) ?? {}) };
  if (isOwnApiUrl(target)) headers.Authorization = `Bearer ${await getValidAccessToken()}`;

  const res = await fetch(target, { ...init, headers, signal });
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(body.error ?? `Download failed (${res.status})`, res.status);
  }

  const totalHeader = Number(res.headers.get('content-length'));
  const total = Number.isFinite(totalHeader) && totalHeader > 0 ? totalHeader : null;
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const partial = `${destPath}.part`;
  const out = fs.createWriteStream(partial);
  let received = 0;
  try {
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (!out.write(value)) await new Promise<void>((resolve) => out.once('drain', () => resolve()));
      onProgress?.(received, total);
    }
    await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
    fs.renameSync(partial, destPath);
    return received;
  } catch (err) {
    out.destroy();
    fs.rmSync(partial, { force: true });
    if (signal?.aborted) throw new CancelledError();
    throw err;
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

export { desktopFetchJson };
