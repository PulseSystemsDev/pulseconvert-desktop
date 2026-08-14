import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import yazl from 'yazl';
import config from './configStore';
import { bundleSingleResource } from './pipeline/bundle';
import { classifyFiles, type ClassifiedFiles } from './pipeline/classify';
import { MAX_ARCHIVE_ENTRIES, MAX_DECOMPRESSED_BYTES } from './pipeline/localConstants';
import {
  extractRpf,
  extractSevenZip,
  is7z,
  isRar,
  isRawRpf,
  isZip,
  optimizeYtd,
  runBlenderConvert,
  splitYtd,
} from './pipeline/localNative';
import { extractZip } from './pipeline/unpack';
import { validateAndFixMeta } from './pipeline/metaValidate';
import type {
  OptimizeCategory,
  OptimizeQuality,
  OptimizeRequest,
  OptimizeResult,
  OversizedYtd,
} from './types';

export const STREAM_ASSET_TARGET_BYTES = 15 * 1024 * 1024;
const YTD_OPTIMIZATION_CAPS = [2048, 1536, 1024, 768, 512, 384, 256, 192, 128, 64];
const STREAM_EXTENSIONS = new Set(['.ytd', '.yft', '.ydr', '.ydd']);
const MAX_TEXTURE_SIZE_BY_QUALITY: Record<OptimizeQuality, number> = {
  balanced: 2048,
  performance: 1024,
  aggressive: 512,
};

export type OptimizationProgress = (label: string, current?: number, total?: number) => void;

interface ChangeResult {
  fixLog: string[];
  optimizedCount: number;
}

interface YtdSplitInfo {
  originalStem: string;
  childStems: string[];
}

function listFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push(full);
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out;
}

function copyDirectorySafely(sourceDir: string, destDir: string): void {
  let entryCount = 0;
  let totalBytes = 0;
  const walk = (source: string, dest: string) => {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      entryCount += 1;
      if (entryCount > MAX_ARCHIVE_ENTRIES) {
        throw new Error(`Folder contains more than ${MAX_ARCHIVE_ENTRIES} entries; refusing to process it.`);
      }
      const sourcePath = path.join(source, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        walk(sourcePath, destPath);
      } else if (entry.isFile()) {
        totalBytes += fs.statSync(sourcePath).size;
        if (totalBytes > MAX_DECOMPRESSED_BYTES) {
          throw new Error('Folder is larger than the 4 GiB local-processing safety limit.');
        }
        fs.copyFileSync(sourcePath, destPath);
      }
    }
  };
  walk(sourceDir, destDir);
}

function sanitizeResourceName(input: string): string {
  const cleaned = input
    .toLowerCase()
    .replace(/\.(zip|rar|7z|oiv|rpf|ytd|yft|ydr|ydd)$/i, '')
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned.length > 0 ? cleaned.slice(0, 60) : 'optimized_resource';
}

