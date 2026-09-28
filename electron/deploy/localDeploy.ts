import fs from 'fs';
import path from 'path';
import { stageResource } from './stage';

export async function deployToLocalFolder(zipPath: string, resourceName: string, destinationFolder: string): Promise<string> {
  if (!fs.existsSync(destinationFolder) || !fs.statSync(destinationFolder).isDirectory()) {
    throw new Error(`The local resources folder does not exist: ${destinationFolder}`);
  }
  const staged = await stageResource(zipPath, resourceName);
  try {
    const destination = path.join(destinationFolder, staged.name);
    fs.cpSync(staged.dir, destination, { recursive: true, force: true });
    return destination;
  } finally {
    staged.cleanup();
  }
}
