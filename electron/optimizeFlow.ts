import fs from 'fs';
import path from 'path';
import { runBlenderConvert } from './pipeline/localNative';

export interface OptimizeSummary {
  scanned: number;
  optimized: number;
  fixLog: string[];
}

/**
 * Phase E, scoped: re-runs the same Blender embedded-texture downscale pass every
 * "performance"-profile server conversion already gets (see runBlenderConvert), in place,
 * against every already-converted FiveM resource found directly under the configured deploy
 * folder - not a general "optimize anything anywhere" tool. A resource is recognized by having
 * its own `stream/` subfolder (every bundleSingleResource output has one - see
 * pipeline/bundle.ts), which is enough to find real, already-deployed resources without needing
 * to parse fxmanifest.lua or guess at arbitrary folder layouts.
 */
export async function runLocalOptimize(targetFolder: string, onProgress: (label: string) => void): Promise<OptimizeSummary> {
  if (!fs.existsSync(targetFolder)) {
    throw new Error(`Deploy folder does not exist: ${targetFolder}`);
  }

  const candidates = fs
    .readdirSync(targetFolder, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(targetFolder, entry.name, 'stream')))
    .map((entry) => entry.name);

  const fixLog: string[] = [];
  let optimized = 0;

  for (const [index, resourceName] of candidates.entries()) {
    onProgress(`Optimizing ${resourceName} (${index + 1}/${candidates.length})`);
    const streamDir = path.join(targetFolder, resourceName, 'stream');
    const blenderOutDir = path.join(targetFolder, resourceName, '.pulseconvert-optimize-tmp');
    try {
      const resourceFixLog = await runBlenderConvert(streamDir, blenderOutDir, 1024);
      if (resourceFixLog.length > 0) {
        // runBlenderConvert exports optimized binaries to blenderOutDir rather than modifying
        // streamDir in place (same shape the server's own tryOptimizeTextures relies on) - copy
        // anything it actually touched back over the deployed resource's real stream files.
        for (const file of fs.readdirSync(blenderOutDir)) {
          fs.copyFileSync(path.join(blenderOutDir, file), path.join(streamDir, file));
        }
        optimized++;
        fixLog.push(`${resourceName}: ${resourceFixLog.join('; ')}`);
      }
    } catch (err) {
      fixLog.push(`${resourceName}: skipped (${(err as Error).message})`);
    } finally {
      fs.rmSync(blenderOutDir, { recursive: true, force: true });
    }
  }

  return { scanned: candidates.length, optimized, fixLog };
}