function fileSize(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function streamPaths(files: ClassifiedFiles): string[] {
  return [...files.yft, ...files.ytd, ...files.ydr, ...files.ydd, ...files.ycd, ...files.ybn];
}

function streamBytes(files: ClassifiedFiles): number {
  return streamPaths(files).reduce((sum, filePath) => sum + fileSize(filePath), 0);
}

function assertPreparedSafety(paths: string[]): void {
  const uniqueFiles = [...new Set(paths.map((filePath) => path.resolve(filePath)))];
  if (uniqueFiles.length > MAX_ARCHIVE_ENTRIES) {
    throw new Error(`Expanded input contains more than ${MAX_ARCHIVE_ENTRIES} files; refusing to process it.`);
  }
  let totalBytes = 0;
  for (const filePath of uniqueFiles) {
    totalBytes += fileSize(filePath);
    if (totalBytes > MAX_DECOMPRESSED_BYTES) {
      throw new Error('Expanded input exceeds the 4 GiB local-processing safety limit.');
    }
  }
}

function removeIfExists(target: string): void {
  if (!fs.existsSync(target)) return;
  const stat = fs.lstatSync(target);
  if (stat.isDirectory() && !stat.isSymbolicLink()) fs.rmSync(target, { recursive: true, force: true });
  else fs.rmSync(target, { force: true });
}

function removeOptimizeWorkDir(workDir: string): void {
  const base = path.resolve(app.getPath('temp'), 'pulseconvert-desktop');
  const resolved = path.resolve(workDir);
  if (resolved.startsWith(base + path.sep)) removeIfExists(resolved);
}

function xmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function relationshipItem(parent: string, child: string): string {
  return `    <Item>\n      <parent>${xmlText(parent)}</parent>\n      <child>${xmlText(child)}</child>\n    </Item>\n`;
}

/** Relinks vehicles.meta to the final dictionary in each newly split texture chain. */
export function applyYtdSplitRelationships(files: ClassifiedFiles, splits: YtdSplitInfo[]): void {
  if (splits.length === 0) return;
  for (const vehiclesMetaPath of files.meta.vehicles) {
    let xml = fs.readFileSync(vehiclesMetaPath, 'utf8');
    let relationships = '';
    for (const split of splits) {
      if (split.childStems.length === 0) continue;
      const finalDictionary = split.childStems[split.childStems.length - 1];
      const txdPattern = new RegExp(`<txdName>\\s*${escapeRegExp(split.originalStem)}\\s*</txdName>`, 'gi');
      xml = xml.replace(txdPattern, `<txdName>${xmlText(finalDictionary)}</txdName>`);
      let parent = split.originalStem;
      for (const child of split.childStems) {
        relationships += relationshipItem(parent, child);
        parent = child;
      }
    }
    if (!relationships) continue;
    if (xml.includes('</txdRelationships>')) {
      xml = xml.replace('</txdRelationships>', `${relationships}  </txdRelationships>`);
    } else {
      xml = xml.replace(
        '</CVehicleModelInfo__InitDataList>',
        `  <txdRelationships>\n${relationships}  </txdRelationships>\n</CVehicleModelInfo__InitDataList>`,
      );
    }
    fs.writeFileSync(vehiclesMetaPath, xml);
  }
}

export async function splitYtdFiles(
  files: ClassifiedFiles,
  reportProgress: OptimizationProgress,
  splitRoot: string,
): Promise<ChangeResult> {
  const fixLog: string[] = [];
  const splits: YtdSplitInfo[] = [];
  const originals = [...files.ytd];
  let optimizedCount = 0;

  if (originals.length > 0 && files.meta.vehicles.length === 0) {
    return {
      fixLog: ['Skipped lossless YTD splitting because this resource has no vehicles.meta relationship carrier; texture downscaling remains enabled.'],
      optimizedCount: 0,
    };
  }

  for (const [index, ytdPath] of originals.entries()) {
    reportProgress(`Splitting texture dictionaries ${index + 1}/${originals.length}: ${path.basename(ytdPath)}`, index + 1, originals.length);
    const splitDir = path.join(splitRoot, String(index));
    try {
      removeIfExists(splitDir);
      const splitPaths = await splitYtd(ytdPath, splitDir, STREAM_ASSET_TARGET_BYTES);
      if (!splitPaths) continue;
      const committedPaths: string[] = [];
      const stagedPaths: Array<{ staged: string; destination: string }> = [];
      for (const splitPath of splitPaths) {
        const destination = path.join(path.dirname(ytdPath), path.basename(splitPath));
        const staged = `${destination}.pulseconvert-new`;
        removeIfExists(staged);
        fs.copyFileSync(splitPath, staged);
        stagedPaths.push({ staged, destination });
      }
      for (const { staged, destination } of stagedPaths) {
        removeIfExists(destination);
        fs.renameSync(staged, destination);
        committedPaths.push(destination);
      }
      const originalIndex = files.ytd.indexOf(ytdPath);
      if (originalIndex !== -1) files.ytd.splice(originalIndex, 1, ...committedPaths);
      const originalStem = path.basename(ytdPath, path.extname(ytdPath));
      const childStems = committedPaths.slice(1).map((filePath) => path.basename(filePath, path.extname(filePath)));
      splits.push({ originalStem, childStems });
      optimizedCount += 1;
      const sizes = committedPaths.map((filePath) => `${path.basename(filePath)} ${(fileSize(filePath) / 1024 / 1024).toFixed(1)} MiB`);
      fixLog.push(`Split "${path.basename(ytdPath)}" into ${committedPaths.length} texture dictionaries without downscaling (${sizes.join(', ')}).`);
      removeIfExists(splitDir);
    } catch (err) {
      removeIfExists(splitDir);
      fixLog.push(`Warning: could not split "${path.basename(ytdPath)}": ${(err as Error).message}`);
    }
  }

  applyYtdSplitRelationships(files, splits);
  return { fixLog, optimizedCount };
}

export async function optimizeYtdFiles(
  files: ClassifiedFiles,
  maxTextureSize: number,
  reportProgress: OptimizationProgress,
  scope: 'oversized-files' | 'all' = 'all',
): Promise<ChangeResult> {
  const candidates = scope === 'all' ? [...files.ytd] : files.ytd.filter((filePath) => fileSize(filePath) > STREAM_ASSET_TARGET_BYTES);
  const fixLog: string[] = [];
  let optimizedCount = 0;

  for (const [index, ytdPath] of candidates.entries()) {
    reportProgress(`Optimizing texture dictionary ${index + 1}/${candidates.length}: ${path.basename(ytdPath)}`, index + 1, candidates.length);
    const tmpOut = `${ytdPath}.optimized`;
    try {
      const oldSize = fileSize(ytdPath);
      const caps = [...new Set(YTD_OPTIMIZATION_CAPS.filter((size) => size <= maxTextureSize))];
      if (caps.length === 0) caps.push(64);
      let finalSize = oldSize;
      let finalCap: number | null = null;
      for (const cap of caps) {
        removeIfExists(tmpOut);
        const newSize = await optimizeYtd(ytdPath, tmpOut, cap);
        if (newSize !== null) {
          fs.copyFileSync(tmpOut, ytdPath);
          removeIfExists(tmpOut);
          finalSize = newSize;
          finalCap = cap;
        }
        if (finalSize <= STREAM_ASSET_TARGET_BYTES) break;
      }
      if (finalCap === null) {
        if (oldSize > STREAM_ASSET_TARGET_BYTES) {
          fixLog.push(`Warning: "${path.basename(ytdPath)}" is ${(oldSize / 1024 / 1024).toFixed(1)} MiB and had no textures above the optimizer limit to shrink.`);
        }
        continue;
      }
      optimizedCount += 1;
      fixLog.push(`Optimized textures in "${path.basename(ytdPath)}" (${oldSize} -> ${finalSize} bytes, max ${finalCap}px).`);
      if (finalSize > STREAM_ASSET_TARGET_BYTES) {
        fixLog.push(`Warning: "${path.basename(ytdPath)}" is still ${(finalSize / 1024 / 1024).toFixed(1)} MiB after optimization.`);
      }
    } catch (err) {
      removeIfExists(tmpOut);
      fixLog.push(`Warning: texture optimization skipped for "${path.basename(ytdPath)}": ${(err as Error).message}`);
    }
  }
  return { fixLog, optimizedCount };
}

function commitOptimizedBinaries(original: ClassifiedFiles, optimized: ClassifiedFiles): string[] {
  const warnings: string[] = [];
  const groups: Array<[string[], string[]]> = [
    [original.yft, optimized.yft],
    [original.ydr, optimized.ydr],
    [original.ydd, optimized.ydd],
    [original.ycd, optimized.ycd],
    [original.ybn, optimized.ybn],
  ];
  for (const [originalPaths, optimizedPaths] of groups) {
    const originalsByName = new Map<string, string>();
    for (const filePath of originalPaths) originalsByName.set(path.basename(filePath).toLowerCase(), filePath);
    for (const optimizedPath of optimizedPaths) {
      const destination = originalsByName.get(path.basename(optimizedPath).toLowerCase());
      if (!destination) {
        warnings.push(`Warning: Blender emitted unexpected file "${path.basename(optimizedPath)}"; it was not added because no original path matched.`);
        continue;
      }
      const staged = `${destination}.pulseconvert-new`;
      removeIfExists(staged);
      fs.copyFileSync(optimizedPath, staged);
      removeIfExists(destination);
      fs.renameSync(staged, destination);
    }
  }
  return warnings;
}

export async function optimizeEmbeddedTextures(
  files: ClassifiedFiles,
  workDir: string,
  maxTextureSize: number,
): Promise<{ files: ClassifiedFiles; fixLog: string[]; optimizedCount: number }> {
  const inputDir = path.join(workDir, 'blender-input');
  const outputDir = path.join(workDir, 'blender-output');
  fs.mkdirSync(inputDir, { recursive: true });
  const importable = [...files.yft, ...files.ydr, ...files.ydd, ...files.ybn, ...files.ycd];
  const nameCounts = new Map<string, number>();
  for (const filePath of importable) {
    const name = path.basename(filePath).toLowerCase();
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  }
  const warnings = [...nameCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([name]) => `Warning: embedded texture pass skipped duplicate basename "${name}" to preserve each original file.`);
  const usedNames = new Set<string>();
  for (const filePath of importable) {
    const base = path.basename(filePath);
    if ((nameCounts.get(base.toLowerCase()) ?? 0) > 1) continue;
    if (usedNames.has(base)) continue;
    usedNames.add(base);
    fs.copyFileSync(filePath, path.join(inputDir, base));
  }
  if (usedNames.size === 0) return { files, fixLog: warnings, optimizedCount: 0 };

  try {
    const fixLog = await runBlenderConvert(inputDir, outputDir, maxTextureSize);
    if (fixLog.length === 0) return { files, fixLog: warnings, optimizedCount: 0 };
    const optimized = classifyFiles(listFilesRecursive(outputDir));
    const commitWarnings = commitOptimizedBinaries(files, optimized);
    return { files, fixLog: [...warnings, ...fixLog, ...commitWarnings], optimizedCount: fixLog.length };
  } catch (err) {
    return {
      files,
      fixLog: [...warnings, `Warning: embedded model texture pass was skipped: ${(err as Error).message}`],
      optimizedCount: 0,
    };
  }
}

export function buildOptimizationReport(files: ClassifiedFiles): { totalStreamBytes: number; oversizedYtd: OversizedYtd[]; fixLog: string[] } {
  const totalStreamBytes = streamBytes(files);
  const oversizedYtd = files.ytd
    .map((filePath) => ({ name: path.basename(filePath), bytes: fileSize(filePath) }))
    .filter((item) => item.bytes > STREAM_ASSET_TARGET_BYTES);
  const fixLog = [
    `Rescanned after optimization: ${(totalStreamBytes / 1024 / 1024).toFixed(1)} MiB total across ${streamPaths(files).length} streamed file(s).`,
  ];
  if (oversizedYtd.length > 0) {
    fixLog.push(`Warning: ${oversizedYtd.length} texture dictionary(ies) remain above 15 MiB: ${oversizedYtd.map((item) => `${item.name} (${(item.bytes / 1024 / 1024).toFixed(1)} MiB)`).join(', ')}.`);
  } else if (files.ytd.length > 0) {
    fixLog.push('Every texture dictionary is under the 15 MiB streaming-memory target.');
  }
  return { totalStreamBytes, oversizedYtd, fixLog };
}

async function prepareInput(request: OptimizeRequest, extractDir: string): Promise<string[]> {
  if (request.inputKind === 'folder') {
    copyDirectorySafely(request.inputPath, extractDir);
    return listFilesRecursive(extractDir);
  }
  if (request.inputKind === 'file') {
    const extension = path.extname(request.inputPath).toLowerCase();
    if (!STREAM_EXTENSIONS.has(extension)) throw new Error('Standalone optimization supports .ytd, .yft, .ydr, and .ydd files.');
    fs.mkdirSync(extractDir, { recursive: true });
    const destination = path.join(extractDir, path.basename(request.inputPath));
    fs.copyFileSync(request.inputPath, destination);
    return [destination];
  }

  if (isRawRpf(request.inputPath)) {
    await extractRpf(request.inputPath, extractDir);
    return listFilesRecursive(extractDir);
  }
  if (isRar(request.inputPath) || is7z(request.inputPath)) return extractSevenZip(request.inputPath, extractDir);
  if (isZip(request.inputPath)) return extractZip(request.inputPath, extractDir);
  throw new Error('Unrecognized archive format; expected ZIP, RAR, 7z, OIV, or RPF.');
}

function nestedContainerWarnings(paths: string[]): string[] {
  const nestedContainers = paths.filter((filePath) => {
    if (path.extname(filePath).toLowerCase() === '.rpf') return true;
    try {
      return isZip(filePath) || isRar(filePath) || is7z(filePath);
    } catch {
      return false;
    }
  });
  if (nestedContainers.length === 0) return [];

  const names = nestedContainers.slice(0, 5).map((filePath) => `"${path.basename(filePath)}"`);
  const remainder = nestedContainers.length - names.length;
  return [
    `Skipped ${nestedContainers.length} nested container(s) so they remain byte-for-byte intact; safely rebuilding nested RPF/RAR/7z/ZIP files is not supported yet (${names.join(', ')}${remainder > 0 ? ` and ${remainder} more` : ''}).`,
  ];
}

function outputFolder(): string {
  return config.get('outputFolder') || path.join(app.getPath('documents'), 'PulseConvert');
}

function uniqueOutputPath(resourceName: string): string {
  const folder = outputFolder();
  fs.mkdirSync(folder, { recursive: true });
  const base = `${resourceName}_optimized`;
  let candidate = path.join(folder, `${base}.zip`);
  let suffix = 2;
  while (fs.existsSync(candidate)) candidate = path.join(folder, `${base}_${suffix++}.zip`);
  return candidate;
}

function bundlePreservingTree(sourceDir: string, outputZipPath: string, rootPrefix: string | null): Promise<void> {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    let settled = false;
    const finishError = (err: Error) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    for (const filePath of listFilesRecursive(sourceDir)) {
      const relative = path.relative(sourceDir, filePath);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) continue;
      const archivePath = path.posix.join(rootPrefix ?? '', ...relative.split(path.sep));
      zip.addFile(filePath, archivePath);
    }
    fs.mkdirSync(path.dirname(outputZipPath), { recursive: true });
    const output = fs.createWriteStream(outputZipPath);
    output.once('error', finishError);
    zip.outputStream.once('error', finishError);
    output.once('close', () => {
      if (settled) return;
      settled = true;
      resolve();
    });
    zip.outputStream.pipe(output);
    zip.end();
  });
}

