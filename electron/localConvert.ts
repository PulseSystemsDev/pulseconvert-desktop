import fs from 'fs';
import path from 'path';
import { classifyFiles, type ClassifiedFiles } from './pipeline/classify';
import { validateAndFixMeta } from './pipeline/metaValidate';
import { addonifyVehicle } from './pipeline/addonify';
import { selectPreferredVariant } from './pipeline/variants';
import { bundleSingleResource } from './pipeline/bundle';
import { extractZip } from './pipeline/unpack';
import { isRawRpf, isRar, is7z, isZip, extractRpf, extractSevenZip, optimizeYtd } from './pipeline/localNative';
import { desktopFetchJson } from './apiClient';

/**
 * Local port of a simplified worker/index.ts convertVehiclePostprocess - the common case only
 * (vehicle category, addon target, "convert" mode). Deliberately scoped for this first pass:
 *   - Nested-archive unwrapping (compressed archive-in-archive, and raw .rpf-in-.rpf) - ported.
 *   - Standalone .ytd optimization for oversized textures - ported (optimizeYtd, via the bundled
 *     rpf-tool). YTD *splitting* (rpf-tool's ytd-split, for a single dictionary near FiveM's own
 *     streaming-asset size target) is NOT ported yet - a real, rarer edge case, tracked as a
 *     known follow-up rather than silently skipped.
 *   - No prop/EUP/weapon/map/ped categories - vehicle only, a deliberate scope line matching how
 *     Phase 1 of the 3D-preview work was scoped, not an oversight.
 * A mod that needs one of the still-missing pieces still converts correctly server-side - this
 * app can always fall back to submitting the URL as a normal job instead of converting locally.
 */

const STREAM_ASSET_TARGET_BYTES = 15 * 1024 * 1024;
const YTD_OPTIMIZATION_CAPS = [2048, 1536, 1024, 768, 512, 384, 256, 192, 128, 64];
const MAX_TEXTURE_SIZE = 1024; // matches the server's own practical FiveM diffuse-texture cap

function isNestedCompressedArchive(filePath: string): boolean {
  try {
    return !isRawRpf(filePath) && (isZip(filePath) || isRar(filePath) || is7z(filePath));
  } catch {
    return false;
  }
}

/** Unwraps an archive-inside-an-archive (a real, not-uncommon gta5-mods.com download shape) -
 *  direct port of worker/pipeline.ts's extractNestedCompressedArchives, same 4-round cap against
 *  a pathological/malicious nesting depth. */
async function extractNestedCompressedArchives(extractedPaths: string[], workDir: string): Promise<{ paths: string[]; fixLog: string[] }> {
  const allPaths = [...extractedPaths];
  const seenPaths = new Set(allPaths.map((p) => path.resolve(p)));
  const processedArchives = new Set<string>();
  const fixLog: string[] = [];
  let pending = allPaths.filter(isNestedCompressedArchive);
  let nestedIndex = 0;

  for (let round = 0; round < 4 && pending.length > 0; round++) {
    const discovered: string[] = [];
    for (const archive of pending) {
      const resolvedArchive = path.resolve(archive);
      if (processedArchives.has(resolvedArchive)) continue;
      processedArchives.add(resolvedArchive);

      const archiveBase = sanitizeResourceName(path.basename(archive, path.extname(archive)));
      const nestedOutDir = path.join(workDir, `nested-archive-${nestedIndex++}-${archiveBase}`);
      try {
        const nestedPaths = isZip(archive) ? await extractZip(archive, nestedOutDir) : await extractSevenZip(archive, nestedOutDir);
        fixLog.push(`Extracted nested archive "${path.basename(archive)}" (${nestedPaths.length} file(s)).`);
        for (const nestedPath of nestedPaths) {
          const resolvedNestedPath = path.resolve(nestedPath);
          if (seenPaths.has(resolvedNestedPath)) continue;
          seenPaths.add(resolvedNestedPath);
          allPaths.push(nestedPath);
          if (isNestedCompressedArchive(nestedPath)) discovered.push(nestedPath);
        }
      } catch (err) {
        fixLog.push(`Warning: could not extract nested archive "${path.basename(archive)}": ${(err as Error).message}`);
      }
    }
    pending = discovered;
  }

  return { paths: allPaths, fixLog };
}

