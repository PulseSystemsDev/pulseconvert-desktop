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

/** Applies whatever deploy target the user configured (settings, this device only - see
 *  configStore.ts/sftpCredentialsStore.ts) to a freshly converted resource. A no-op returning
 *  `{ deployed: false, mode: 'none' }` when nothing's configured, never an error - auto-deploy is
 *  opt-in. Called after every local conversion (both the manual "Convert" button and a
 *  dashboard-queued convert_and_deploy command), matching "whenever a deploy target is
 *  configured, conversions go straight there" rather than needing a second explicit action. */
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

  // sftp
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
