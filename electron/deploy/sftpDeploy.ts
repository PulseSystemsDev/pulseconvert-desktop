import path from 'path';
import os from 'os';
import fs from 'fs';
import SftpClient from 'ssh2-sftp-client';
import { extractZip } from '../pipeline/unpack';

export interface SftpTarget {
  host: string;
  port: number;
  username: string;
  password: string;
  remotePath: string;
}

/**
 * Deploys a converted resource to a remote game server over SFTP - for the common case where the
 * FXServer is a separate rented box, not the same machine running this desktop app. Extracts the
 * zip locally first (same extractZip used by localDeploy.ts), then uploads the resulting folder
 * tree with ssh2-sftp-client's own recursive uploadDir - no server-side unzip dependency assumed.
 */
export async function deployToSftp(zipPath: string, resourceName: string, target: SftpTarget): Promise<string> {
  const localExtractDir = path.join(os.tmpdir(), 'pulseconvert-desktop-sftp', `${resourceName}-${Date.now()}`);
  await extractZip(zipPath, localExtractDir);

  const client = new SftpClient();
  try {
    await client.connect({
      host: target.host,
      port: target.port,
      username: target.username,
      password: target.password,
      readyTimeout: 15_000,
    });

    const remoteResourceDir = `${target.remotePath.replace(/\/$/, '')}/${resourceName}`;
    await client.uploadDir(localExtractDir, remoteResourceDir);
    return remoteResourceDir;
  } finally {
    await client.end().catch(() => {});
    fs.rmSync(localExtractDir, { recursive: true, force: true });
  }
}