/** Unwraps a raw .rpf nested inside another (already-extracted) .rpf - a separate case from
 *  compressed-archive nesting above, ported from the equivalent loop in worker/index.ts /
 *  worker/catalog-build.ts (both carry an identical inline version of this). */
async function extractNestedRpfs(extractedPaths: string[], workDir: string): Promise<string[]> {
  const allPaths = [...extractedPaths];
  let pendingRpfs = allPaths.filter((p) => path.extname(p).toLowerCase() === '.rpf');
  let nestedIndex = 0;

  for (let round = 0; round < 6 && pendingRpfs.length > 0; round++) {
    const discovered: string[] = [];
    for (const candidate of pendingRpfs) {
      const nestedOutDir = path.join(workDir, `nested-rpf-${nestedIndex++}-${sanitizeResourceName(path.basename(candidate, '.rpf'))}`);
      try {
        await extractRpf(candidate, nestedOutDir);
        const nestedFiles = listFilesRecursive(nestedOutDir);
        allPaths.push(...nestedFiles);
        discovered.push(...nestedFiles.filter((p) => path.extname(p).toLowerCase() === '.rpf'));
      } catch {
        // Not every .rpf-named file is actually a container - a bad/foreign one is silently
        // skipped here, matching the server's own behavior (best-effort discovery, not a
        // required step).
      }
    }
    pendingRpfs = discovered;
  }

  return allPaths;
}

/** Downscales any standalone .ytd whose file size already exceeds FiveM's practical streaming
 *  target - direct port of worker/pipeline.ts's tryOptimizeYtdFiles, scoped to 'oversized-files'
 *  only (not 'all', which the server only does for the explicit performance-profile choice this
 *  app doesn't have a settings toggle for yet - always-on oversized-only optimization is a pure
 *  improvement with no tradeoff, so it isn't gated behind one). */
async function tryOptimizeOversizedYtds(files: ClassifiedFiles, onProgress: (label: string) => void): Promise<string[]> {
  const fixLog: string[] = [];
  const candidates = files.ytd.filter((ytdPath) => {
    try {
      return fs.statSync(ytdPath).size > STREAM_ASSET_TARGET_BYTES;
    } catch {
      return false;
    }
  });

  for (const [idx, ytdPath] of candidates.entries()) {
    onProgress(`Optimizing texture dictionary ${idx + 1}/${candidates.length}: ${path.basename(ytdPath)}`);
    const tmpOut = `${ytdPath}.optimized`;
    try {
      const oldSize = fs.statSync(ytdPath).size;
      const caps = YTD_OPTIMIZATION_CAPS.filter((n) => n <= MAX_TEXTURE_SIZE);
      let finalSize = oldSize;
      let finalCap: number | null = null;
      for (const cap of caps) {
        if (fs.existsSync(tmpOut)) fs.rmSync(tmpOut);
        const newSize = await optimizeYtd(ytdPath, tmpOut, cap);
        if (newSize !== null) {
          fs.renameSync(tmpOut, ytdPath);
          finalSize = newSize;
          finalCap = cap;
        }
        if (finalSize <= STREAM_ASSET_TARGET_BYTES) break;
      }
      if (finalCap !== null) {
        fixLog.push(`Optimized "${path.basename(ytdPath)}" (${oldSize} -> ${finalSize} bytes, max ${finalCap}px).`);
      }
    } catch (err) {
      console.warn('[localConvert] .ytd optimization skipped for', path.basename(ytdPath), (err as Error).message);
      if (fs.existsSync(tmpOut)) fs.rmSync(tmpOut);
    }
  }

  return fixLog;
}

function listFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(full);
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out;
}

function sanitizeResourceName(input: string): string {
  const cleaned = input
    .toLowerCase()
    .replace(/\.(zip|oiv|rpf)$/i, '')
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned.length > 0 ? cleaned.slice(0, 60) : 'converted_vehicle';
}

