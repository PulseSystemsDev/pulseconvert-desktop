import path from 'path';
import config from '../configStore';
import { loadSftpPassword } from './sftpCredentialsStore';
import { deployToLocalFolder } from './localDeploy';
import { deployToSftp, testSftpConnection } from './sftpDeploy';
import type { DeployOutcome } from '../types';

function sftpTarget() {
  const host = config.get('sftpHost');
  const username = config.get('sftpUsername');
  const remotePath = config.get('sftpRemotePath');
  const password = loadSftpPassword();
  if (!host || !username || !remotePath || !password) return null;
  return { host, port: config.get('sftpPort'), username, password, remotePath };
}

export function resourceNameFor(zipPath: string): string {
  return path.basename(zipPath).replace(/\.zip$/i, '').replace(/ \(\d+\)$/, '').replace(/_(optimized|fixed)$/, '');
}

export async function applyConfiguredDeploy(zipPath: string, resourceName = resourceNameFor(zipPath)): Promise<DeployOutcome> {
  const mode = config.get('deployMode');
  if (mode === 'none') return { deployed: false, mode: 'none' };

  if (mode === 'local') {
    const folder = config.get('localDeployFolder');
    if (!folder) return { deployed: false, mode: 'local', error: 'Pick a local resources folder in Deploy settings first.' };
    try {
      const destination = await deployToLocalFolder(zipPath, resourceName, folder);
      return { deployed: true, mode: 'local', destination };
    } catch (err) {
      return { deployed: false, mode: 'local', error: (err as Error).message };
    }
  }

  const target = sftpTarget();
  if (!target) return { deployed: false, mode: 'sftp', error: 'SFTP deploy is not fully configured yet.' };
  try {
    const destination = await deployToSftp(zipPath, resourceName, target);
    return { deployed: true, mode: 'sftp', destination };
  } catch (err) {
    return { deployed: false, mode: 'sftp', error: (err as Error).message };
  }
}

export async function testConfiguredSftp(): Promise<{ fingerprint: string }> {
  const target = sftpTarget();
  if (!target) throw new Error('Fill in the host, username, password, and remote path first.');
  return testSftpConnection(target);
}
