import fs from 'fs';
import path from 'path';
import { classifyFiles, type ClassifiedFiles } from './pipeline/classify';
import { validateAndFixMeta } from './pipeline/metaValidate';
import { addonifyVehicle } from './pipeline/addonify';
import { selectPreferredVariant } from './pipeline/variants';
import { bundleSingleResource } from './pipeline/bundle';
import { extractZip } from './pipeline/unpack';
import { isRawRpf, isRar, is7z, isZip, extractRpf, extractSevenZip } from './pipeline/localNative';
import { desktopFetchJson } from './apiClient';
import { optimizeEmbeddedTextures, optimizeYtdFiles, splitYtdFiles } from './optimizeFlow';
import type { ConversionProfile, ConversionTarget } from './types';

/** Local port of the worker's vehicle postprocessor. Both addon/replace targets are supported;
 * preserve always performs lossless YTD splitting/relinking, while performance additionally
 * downscales every standalone YTD and runs the best-effort Blender embedded-texture pass. URL
 * conversion remains vehicle-focused; the broader content categories live in manual Optimize. */

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
async function extractNestedCompressedArchives(
  extractedPaths: string[],
  workDir: string,
  target: ConversionTarget,
): Promise<{ paths: string[]; fixLog: string[] }> {
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
        const variantResult = selectPreferredVariant(nestedOutDir, nestedPaths, target);
        fixLog.push(`Extracted nested archive "${path.basename(archive)}" (${nestedPaths.length} file(s)).`);
        if (variantResult.note) fixLog.push(`${path.basename(archive)}: ${variantResult.note}`);
        for (const nestedPath of variantResult.paths) {
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
async function extractNestedRpfs(
  extractedPaths: string[],
  workDir: string,
  target: ConversionTarget,
): Promise<{ paths: string[]; fixLog: string[] }> {
  const allPaths = [...extractedPaths];
  let pendingRpfs = allPaths.filter((p) => path.extname(p).toLowerCase() === '.rpf');
  let nestedIndex = 0;
  const fixLog: string[] = [];

  for (let round = 0; round < 6 && pendingRpfs.length > 0; round++) {
    const discovered: string[] = [];
    for (const candidate of pendingRpfs) {
      const nestedOutDir = path.join(workDir, `nested-rpf-${nestedIndex++}-${sanitizeResourceName(path.basename(candidate, '.rpf'))}`);
      try {
        await extractRpf(candidate, nestedOutDir);
        const nestedFiles = listFilesRecursive(nestedOutDir);
        const variantResult = selectPreferredVariant(nestedOutDir, nestedFiles, target);
        allPaths.push(...variantResult.paths);
        discovered.push(...variantResult.paths.filter((p) => path.extname(p).toLowerCase() === '.rpf'));
        if (variantResult.note) fixLog.push(`${path.basename(candidate)}: ${variantResult.note}`);
      } catch {
        // Not every .rpf-named file is actually a container - a bad/foreign one is silently
        // skipped here, matching the server's own behavior (best-effort discovery, not a
        // required step).
      }
    }
    pendingRpfs = discovered;
  }

  return { paths: allPaths, fixLog };
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
  onProgress: (label: string, current?: number, total?: number) => void,
  profile: ConversionProfile = 'preserve',
  target: ConversionTarget = 'addon',
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

  const fixLog: string[] = [];
  onProgress('Checking for alternative install variants');
  const variantResult = selectPreferredVariant(extractDir, extractedPaths, target);
  extractedPaths = variantResult.paths;
  if (variantResult.note) fixLog.push(variantResult.note);

  onProgress('Checking nested archives');
  const nestedArchiveResult = await extractNestedCompressedArchives(extractedPaths, workDir, target);
  extractedPaths = nestedArchiveResult.paths;
  fixLog.push(...nestedArchiveResult.fixLog);
  const nestedRpfResult = await extractNestedRpfs(extractedPaths, workDir, target);
  extractedPaths = nestedRpfResult.paths;
  fixLog.push(...nestedRpfResult.fixLog);

  onProgress('Classifying files');
  let files: ClassifiedFiles = classifyFiles(extractedPaths);
  if (files.yft.length === 0 && files.meta.vehicles.length === 0) {
    throw new Error('No recognizable vehicle files (.yft, vehicles.meta) were found in this archive - only vehicle mods can be converted locally right now.');
  }

  onProgress('Validating and repairing metadata');
  const { vehicles, fixLog: metaFixLog, warnings } = validateAndFixMeta(files, extractDir);
  fixLog.push(...metaFixLog, ...warnings.map((warning) => `Warning: ${warning}`));
  if (vehicles.length === 0) {
    throw new Error('No valid vehicle registration could be recovered from this archive.');
  }

  if (target === 'addon') {
    onProgress('Checking for hash collisions');
    const issuedHashes = await fetchIssuedHashes();
    for (const [index, vehicle] of vehicles.entries()) {
      onProgress(`Preparing vehicle ${index + 1}/${vehicles.length}: ${vehicle.modelName}`, index + 1, vehicles.length);
      const result = addonifyVehicle(files, vehicle.modelName, issuedHashes);
      fixLog.push(...result.fixLog);
      if (result.renamed) {
        issuedHashes.add(result.newHash);
        await reportIssuedHash(result.newHash, result.newName);
      }
    }
  } else {
    fixLog.push('Replace mode selected: original model names and metadata references were preserved.');
  }

  const splitResult = await splitYtdFiles(files, onProgress, path.join(workDir, 'ytd-splits'));
  fixLog.push(...splitResult.fixLog);
  if (profile === 'performance') {
    fixLog.push('Performance optimized mode selected: standalone and embedded textures are capped at 1024px.');
    const ytdResult = await optimizeYtdFiles(files, MAX_TEXTURE_SIZE, onProgress, 'all');
    fixLog.push(...ytdResult.fixLog);
    onProgress('Checking embedded model textures');
    const embedded = await optimizeEmbeddedTextures(files, workDir, MAX_TEXTURE_SIZE);
    files = embedded.files;
    fixLog.push(...embedded.fixLog);
  } else if (files.ytd.length > 0) {
    fixLog.push('Preserved original texture resolution; texture dictionaries were only split/relinked for safer FiveM streaming.');
  }

  const resourceName = sanitizeResourceName(fallbackTitle || vehicles[0]?.modelName || 'converted_vehicle');
  onProgress(`Bundling ${resourceName}`);
  const outputZipPath = path.join(workDir, `${resourceName}.zip`);
  await bundleSingleResource(files, outputZipPath, { resourceName, sourceUrl });

  return { outputZipPath, resourceName, fixLog };
}
