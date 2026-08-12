import path from 'path';
import { extractZip } from '../pipeline/unpack';

/**
 * Extracts a converted resource zip straight into a folder the user pointed this app at once -
 * typically their FXServer's own resources/ directory, when this desktop app runs on the same
 * machine as the game server. No remote protocol, no credentials - the simplest of the two Phase
 * D deploy paths, and the one with the smallest new attack surface.
 *
 * bundleSingleResource (pipeline/bundle.ts) already zips everything under a top-level
 * `<resourceName>/` entry - extracting into `destinationFolder` directly reproduces that folder
 * name once, correctly. Extracting into `destinationFolder/<resourceName>` (an earlier version of
 * this function did) double-nests it into `.../<resourceName>/<resourceName>/...`, confirmed by
 * actually running this against a real converted zip, not just reasoned about.
 */
export async function deployToLocalFolder(zipPath: string, resourceName: string, destinationFolder: string): Promise<string> {
  // extractZip's own zip-slip guard (pipeline/localStorage.ts's safeJoin) already prevents an
  // entry from escaping destinationFolder - reused as-is here, same as every other place in this
  // app that unpacks a zip.
  await extractZip(zipPath, destinationFolder);
  return path.join(destinationFolder, resourceName);
}
