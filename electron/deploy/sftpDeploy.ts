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
  const client = new SftpClient();
  try {
    await extractZip(zipPath, localExtractDir);

    // Pulse Convert bundles normally contain one top-level `<resourceName>/` directory. Uploading
    // the extraction root into a remote directory with that same name produces
    // `<resourceName>/<resourceName>/fxmanifest.lua`. Upload the actual resource directory when the
    // ZIP has that standard shape; cached catalog artifacts with a single differently named root
    // receive the same treatment. A flat/multi-root archive still uploads from its extraction root.
    const expectedResourceDir = path.join(localExtractDir, resourceName);
    let localUploadDir = localExtractDir;
    if (fs.existsSync(expectedResourceDir) && fs.statSync(expectedResourceDir).isDirectory()) {
      localUploadDir = expectedResourceDir;
    } else {
      const topLevelEntries = fs.readdirSync(localExtractDir, { withFileTypes: true }).filter((entry) => !entry.isSymbolicLink());
      if (topLevelEntries.length === 1 && topLevelEntries[0].isDirectory()) {
        localUploadDir = path.join(localExtractDir, topLevelEntries[0].name);
      }
    }

    await client.connect({
      host: target.host,
      port: target.port,
      username: target.username,
      password: target.password,
      readyTimeout: 15_000,
    });

    const remoteResourceDir = `${target.remotePath.replace(/\/$/, '')}/${resourceName}`;
    await client.uploadDir(localUploadDir, remoteResourceDir);
    return remoteResourceDir;
  } finally {
    await client.end().catch(() => {});
    fs.rmSync(localExtractDir, { recursive: true, force: true });
  }
}
