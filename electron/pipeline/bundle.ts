import fs from 'fs';
import path from 'path';
import yazl from 'yazl';
import type { ClassifiedFiles } from './classify';
import { generateFxManifest, generateServerCfgSnippet, weaponAnimationsDestNames } from './manifest';
import { ensureDir } from './localStorage';

export interface ResourceSourceInfo {
  resourceName: string;
  sourceUrl?: string | null;
  author?: string | null;
  licenseText?: string | null;
}

function readmeFor(info: ResourceSourceInfo): string {
  const lines = [
    `${info.resourceName} - converted for FiveM by Pulse Convert (convert.pulsesystems.dev)`,
    '',
    'This is a personal, on-demand conversion for the person who requested it. It is not',
    'redistributed or hosted by Pulse Convert beyond this one download.',
    '',
  ];
  if (info.sourceUrl) lines.push(`Original source: ${info.sourceUrl}`);
  if (info.author) lines.push(`Original author: ${info.author}`);
  if (info.licenseText) {
    lines.push('', "The original author's license/permission terms (please respect them):", info.licenseText);
  }
  return lines.join('\n') + '\n';
}

function spawnCodesFor(files: ClassifiedFiles): string[] {
  const codes = new Set<string>();
  for (const vehiclesMeta of files.meta.vehicles) {
    const xml = fs.readFileSync(vehiclesMeta, 'utf8');
    for (const match of xml.matchAll(/<modelName>\s*([^<\s]+)\s*<\/modelName>/gi)) {
      codes.add(match[1]);
    }
  }
  return [...codes].sort((a, b) => a.localeCompare(b));
}

export function spawnCodesText(files: ClassifiedFiles, resourceName: string): string {
  const codes = spawnCodesFor(files);
  const lines = [
    `${resourceName} spawn codes`,
    '',
    codes.length > 0
      ? 'Use these exact model names with your vehicle spawner after ensuring this resource.'
      : 'No vehicles.meta modelName entries were found in this resource.',
    '',
    ...codes.map((code) => `- ${code}`),
  ];
  return lines.join('\n') + '\n';
}

/**
 * Assembles one car's converted files into a single resource zip: stream/ for binary assets,
 * data/ for meta files, a generated fxmanifest.lua, and a README crediting the original mod
 * and quoting its license text (transparency, not just generation - the source mod's own
 * license terms travel with the output instead of being silently dropped).
 */
export function bundleSingleResource(
  files: ClassifiedFiles,
  outputZipPath: string,
  info: ResourceSourceInfo
): Promise<void> {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    const root = info.resourceName;

    // Guards against ever writing two zip entries to the same path (which tool happens to "win"
    // on extraction is undefined) - found via a real archive that bundled two alternative variants
    // of the same vehicle, which upstream extraction now dedupes, but this is cheap insurance
    // against any other source of a basename collision.
    const seenStreamNames = new Set<string>();
    const streamFiles = [...files.yft, ...files.ytd, ...files.ydr, ...files.ydd, ...files.ycd, ...files.ybn, ...files.ytyp, ...files.ymap];
    for (const filePath of streamFiles) {
      const name = path.basename(filePath);
      if (seenStreamNames.has(name)) {
        console.warn(`[bundle] Skipping duplicate stream file "${name}" (already added from a different source path).`);
        continue;
      }
      seenStreamNames.add(name);
      zip.addFile(filePath, `${root}/stream/${name}`);
    }

    const metaFileGroups: Array<[string[], string]> = [
      [files.meta.vehicles, 'vehicles.meta'],
      [files.meta.handling, 'handling.meta'],
      [files.meta.carcols, 'carcols.meta'],
      [files.meta.carvariations, 'carvariations.meta'],
      [files.meta.vehiclelayouts, 'vehiclelayouts.meta'],
      [files.meta.weapons, 'weapons.meta'],
      [files.meta.weaponcomponents, 'weaponcomponents.meta'],
      [files.meta.peds, 'peds.meta'],
    ];
    for (const [paths, destName] of metaFileGroups) {
      if (paths.length > 0) {
        zip.addFile(paths[0], `${root}/data/${destName}`);
      }
    }
    // weaponanimations isn't in metaFileGroups above because, unlike the vehicle meta kinds, an
    // archive can legitimately ship more than one (one per game-DLC folder) and every one needs
    // staging, not just the first match - see weaponAnimationsDestNames's doc comment.
    weaponAnimationsDestNames(files.meta.weaponanimations).forEach((destName, i) => {
      zip.addFile(files.meta.weaponanimations[i], `${root}/data/${destName}`);
    });
    // Each SHOP_PED_APPAREL_META_FILE is per-ped/per-DLC (see the shopPedApparel field doc
    // comment in classify.ts) - always staged under its own already-meaningful generated name,
    // never a fixed shared filename.
    for (const apparelPath of files.shopPedApparel) {
      zip.addFile(apparelPath, `${root}/data/${path.basename(apparelPath)}`);
    }

    zip.addBuffer(Buffer.from(generateFxManifest(root, files)), `${root}/fxmanifest.lua`);
    zip.addBuffer(Buffer.from(readmeFor(info)), `${root}/README.txt`);
    // No vehicles.meta modelName entries can exist without files.meta.vehicles - skip the whole
    // file for a weapon-animation resource rather than shipping a "no vehicles found" text file
    // that reads as wrong-flavored, not just empty.
    if (files.meta.vehicles.length > 0) {
      zip.addBuffer(Buffer.from(spawnCodesText(files, root)), `${root}/SPAWN_CODES.txt`);
    }

    ensureDir(path.dirname(outputZipPath));
    zip.outputStream.pipe(fs.createWriteStream(outputZipPath)).on('close', resolve).on('error', reject);
    zip.end();
  });
}