function assertOptimizableContent(files: ClassifiedFiles, category: OptimizeCategory, hasNestedContainers: boolean): void {
  if (streamPaths(files).length === 0) {
    if (hasNestedContainers) {
      throw new Error('This input has optimizable assets only inside nested containers. Extract the resource or nested archive first, then optimize the extracted folder.');
    }
    throw new Error('No optimizable .ytd/.yft/.ydr/.ydd stream files were found in this input.');
  }
  if (category === 'textures' && files.ytd.length === 0) {
    if (hasNestedContainers) {
      throw new Error('No direct .ytd texture dictionary was found; the texture assets appear to be inside nested containers. Extract them first, then optimize the extracted folder.');
    }
    throw new Error('Texture optimization needs at least one standalone .ytd texture dictionary.');
  }
}

function restoreCategorySpecificFiles(files: ClassifiedFiles, category: OptimizeCategory): void {
  if (category !== 'clothing') return;
  const apparelFiles = files.other.filter((filePath) => {
    if (path.extname(filePath).toLowerCase() !== '.meta') return false;
    try {
      return /<ShopPedApparel\b/i.test(fs.readFileSync(filePath, 'utf8'));
    } catch {
      return false;
    }
  });
  if (apparelFiles.length === 0) return;
  files.shopPedApparel.push(...apparelFiles);
  const apparelSet = new Set(apparelFiles);
  files.other = files.other.filter((filePath) => !apparelSet.has(filePath));
}

