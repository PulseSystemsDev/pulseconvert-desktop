import path from 'path';
import os from 'os';
import fs from 'fs';
import SftpClient from 'ssh2-sftp-client';
import { extractZip } from '../pipeline/unpack';
import { fingerprintOf, getPinnedFingerprint, pinFingerprint } from './sftpHostKeyStore';

export interface SftpTarget {
  host: string;
  port: number;
  username: string;
  password: string;
  remotePath: string;
}

export async function deployToSftp(zipPath: string, resourceName: string, target: SftpTarget): Promise<string> {
  const localExtractDir = path.join(os.tmpdir(), 'pulseconvert-desktop-sftp', `${resourceName}-${Date.now()}`);
  const client = new SftpClient();
  try {
    await extractZip(zipPath, localExtractDir);

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

    let hostKeyMismatch: { pinned: string; presented: string } | null = null;
    await client.connect({
      host: target.host,
      port: target.port,
      username: target.username,
      password: target.password,
      readyTimeout: 15_000,
      hostVerifier: (hostKey: Buffer): boolean => {
        const presented = fingerprintOf(hostKey);
        const pinned = getPinnedFingerprint(target.host, target.port);
        if (!pinned) {
          pinFingerprint(target.host, target.port, presented);
          return true;
        }
        if (pinned !== presented) {
          hostKeyMismatch = { pinned, presented };
          return false;
        }
        return true;
      },
    }).catch((err) => {
      if (hostKeyMismatch) {
        const { pinned, presented } = hostKeyMismatch as { pinned: string; presented: string };
        throw new Error(
          `SFTP host key for ${target.host}:${target.port} does not match the one recorded on first connect ` +
          `(expected ${pinned}, got ${presented}). This can mean the server was reinstalled or its key was ` +
          `rotated - or that a network attacker is intercepting this connection. Only proceed if you can ` +
          `independently confirm the new key with whoever controls the server.`
        );
      }
      throw err;
    });

    const remoteResourceDir = `${target.remotePath.replace(/\/$/, '')}/${resourceName}`;
    await client.uploadDir(localUploadDir, remoteResourceDir);
    return remoteResourceDir;
  } finally {
    await client.end().catch(() => {});
    fs.rmSync(localExtractDir, { recursive: true, force: true });
  }
}