/** Bundles multiple already-built single-resource zips into one parent "pack" zip, plus a
 *  generated server.cfg snippet with an `ensure` line for each included resource. */
export function bundlePack(resourceDirs: { resourceName: string; dir: string }[], outputZipPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();

    for (const { resourceName, dir } of resourceDirs) {
      const addDirRecursive = (current: string, relBase: string) => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
          const full = path.join(current, entry.name);
          const rel = path.posix.join(relBase, entry.name);
          if (entry.isDirectory()) {
            addDirRecursive(full, rel);
          } else {
            zip.addFile(full, rel);
          }
        }
      };
      addDirRecursive(dir, resourceName);
    }

    zip.addBuffer(
      Buffer.from(generateServerCfgSnippet(resourceDirs.map((r) => r.resourceName))),
      'server.cfg.txt'
    );

    ensureDir(path.dirname(outputZipPath));
    zip.outputStream.pipe(fs.createWriteStream(outputZipPath)).on('close', resolve).on('error', reject);
    zip.end();
  });
}

function dataFileTypeFor(name: string): string | null {
  const lower = name.toLowerCase();
  switch (lower) {
    case 'vehiclelayouts.meta':
      return 'VEHICLE_LAYOUTS_FILE';
    case 'handling.meta':
      return 'HANDLING_FILE';
    case 'vehicles.meta':
      return 'VEHICLE_METADATA_FILE';
    case 'carcols.meta':
      return 'CARCOLS_FILE';
    case 'carvariations.meta':
      return 'VEHICLE_VARIATION_FILE';
    default:
      // Matches both the single-file 'weaponanimations.meta' and multi-file
      // 'weaponanimations_<n>.meta' dest names from weaponAnimationsDestNames.
      return /^weaponanimations(_\d+)?\.meta$/.test(lower) ? 'WEAPON_ANIMATIONS_FILE' : null;
  }
}

function combinedFxManifest(resourceName: string, dataFiles: Array<{ type: string; path: string }>): string {
  return `fx_version 'cerulean'
game 'gta5'

author 'Pulse Convert (convert.pulsesystems.dev)'
description '${resourceName} - combined vehicle pack converted by Pulse Convert'

files {
  'stream/**/*',
  'data/**/*.meta',
}

${dataFiles.map((file) => `data_file '${file.type}' '${file.path}'`).join('\n')}
`;
}

/** Bundles a multi-car pack as one FiveM resource. Meta files stay separated under data/<car>/
 *  and are all registered in a single fxmanifest; stream files are placed in one shared stream
 *  folder, with resource-name prefixes only if a filename collision occurs. */
export function bundleCombinedResourcePack(
  resourceDirs: { resourceName: string; dir: string }[],
  outputZipPath: string,
  combinedResourceName: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    const streamNames = new Set<string>();
    const dataFiles: Array<{ type: string; path: string }> = [];

    for (const { resourceName, dir } of resourceDirs) {
      const streamDir = path.join(dir, 'stream');
      if (fs.existsSync(streamDir)) {
        for (const entry of fs.readdirSync(streamDir, { withFileTypes: true })) {
          if (!entry.isFile()) continue;
          const full = path.join(streamDir, entry.name);
          const safeName = streamNames.has(entry.name) ? `${resourceName}_${entry.name}` : entry.name;
          streamNames.add(safeName);
          zip.addFile(full, `${combinedResourceName}/stream/${safeName}`);
        }
      }

      const dataDir = path.join(dir, 'data');
      if (fs.existsSync(dataDir)) {
        for (const entry of fs.readdirSync(dataDir, { withFileTypes: true })) {
          if (!entry.isFile()) continue;
          const type = dataFileTypeFor(entry.name);
          if (!type) continue;
          const rel = `data/${resourceName}/${entry.name}`;
          dataFiles.push({ type, path: rel });
          zip.addFile(path.join(dataDir, entry.name), `${combinedResourceName}/${rel}`);
        }
      }

      const spawnCodesPath = path.join(dir, 'SPAWN_CODES.txt');
      if (fs.existsSync(spawnCodesPath)) {
        zip.addFile(spawnCodesPath, `${combinedResourceName}/SPAWN_CODES/${resourceName}.txt`);
      }
    }

    zip.addBuffer(Buffer.from(combinedFxManifest(combinedResourceName, dataFiles)), `${combinedResourceName}/fxmanifest.lua`);
    zip.addBuffer(Buffer.from(generateServerCfgSnippet([combinedResourceName])), 'server.cfg.txt');

    ensureDir(path.dirname(outputZipPath));
    zip.outputStream.pipe(fs.createWriteStream(outputZipPath)).on('close', resolve).on('error', reject);
    zip.end();
  });
}