function snapshotMeta(files: ClassifiedFiles): ClassifiedFiles['meta'] {
  return {
    vehicles: [...files.meta.vehicles],
    handling: [...files.meta.handling],
    carcols: [...files.meta.carcols],
    carvariations: [...files.meta.carvariations],
    vehiclelayouts: [...files.meta.vehiclelayouts],
    weaponanimations: [...files.meta.weaponanimations],
    weapons: [...files.meta.weapons],
    weaponcomponents: [...files.meta.weaponcomponents],
    peds: [...files.meta.peds],
  };
}

function commitValidatedMetadata(
  files: ClassifiedFiles,
  original: ClassifiedFiles['meta'],
  extractDir: string,
): string[] {
  const fixLog: string[] = [];
  const canonicalNames: Partial<Record<keyof ClassifiedFiles['meta'], string>> = {
    vehicles: 'vehicles.meta',
    handling: 'handling.meta',
    carcols: 'carcols.meta',
    carvariations: 'carvariations.meta',
    vehiclelayouts: 'vehiclelayouts.meta',
  };
  const defaultDataDir = original.vehicles[0] ? path.dirname(original.vehicles[0]) : path.join(extractDir, 'data');
  for (const key of Object.keys(canonicalNames) as Array<keyof ClassifiedFiles['meta']>) {
    const generated = files.meta[key][0];
    if (original[key].length > 1) {
      // A source manifest may declare every metadata file by its original relative path. Moving a
      // merged validator result to one canonical filename would leave those declarations dangling.
      // Keep the copied source files and any safe in-place edits; the merged scratch artifact stays
      // outside extractDir and therefore cannot leak into the output ZIP.
      files.meta[key] = [...original[key]];
      fixLog.push(`Kept ${original[key].length} original ${canonicalNames[key]} paths instead of consolidating them, preserving existing manifest declarations.`);
      continue;
    }
    if (!generated) {
      files.meta[key] = [...original[key]];
      if (original[key].length > 0) fixLog.push(`Kept the original ${canonicalNames[key]} because validation produced no safe replacement.`);
      continue;
    }
    const destination = original[key][0] ?? path.join(defaultDataDir, canonicalNames[key]!);
    if (path.resolve(generated) !== path.resolve(destination)) {
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      const staged = `${destination}.pulseconvert-new`;
      removeIfExists(staged);
      fs.copyFileSync(generated, staged);
      removeIfExists(destination);
      fs.renameSync(staged, destination);
    }
    files.meta[key] = [destination];
  }
  return fixLog;
}

