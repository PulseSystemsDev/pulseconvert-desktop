import fs from 'fs';
import path from 'path';
import { desktopFetch, desktopFetchJson } from './apiClient';

interface UploadInitResponse {
  uploadId: string;
  chunkSize: number;
}

export async function uploadLocalFile(
  filePath: string,
  onProgress: (bytesSent: number, totalBytes: number) => void,
): Promise<{ uploadId: string }> {
  const stat = fs.statSync(filePath);
  const filename = path.basename(filePath);

  const init = await desktopFetchJson<UploadInitResponse>('/api/upload/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, size: stat.size, mimeType: 'application/octet-stream' }),
  });

  const fd = fs.openSync(filePath, 'r');
  try {
    let sent = 0;
    let index = 0;
    while (sent < stat.size) {
      const chunkLength = Math.min(init.chunkSize, stat.size - sent);
      const buffer = Buffer.alloc(chunkLength);
      fs.readSync(fd, buffer, 0, chunkLength, sent);
      await desktopFetch(`/api/upload/chunk?uploadId=${encodeURIComponent(init.uploadId)}&index=${index}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: buffer,
      });
      sent += chunkLength;
      index += 1;
      onProgress(sent, stat.size);
    }
  } finally {
    fs.closeSync(fd);
  }

  await desktopFetchJson('/api/upload/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uploadId: init.uploadId }),
  });

  return { uploadId: init.uploadId };
}
