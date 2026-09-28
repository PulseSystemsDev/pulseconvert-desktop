import SftpClient from 'ssh2-sftp-client';
import { stageResource } from './stage';
import { fingerprintOf, getPinnedFingerprint, pinFingerprint } from './sftpHostKeyStore';

export interface SftpTarget {
  host: string;
  port: number;
  username: string;
  password: string;
  remotePath: string;
}

async function connect(client: SftpClient, target: SftpTarget): Promise<string> {
  let hostKeyMismatch: { pinned: string; presented: string } | null = null;
  let presentedFingerprint = '';
  await client
    .connect({
      host: target.host,
      port: target.port,
      username: target.username,
      password: target.password,
      readyTimeout: 15_000,
      hostVerifier: (hostKey: Buffer): boolean => {
        const presented = fingerprintOf(hostKey);
        presentedFingerprint = presented;
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
    })
    .catch((err) => {
      if (hostKeyMismatch) {
        const { pinned, presented } = hostKeyMismatch as { pinned: string; presented: string };
        throw new Error(
          `SFTP host key for ${target.host}:${target.port} does not match the one recorded on first connect ` +
            `(expected ${pinned}, got ${presented}). This can mean the server was reinstalled or its key was ` +
            `rotated - or that someone is intercepting the connection. Only continue once you've confirmed the ` +
            `new key with whoever runs the server, then use "Forget host key" in Deploy settings.`,
        );
      }
      throw err;
    });
  return presentedFingerprint;
}

export async function testSftpConnection(target: SftpTarget): Promise<{ fingerprint: string }> {
  const client = new SftpClient();
  try {
    const fingerprint = await connect(client, target);
    const exists = await client.exists(target.remotePath);
    if (exists !== 'd') throw new Error(`Connected, but the remote path ${target.remotePath} is not a folder on the server.`);
    return { fingerprint };
  } finally {
    await client.end().catch(() => {});
  }
}

export async function deployToSftp(zipPath: string, resourceName: string, target: SftpTarget): Promise<string> {
  const staged = await stageResource(zipPath, resourceName);
  const client = new SftpClient();
  try {
    await connect(client, target);
    const remoteResourceDir = `${target.remotePath.replace(/\/$/, '')}/${staged.name}`;
    await client.uploadDir(staged.dir, remoteResourceDir);
    return remoteResourceDir;
  } finally {
    await client.end().catch(() => {});
    staged.cleanup();
  }
}