/** Manual, non-destructive optimizer. The source is copied/extracted before any mutation. */
export async function runManualOptimize(request: OptimizeRequest, reportProgress: OptimizationProgress): Promise<OptimizeResult> {
  const sessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const workDir = path.join(app.getPath('temp'), 'pulseconvert-desktop', `optimize-${sessionId}`);
  const extractDir = path.join(workDir, 'extracted');
  const resourceName = sanitizeResourceName(path.basename(request.inputPath));
  const fixLog: string[] = [];
  let optimizedCount = 0;

  try {
    reportProgress('Preparing a safe working copy');
    let preparedPaths = await prepareInput(request, extractDir);
    assertPreparedSafety(preparedPaths);
    const nestedWarnings = request.inputKind === 'file' ? [] : nestedContainerWarnings(preparedPaths);
    fixLog.push(...nestedWarnings);
    let files = classifyFiles(preparedPaths.length > 0 ? preparedPaths : listFilesRecursive(extractDir));
    restoreCategorySpecificFiles(files, request.category);
    assertOptimizableContent(files, request.category, nestedWarnings.length > 0);
    const beforeBytes = streamBytes(files);
    const scannedCount = streamPaths(files).length;

    if (request.category === 'vehicles' && files.meta.vehicles.length > 0) {
      reportProgress('Re-checking vehicle metadata');
      const originalMeta = snapshotMeta(files);
      const metadataWorkDir = path.join(workDir, 'metadata-validation');
      fs.mkdirSync(metadataWorkDir, { recursive: true });
      const validation = validateAndFixMeta(files, metadataWorkDir);
      fixLog.push(...validation.fixLog, ...validation.warnings.map((warning) => `Warning: ${warning}`));
      if (validation.vehicles.length === 0) throw new Error('No valid vehicle registration could be recovered from this resource.');
      fixLog.push(...commitValidatedMetadata(files, originalMeta, extractDir));
    }

    const split = await splitYtdFiles(files, reportProgress, path.join(workDir, 'ytd-splits'));
    fixLog.push(...split.fixLog);
    optimizedCount += split.optimizedCount;

    const ytd = await optimizeYtdFiles(files, MAX_TEXTURE_SIZE_BY_QUALITY[request.quality], reportProgress, 'all');
    fixLog.push(...ytd.fixLog);
    optimizedCount += ytd.optimizedCount;

    if (request.category !== 'textures') {
      reportProgress('Checking embedded model textures');
      const embedded = await optimizeEmbeddedTextures(files, workDir, MAX_TEXTURE_SIZE_BY_QUALITY[request.quality]);
      files = embedded.files;
      fixLog.push(...embedded.fixLog);
      optimizedCount += embedded.optimizedCount;
    }

    const report = buildOptimizationReport(files);
    fixLog.push(...report.fixLog);
    const afterBytes = report.totalStreamBytes;
    const outputZipPath = uniqueOutputPath(resourceName);
    reportProgress(`Bundling ${resourceName}`);
    try {
      if (request.inputKind === 'file') {
        await bundleSingleResource(files, outputZipPath, { resourceName });
      } else {
        // Existing archives/resources may contain scripts, manifests, licenses, custom configs,
        // and arbitrary subdirectories. Zip the complete isolated tree so optimization only
        // overlays changed assets and never strips content it does not understand.
        await bundlePreservingTree(extractDir, outputZipPath, request.inputKind === 'folder' ? resourceName : null);
      }
    } catch (err) {
      removeIfExists(outputZipPath);
      throw err;
    }
    const savedBytes = beforeBytes - afterBytes;
    return {
      outputZipPath,
      resourceName,
      category: request.category,
      quality: request.quality,
      beforeBytes,
      afterBytes,
      savedBytes,
      reductionPercent: beforeBytes > 0 ? Number(((savedBytes / beforeBytes) * 100).toFixed(1)) : 0,
      scannedCount,
      optimizedCount,
      fixLog,
      totalStreamBytes: report.totalStreamBytes,
      oversizedYtd: report.oversizedYtd,
    };
  } finally {
    removeOptimizeWorkDir(workDir);
  }
}

