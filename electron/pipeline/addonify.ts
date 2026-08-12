import fs from 'fs';
import path from 'path';
import { joaat } from './joaat';
import type { ClassifiedFiles } from './classify';
import vanillaVehicles from './data/vanilla-vehicles.json';

// Name+hash dump of vanilla GTA5 vehicles (DurtyFree/gta-v-data-dumps, vehicles.json, trimmed to
// just [name, hash] pairs). Verified during this project's build: our joaat() reproduces all 921
// of these precomputed hashes exactly, confirming both the data and the hash function are correct.
const VANILLA_HASHES: ReadonlySet<number> = new Set((vanillaVehicles as [string, number][]).map(([, hash]) => hash));
const VANILLA_NAMES_BY_HASH: ReadonlyMap<number, string> = new Map((vanillaVehicles as [string, number][]).map(([name, hash]) => [hash, name]));

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}

export interface HashCollisionCheck {
  hash: number;
  collidesWithVanilla: string | null;
  collidesWithIssued: string | null;
}

/** Checks `modelName`'s JOAAT hash against both collision sources that actually matter, per the
 *  research behind this project (a hash collision makes one vehicle silently inherit the wrong
 *  model/handling/textures) - reported separately, and naming *which* vehicle it collides with,
 *  so callers (e.g. the collision-check tool) can show something actionable, not just a flag.
 *  issuedHashNames is optional since most callers (the actual conversion pipeline) only need the
 *  boolean via hasHashCollision and already have a Set, not a name-carrying Map. */
export function checkHashCollision(
  modelName: string,
  issuedHashes: ReadonlySet<number>,
  issuedHashNames?: ReadonlyMap<number, string>
): HashCollisionCheck {
  const hash = joaat(modelName);
  return {
    hash,
    collidesWithVanilla: VANILLA_NAMES_BY_HASH.get(hash) ?? null,
    collidesWithIssued: issuedHashes.has(hash) ? issuedHashNames?.get(hash) ?? '(unknown)' : null,
  };
}

/** True if `modelName` collides with a vanilla vehicle, or anything in `issuedHashes` (this
 *  service's own previously-issued addon names) - the two collision sources that actually
 *  matter, per the research behind this project (a hash collision makes one vehicle silently
 *  inherit the wrong model/handling/textures). */
export function hasHashCollision(modelName: string, issuedHashes: ReadonlySet<number>): boolean {
  const hash = joaat(modelName);
  return VANILLA_HASHES.has(hash) || issuedHashes.has(hash);
}

/** Generates a unique, collision-free addon model name derived from the original, retrying with
 *  a new random suffix until both vanilla and previously-issued hash sets are clear. */
export function generateUniqueAddonName(baseName: string, issuedHashes: ReadonlySet<number>): string {
  const stem = baseName.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 16) || 'veh';
  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = `${stem}${randomSuffix()}`;
    if (!hasHashCollision(candidate, issuedHashes)) return candidate;
  }
  throw new Error('Could not generate a unique addon model name after 50 attempts.');
}

export interface AddonifyResult {
  renamed: boolean;
  oldName: string;
  newName: string;
  newHash: number;
  fixLog: string[];
}

/**
 * Renames a vehicle from its source model name to a new, unique, collision-free addon name -
 * the standard community technique for converting a "replace" mod (or any mod whose name
 * collides with something else) into a standalone addon, without touching the binary .yft/.ytd
 * at all. The game resolves vehicles by filename + the modelName/txdName text fields in
 * vehicles.meta, not by anything embedded inside the binary resource, so renaming the loose
 * files on disk and rewriting those text references is sufficient (this is exactly what
 * community tools like FrazzIe/addon-model-converter do).
 */
export function addonifyVehicle(
  files: ClassifiedFiles,
  originalModelName: string,
  issuedHashes: ReadonlySet<number>
): AddonifyResult {
  const fixLog: string[] = [];
  const collides = hasHashCollision(originalModelName, issuedHashes);
  if (!collides) {
    return { renamed: false, oldName: originalModelName, newName: originalModelName, newHash: joaat(originalModelName), fixLog };
  }

  const newName = generateUniqueAddonName(originalModelName, issuedHashes);
  const newHash = joaat(newName);
  fixLog.push(
    `Renamed "${originalModelName}" to "${newName}" to avoid a hash collision with an existing vanilla or previously-converted vehicle.`
  );

  renameBinaryFiles(files, originalModelName, newName);
  rewriteMetaReferences(files, originalModelName, newName);

  return { renamed: true, oldName: originalModelName, newName, newHash, fixLog };
}

function renameBinaryFiles(files: ClassifiedFiles, oldName: string, newName: string): void {
  const lowerOld = oldName.toLowerCase();
  for (const arr of [files.yft, files.ytd, files.ydr, files.ycd, files.ybn]) {
    for (let i = 0; i < arr.length; i++) {
      const filePath = arr[i];
      const base = path.basename(filePath);
      if (!base.toLowerCase().startsWith(lowerOld)) continue;
      const renamedBase = newName + base.slice(oldName.length);
      const newPath = path.join(path.dirname(filePath), renamedBase);
      fs.renameSync(filePath, newPath);
      arr[i] = newPath;
    }
  }
}

function renameXmlField(filePath: string, fieldName: string, oldName: string, newName: string): boolean {
  const xml = fs.readFileSync(filePath, 'utf-8');
  const lowerOld = oldName.toLowerCase();
  const re = new RegExp(`(<${fieldName}>)\\s*${lowerOld}\\s*(</${fieldName}>)`, 'gi');
  if (!re.test(xml)) return false;
  const updated = xml.replace(re, `$1${newName}$2`);
  fs.writeFileSync(filePath, updated);
  return true;
}

function rewriteMetaReferences(files: ClassifiedFiles, oldName: string, newName: string): void {
  for (const f of files.meta.vehicles) {
    renameXmlField(f, 'modelName', oldName, newName);
    renameXmlField(f, 'txdName', oldName, newName);
  }
  for (const f of files.meta.carvariations) {
    renameXmlField(f, 'modelName', oldName, newName);
  }
}
