import path from 'path';
import type { ClassifiedFiles } from './classify';

/** Weapon-anim archives can legitimately contain more than one weaponanimations.meta (e.g. one
 *  per game-DLC folder in a singleplayer-compatibility-style pack) - unlike the vehicle meta
 *  buckets (which only ever take the first match), every one needs to be staged and registered.
 *  Kept flat, no subdirectories, so bundleCombinedResourcePack's non-recursive data/ dir scan and
 *  dataFileTypeFor's basename lookup (both in bundle.ts) keep working unmodified. */
export function weaponAnimationsDestNames(paths: string[]): string[] {
  if (paths.length <= 1) return paths.map(() => 'weaponanimations.meta');
  return paths.map((_, i) => `weaponanimations_${i + 1}.meta`);
}

/**
 * Generates fxmanifest.lua with `data_file` entries in the order that actually matters:
 * vehiclelayouts.meta and handling.meta must be registered before vehicles.meta. Layouts loaded
 * late can crash clients on entry, and handling loaded late makes FiveM fall back to ADDER while
 * parsing each vehicle registration.
 */
export function generateFxManifest(resourceName: string, files: ClassifiedFiles): string {
  const dataFileLines: string[] = [];

  if (files.meta.vehiclelayouts.length > 0) {
    dataFileLines.push(`data_file 'VEHICLE_LAYOUTS_FILE' 'data/vehiclelayouts.meta'`);
  }
  if (files.meta.handling.length > 0) {
    dataFileLines.push(`data_file 'HANDLING_FILE' 'data/handling.meta'`);
  }
  if (files.meta.vehicles.length > 0) {
    dataFileLines.push(`data_file 'VEHICLE_METADATA_FILE' 'data/vehicles.meta'`);
  }
  if (files.meta.carcols.length > 0) {
    dataFileLines.push(`data_file 'CARCOLS_FILE' 'data/carcols.meta'`);
  }
  if (files.meta.carvariations.length > 0) {
    dataFileLines.push(`data_file 'VEHICLE_VARIATION_FILE' 'data/carvariations.meta'`);
  }
  for (const destName of weaponAnimationsDestNames(files.meta.weaponanimations)) {
    dataFileLines.push(`data_file 'WEAPON_ANIMATIONS_FILE' 'data/${destName}'`);
  }
  if (files.meta.weapons.length > 0) {
    dataFileLines.push(`data_file 'WEAPONINFO_FILE' 'data/weapons.meta'`);
  }
  if (files.meta.weaponcomponents.length > 0) {
    dataFileLines.push(`data_file 'WEAPONCOMPONENTSINFO_FILE' 'data/weaponcomponents.meta'`);
  }
  if (files.meta.peds.length > 0) {
    dataFileLines.push(`data_file 'PED_METADATA_FILE' 'data/peds.meta'`);
  }
  for (const ytypPath of files.ytyp) {
    dataFileLines.push(`data_file 'DLC_ITYP_REQUEST' 'stream/${path.basename(ytypPath)}'`);
  }
  for (const apparelPath of files.shopPedApparel) {
    dataFileLines.push(`data_file 'SHOP_PED_APPAREL_META_FILE' 'data/${path.basename(apparelPath)}'`);
  }

  // this_is_a_map auto-streams everything under stream/ as world-placement content (ymap entity
  // placements, plus any ytyp/ydr/ytd the placements reference) rather than requiring each file
  // listed individually - the standard FiveM convention for a map/interior resource.
  const mapLine = files.ymap.length > 0 ? `this_is_a_map 'yes'\n\n` : '';

  return `fx_version 'cerulean'
game 'gta5'

author 'Pulse Convert (convert.pulsesystems.dev)'
description '${resourceName} - converted by Pulse Convert'

${mapLine}files {
  'stream/**/*',
  'data/**/*.meta',
}

${dataFileLines.join('\n')}
`;
}

/** A short, generated server.cfg snippet for a multi-car "big pack" job. */
export function generateServerCfgSnippet(resourceNames: string[]): string {
  return resourceNames.map((name) => `ensure ${name}`).join('\n') + '\n';
}