async function fetchIssuedHashes(): Promise<Set<number>> {
  try {
    const { hashes } = await desktopFetchJson<{ hashes: number[] }>('/api/desktop/issued-hashes');
    return new Set(hashes);
  } catch (err) {
    // Best-effort - a fresh empty set just means this conversion can't detect a collision
    // against something *another* conversion already issued (still checks against the bundled
    // vanilla-vehicle hash list, which needs no network access at all). Never blocks conversion.
    console.warn('[localConvert] could not fetch issued hashes, proceeding without them', err);
    return new Set();
  }
}

async function reportIssuedHash(hash: number, modelName: string): Promise<void> {
  try {
    await desktopFetchJson('/api/desktop/issued-hashes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hash, modelName }),
    });
  } catch (err) {
    console.warn('[localConvert] could not report issued hash - a future conversion elsewhere may collide with this one', err);
  }
}

export interface LocalConvertResult {
  outputZipPath: string;
  resourceName: string;
  fixLog: string[];
}

export async function convertVehicleLocally(
  sourceArchivePath: string,
  workDir: string,
  fallbackTitle: string,
  sourceUrl: string | null,
  onProgress: (label: string) => void,
): Promise<LocalConvertResult> {
  const extractDir = path.join(workDir, 'extracted');

  onProgress('Extracting archive');
  let extractedPaths: string[];
  if (isRawRpf(sourceArchivePath)) {
    await extractRpf(sourceArchivePath, extractDir);
    extractedPaths = listFilesRecursive(extractDir);
  } else if (isRar(sourceArchivePath) || is7z(sourceArchivePath)) {
    extractedPaths = await extractSevenZip(sourceArchivePath, extractDir);
  } else if (isZip(sourceArchivePath)) {
    extractedPaths = await extractZip(sourceArchivePath, extractDir);
  } else {
    throw new Error('Unrecognized archive format - expected .zip, .rar, .7z, .oiv, or a raw .rpf.');
  }

  onProgress('Checking nested archives');
  const fixLog: string[] = [];
  const nestedArchiveResult = await extractNestedCompressedArchives(extractedPaths, workDir);
  extractedPaths = nestedArchiveResult.paths;
  fixLog.push(...nestedArchiveResult.fixLog);
  extractedPaths = await extractNestedRpfs(extractedPaths, workDir);

  onProgress('Checking for alternative install variants');
  const variantResult = selectPreferredVariant(extractDir, extractedPaths);
  extractedPaths = variantResult.paths;
  if (variantResult.note) fixLog.push(variantResult.note);

  onProgress('Classifying files');
  const files: ClassifiedFiles = classifyFiles(extractedPaths);
  if (files.yft.length === 0 && files.meta.vehicles.length === 0) {
    throw new Error('No recognizable vehicle files (.yft, vehicles.meta) were found in this archive - only vehicle mods can be converted locally right now.');
  }

  onProgress('Validating and repairing metadata');
  const { vehicles, fixLog: metaFixLog } = validateAndFixMeta(files, extractDir);
  fixLog.push(...metaFixLog);

  onProgress('Checking for hash collisions');
  const issuedHashes = await fetchIssuedHashes();

  for (const vehicle of vehicles) {
    const result = addonifyVehicle(files, vehicle.modelName, issuedHashes);
    fixLog.push(...result.fixLog);
    if (result.renamed) {
      issuedHashes.add(result.newHash); // so a second vehicle in the same pack can't reuse it
      await reportIssuedHash(result.newHash, result.newName);
    }
  }

  onProgress('Checking texture dictionary sizes');
  fixLog.push(...(await tryOptimizeOversizedYtds(files, onProgress)));

  const resourceName = sanitizeResourceName(fallbackTitle || vehicles[0]?.modelName || 'converted_vehicle');
  onProgress(`Bundling ${resourceName}`);
  const outputZipPath = path.join(workDir, `${resourceName}.zip`);
  await bundleSingleResource(files, outputZipPath, { resourceName, sourceUrl });

  return { outputZipPath, resourceName, fixLog };
}
