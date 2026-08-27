import config from '../configStore';
import { loadSftpPassword } from './sftpCredentialsStore';
import { deployToLocalFolder } from './localDeploy';
import { deployToSftp } from './sftpDeploy';

export interface DeployOutcome {
  deployed: boolean;
  mode: 'none' | 'local' | 'sftp';
  destination?: string;
  error?: string;
}

export async function applyConfiguredDeploy(zipPath: string, resourceName: string): Promise<DeployOutcome> {
  const mode = config.get('deployMode');
  if (mode === 'none') return { deployed: false, mode: 'none' };

  if (mode === 'local') {
    const folder = config.get('localDeployFolder');
    if (!folder) return { deployed: false, mode: 'local', error: 'No local deploy folder is configured yet.' };
    try {
      const destination = await deployToLocalFolder(zipPath, resourceName, folder);
      return { deployed: true, mode: 'local', destination };
    } catch (err) {
      return { deployed: false, mode: 'local', error: (err as Error).message };
    }
  }

  const host = config.get('sftpHost');
  const username = config.get('sftpUsername');
  const remotePath = config.get('sftpRemotePath');
  const password = loadSftpPassword();
  if (!host || !username || !remotePath || !password) {
    return { deployed: false, mode: 'sftp', error: 'SFTP deploy is not fully configured yet.' };
  }
  try {
    const destination = await deployToSftp(zipPath, resourceName, { host, port: config.get('sftpPort'), username, password, remotePath });
    return { deployed: true, mode: 'sftp', destination };
  } catch (err) {
    return { deployed: false, mode: 'sftp', error: (err as Error).message };
  }
}