export interface LocalOptimizeSummary {
  scanned: number;
  optimized: number;
  fixLog: string[];
  outputs: OptimizeResult[];
}

function detectResourceCategory(resourceFolder: string): OptimizeCategory {
  const files = classifyFiles(listFilesRecursive(resourceFolder));
  if (files.meta.vehicles.length > 0 || files.yft.length > 0) return 'vehicles';
  if (files.ydd.length > 0) return 'clothing';
  if (files.ydr.length > 0) return 'props';
  return 'textures';
}

/** Dashboard-command entry point. Each deployed resource receives its own non-destructive ZIP;
 *  unrelated resources are never flattened into one bundle and deployed sources stay untouched. */
export async function runLocalOptimize(targetFolder: string, onProgress: OptimizationProgress): Promise<LocalOptimizeSummary> {
  if (!fs.existsSync(targetFolder) || !fs.statSync(targetFolder).isDirectory()) {
    throw new Error(`Deploy folder does not exist: ${targetFolder}`);
  }
  const targetIsResource = fs.existsSync(path.join(targetFolder, 'stream'));
  const candidates = targetIsResource
    ? [targetFolder]
    : fs.readdirSync(targetFolder, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && fs.existsSync(path.join(targetFolder, entry.name, 'stream')))
        .map((entry) => path.join(targetFolder, entry.name));
  const outputs: OptimizeResult[] = [];
  const fixLog: string[] = [];

  for (const [index, resourceFolder] of candidates.entries()) {
    const resourceLabel = path.basename(resourceFolder);
    onProgress(`Optimizing ${resourceLabel} (${index + 1}/${candidates.length})`, index + 1, candidates.length);
    try {
      const category = detectResourceCategory(resourceFolder);
      const result = await runManualOptimize(
        { inputPath: resourceFolder, inputKind: 'folder', category, quality: 'performance' },
        (label, current, total) => onProgress(`${resourceLabel}: ${label}`, current, total),
      );
      outputs.push(result);
      fixLog.push(...result.fixLog.map((line) => `${resourceLabel}: ${line}`));
    } catch (err) {
      fixLog.push(`${resourceLabel}: skipped (${(err as Error).message})`);
    }
  }

  return { scanned: candidates.length, optimized: outputs.length, fixLog, outputs };
}
