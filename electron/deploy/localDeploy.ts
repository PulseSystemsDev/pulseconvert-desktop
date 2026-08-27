import path from 'path';
import { extractZip } from '../pipeline/unpack';

export async function deployToLocalFolder(zipPath: string, resourceName: string, destinationFolder: string): Promise<string> {

  await extractZip(zipPath, destinationFolder);
  return path.join(destinationFolder, resourceName);
}
