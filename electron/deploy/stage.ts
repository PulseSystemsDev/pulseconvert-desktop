import fs from 'fs';
import os from 'os';
import path from 'path';
import { extractZip } from '../pipeline/unpack';

export interface StagedResource {
  dir: string;
  name: string;
  cleanup: () => void;
}

export async function stageResource(zipPath: string, resourceName: string): Promise<StagedResource> {
  const root = path.join(os.tmpdir(), 'pulseconvert-desktop-deploy', `${resourceName}-${Date.now()}`);
  const cleanup = () => fs.rmSync(root, { recursive: true, force: true });
  try {
    await extractZip(zipPath, root);
    const expected = path.join(root, resourceName);
    if (fs.existsSync(expected) && fs.statSync(expected).isDirectory()) return { dir: expected, name: resourceName, cleanup };

    const entries = fs.readdirSync(root, { withFileTypes: true }).filter((entry) => !entry.isSymbolicLink());
    if (entries.length === 1 && entries[0].isDirectory()) {
      return { dir: path.join(root, entries[0].name), name: entries[0].name, cleanup };
    }
    return { dir: root, name: resourceName, cleanup };
  } catch (err) {
    cleanup();
    throw err;
  }
}
