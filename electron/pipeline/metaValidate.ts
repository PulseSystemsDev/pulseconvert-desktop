import fs from 'fs';
import path from 'path';
import { XMLBuilder, XMLParser, XMLValidator } from 'fast-xml-parser';
import type { ClassifiedFiles } from './classify';
import { lookupVanillaVehicle, buildVehiclesMetaItem, type VanillaVehicleMeta } from './vanillaVehicleMeta';

const parser = new XMLParser({ ignoreAttributes: false, allowBooleanAttributes: true });
const builder = new XMLBuilder({ ignoreAttributes: false, format: true, suppressEmptyNode: true });

export interface VehicleEntry {
  modelName: string;
  txdName: string;
  handlingId: string;
  audioNameHash: string;
  vehicleLayoutName: string;
}

export interface MetaValidationResult {
  vehicles: VehicleEntry[];
  fixLog: string[];
  warnings: string[];
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function readXml(filePath: string): unknown {
  const xml = fs.readFileSync(filePath, 'utf-8');
  const valid = XMLValidator.validate(xml, { allowBooleanAttributes: true });
  if (valid !== true) {
    throw new Error(`${valid.err.msg} at line ${valid.err.line}, column ${valid.err.col}`);
  }
  return parser.parse(xml);
}

function stemNamesOf(filePaths: string[]): Set<string> {
  return new Set(filePaths.map((p) => path.basename(p, path.extname(p)).toLowerCase()));
}

/** Set of all `<parent>` names declared in this vehicles.meta's `<txdRelationships>` - i.e. the
 *  valid *entry points* of a texture-dictionary chain. A `<txdName>` that isn't in this set (and
 *  isn't the modelName itself, and isn't the special vehshare/vehicles_race_generic roots) is a
 *  leaf or an unrelated dictionary, so FiveM has no way to walk from it back to the model's own
 *  textures - the model's primary texture fetch silently fails, which on Sketchfab-sourced or
 *  other material-tight vehicles manifests as a hard client crash on spawn (confirmed against real
 *  gta5-mods.com downloads where the author shipped `<txdName>s650_6</txdName>` instead of the
 *  base `s650`, while `s650.ytd` was the actual root of the chain). */
function collectTxdParents(doc: any): Set<string> {
  const parents = new Set<string>();
  const root = doc.CVehicleModelInfo__InitDataList ?? doc.InitDatas;
  const items = asArray<any>(root?.txdRelationships?.Item);
  for (const item of items) {
    const parent = scalarText(item?.parent);
    if (parent) parents.add(parent.toLowerCase());
  }
  return parents;
}

/** In-place string rewrite of a single `<txdName>` value inside a vehicles.meta file - matches
 *  the single-occurrence case (one vehicle per file is the common shape) and the multi-vehicle
 *  case by anchoring on the immediately preceding <modelName> so each vehicle only gets its own
 *  txdName rewritten, never any other vehicle's. */
function rewriteTxdNameInPlace(filePath: string, modelName: string, oldTxdName: string, newTxdName: string): boolean {
  const xml = fs.readFileSync(filePath, 'utf-8');
  const escapedModel = modelName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedOld = oldTxdName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Match <modelName>foo</modelName> ... <txdName>bar</txdName> where `bar` is what we want to
  // replace; tolerate whitespace and intervening tags.
  const re = new RegExp(
    `(<modelName>\\s*${escapedModel}\\s*</modelName>[\\s\\S]*?<txdName>\\s*)${escapedOld}(\\s*</txdName>)`,
    'i'
  );
  if (!re.test(xml)) return false;
  const updated = xml.replace(re, `$1${newTxdName}$2`);
  fs.writeFileSync(filePath, updated);
  return true;
}

function writeXml(workDir: string, fileName: string, doc: unknown): string {
  const outPath = path.join(workDir, fileName);
  fs.writeFileSync(outPath, `<?xml version="1.0" encoding="UTF-8"?>\n${builder.build(doc)}\n`);
  return outPath;
}

function xmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function scalarText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function itemArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function uniqueVehicleItems(items: unknown[]): unknown[] {
  const seen = new Set<string>();
  const unique: unknown[] = [];
  for (const item of items) {
    const modelName = scalarText((item as any)?.modelName).toLowerCase();
    if (!modelName) {
      unique.push(item);
      continue;
    }
    if (seen.has(modelName)) continue;
    seen.add(modelName);
    unique.push(item);
  }
  return unique;
}

function uniqueTxdRelationshipItems(items: unknown[]): unknown[] {
  const seen = new Set<string>();
  const unique: unknown[] = [];
  for (const item of items) {
    const parent = scalarText((item as any)?.parent).toLowerCase();
    const child = scalarText((item as any)?.child).toLowerCase();
    const key = `${parent}->${child}`;
    if (!parent || !child || seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

function uniqueVehicles(vehicles: VehicleEntry[]): { vehicles: VehicleEntry[]; dropped: number } {
  const seen = new Set<string>();
  const unique: VehicleEntry[] = [];
  for (const vehicle of vehicles) {
    const key = vehicle.modelName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(vehicle);
  }
  return { vehicles: unique, dropped: vehicles.length - unique.length };
}

function mergeVehiclesMeta(paths: string[], workDir: string, warnings: string[]): string[] {
  if (paths.length <= 1) return paths;
  const initItems: unknown[] = [];
  const txdItems: unknown[] = [];
  let residentTxd: unknown = 'vehshare';
  let residentAnims: unknown = '';

  for (const filePath of paths) {
    try {
      const doc: any = readXml(filePath);
      const root = doc.CVehicleModelInfo__InitDataList ?? doc.InitDatas;
      if (root?.residentTxd !== undefined) residentTxd = root.residentTxd;
      if (root?.residentAnims !== undefined) residentAnims = root.residentAnims;
      initItems.push(...itemArray(root?.InitDatas?.Item ?? root?.Item));
      txdItems.push(...itemArray(root?.txdRelationships?.Item));
    } catch (err) {
      warnings.push(`Could not merge ${path.basename(filePath)}: ${(err as Error).message}`);
    }
  }

  if (initItems.length === 0) return paths;
  const uniqueInitItems = uniqueVehicleItems(initItems);
  const uniqueTxdItems = uniqueTxdRelationshipItems(txdItems);
  return [
    writeXml(workDir, 'vehicles.merged.meta', {
      CVehicleModelInfo__InitDataList: {
        residentTxd,
        residentAnims,
        InitDatas: { Item: uniqueInitItems },
        txdRelationships: { Item: uniqueTxdItems },
      },
    }),
  ];
}

function mergeHandlingMeta(paths: string[], workDir: string, warnings: string[]): string[] {
  if (paths.length <= 1) return paths;
  const items: unknown[] = [];
  for (const filePath of paths) {
    try {
      const doc: any = readXml(filePath);
      items.push(...itemArray(doc?.CHandlingDataMgr?.HandlingData?.Item));
    } catch (err) {
      warnings.push(`Could not merge ${path.basename(filePath)}: ${(err as Error).message}`);
    }
  }
  if (items.length === 0) return paths;
  return [writeXml(workDir, 'handling.merged.meta', { CHandlingDataMgr: { HandlingData: { Item: items } } })];
}

function mergeCarvariationsMeta(paths: string[], workDir: string, warnings: string[]): string[] {
  if (paths.length <= 1) return paths;
  const items: unknown[] = [];
  for (const filePath of paths) {
    try {
      const doc: any = readXml(filePath);
      items.push(...itemArray(doc?.CVehicleModelInfoVariation?.variationData?.Item));
    } catch (err) {
      warnings.push(`Could not merge ${path.basename(filePath)}: ${(err as Error).message}`);
    }
  }
  if (items.length === 0) return paths;
  return [writeXml(workDir, 'carvariations.merged.meta', { CVehicleModelInfoVariation: { variationData: { Item: items } } })];
}

function splitXmlDocuments(filePath: string, workDir: string, kind: keyof ClassifiedFiles['meta']): string[] {
  const xml = fs.readFileSync(filePath, 'utf-8').trim();
  const starts = [...xml.matchAll(/<\?xml\b/gi)].map((match) => match.index ?? 0);
  if (starts.length <= 1) return [];

  const out: string[] = [];
  for (let i = 0; i < starts.length; i++) {
    const fragment = xml.slice(starts[i], starts[i + 1] ?? xml.length).trim();
    const valid = XMLValidator.validate(fragment, { allowBooleanAttributes: true });
    if (valid !== true) continue;
    const outPath = path.join(workDir, `${kind}.fragment-${i}.meta`);
    fs.writeFileSync(outPath, fragment + '\n');
    out.push(outPath);
  }
  return out;
}

function expandAndFilterValidMetaFiles(
  paths: string[],
  kind: keyof ClassifiedFiles['meta'],
  workDir: string,
  warnings: string[],
  fixLog: string[]
): string[] {
  const validPaths: string[] = [];
  for (const filePath of paths) {
    const xml = fs.readFileSync(filePath, 'utf-8');
    const valid = XMLValidator.validate(xml, { allowBooleanAttributes: true });
    if (valid === true) {
      validPaths.push(filePath);
      continue;
    }

    const fragments = splitXmlDocuments(filePath, workDir, kind);
    if (fragments.length > 0) {
      validPaths.push(...fragments);
      fixLog.push(`Split malformed ${path.basename(filePath)} into ${fragments.length} valid XML metadata fragment(s).`);
      continue;
    }

    warnings.push(`Dropped malformed ${path.basename(filePath)}: ${valid.err.msg} at line ${valid.err.line}, column ${valid.err.col}`);
  }
  return validPaths;
}

function normalizeMultiMetaFiles(files: ClassifiedFiles, workDir: string, warnings: string[], fixLog: string[]): void {
  const before = {
    vehicles: files.meta.vehicles.length,
    handling: files.meta.handling.length,
    carvariations: files.meta.carvariations.length,
  };

  files.meta.vehicles = mergeVehiclesMeta(files.meta.vehicles, workDir, warnings);
  files.meta.handling = mergeHandlingMeta(files.meta.handling, workDir, warnings);
  files.meta.carvariations = mergeCarvariationsMeta(files.meta.carvariations, workDir, warnings);

  if (before.vehicles > 1 && files.meta.vehicles.length === 1) {
    fixLog.push(`Merged ${before.vehicles} vehicles.meta fragments into one valid FiveM metadata file.`);
  }
  if (before.handling > 1 && files.meta.handling.length === 1) {
    fixLog.push(`Merged ${before.handling} handling.meta fragments into one valid FiveM metadata file.`);
  }
  if (before.carvariations > 1 && files.meta.carvariations.length === 1) {
    fixLog.push(`Merged ${before.carvariations} carvariations.meta fragments into one valid FiveM metadata file.`);
  }
}

function fallbackVehicleMetaFromEntry(vehicle: VehicleEntry): VanillaVehicleMeta {
  return {
    name: vehicle.modelName,
    handlingId: vehicle.handlingId || vehicle.modelName.toUpperCase(),
    layout: vehicle.vehicleLayoutName || 'LAYOUT_LOW',
    vehicleMakeName: 'CIVILIAN',
    vehicleClass: 'VC_SPORT',
    type: 'VEHICLE_TYPE_CAR',
    plateType: 'VPT_BACK_PLATES',
    dashboardType: 'VDT_RACE',
    wheelType: 'VWT_SPORT',
  };
}

function buildSafeVehiclesMetaItem(vehicle: VehicleEntry): string {
  const vanilla = fallbackVehicleMetaFromEntry(vehicle);
  const audioNameHash = vehicle.audioNameHash || 'ADDER';
  return buildVehiclesMetaItem(vehicle.modelName, vanilla)
    .replace(/<txdName>[^<]*<\/txdName>/, `<txdName>${xmlText(vehicle.txdName || vehicle.modelName)}</txdName>`)
    .replace(/<handlingId>[^<]*<\/handlingId>/, `<handlingId>${xmlText(vehicle.handlingId || vehicle.modelName.toUpperCase())}</handlingId>`)
    .replace(/<audioNameHash\s*\/>|<audioNameHash>[^<]*<\/audioNameHash>/, `<audioNameHash>${xmlText(audioNameHash)}</audioNameHash>`)
    .replace(/<layout>[^<]*<\/layout>/, `<layout>${xmlText(vehicle.vehicleLayoutName || 'LAYOUT_LOW')}</layout>`);
}

function writeSafeVehiclesMeta(workDir: string, vehicles: VehicleEntry[]): string {
  const items = vehicles.map(buildSafeVehiclesMetaItem).join('');
  const relationships = vehicles
    .map((vehicle) => {
      const txdName = xmlText(vehicle.txdName || vehicle.modelName);
      return `    <Item>
      <parent>vehshare</parent>
      <child>${txdName}</child>
    </Item>
`;
    })
    .join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<CVehicleModelInfo__InitDataList>
  <residentTxd>vehshare</residentTxd>
  <residentAnims />
  <InitDatas>
${items}  </InitDatas>
  <txdRelationships>
${relationships}  </txdRelationships>
</CVehicleModelInfo__InitDataList>
`;
  const outPath = path.join(workDir, 'vehicles.safe.meta');
  fs.writeFileSync(outPath, xml);
  return outPath;
}

function collectHandlingNames(files: ClassifiedFiles, warnings: string[]): string[] {
  const handlingNames: string[] = [];
  const seen = new Set<string>();

  for (const handlingMetaPath of files.meta.handling) {
    try {
      const doc: any = readXml(handlingMetaPath);
      const items = asArray<any>(doc?.CHandlingDataMgr?.HandlingData?.Item);
      for (const item of items) {
        if (!item?.handlingName) continue;
        const handlingName = String(item.handlingName);
        const key = handlingName.toUpperCase();
        if (seen.has(key)) continue;
        seen.add(key);
        handlingNames.push(handlingName);
      }
    } catch (err) {
      warnings.push(`Could not parse ${path.basename(handlingMetaPath)} as XML: ${(err as Error).message}`);
    }
  }

  return handlingNames;
}

interface HandlingFieldRule {
  field: string;
  /** Values below this get raised to it (a floor). Use -Infinity for a ceiling-only rule. */
  min: number;
  /** Values above this get lowered to it (a ceiling). Use Infinity for a floor-only rule. */
  max: number;
  integer?: boolean;
  label: string;
}

// Deliberately conservative "detect the implausible, clamp to the nearest safe edge" bounds -
// sourced from the GTAMods wiki (gtamods.com/wiki/Handling.meta) and community handling-tools
// consensus (Eddlm's Handling-Tools, XGamingServer's editor). These are NOT "typical vanilla
// value" ranges - a legitimately unusual but working vehicle (a heavy truck's wide steering
// lock, a hypercar's high drive force) should never get touched. Only values genuinely outside
// what's physically sane for any real vehicle get clamped.
const HANDLING_FIELD_RULES: HandlingFieldRule[] = [
  // Excessive rollover
  { field: 'fAntiRollBarForce', min: 0.5, max: Infinity, label: 'anti-roll bar force was near zero, a real rollover risk' },
  { field: 'fRollCentreHeightFront', min: 0.0, max: 1.0, label: 'front roll centre height was outside the physically sane range' },
  { field: 'fRollCentreHeightRear', min: 0.0, max: 1.0, label: 'rear roll centre height was outside the physically sane range' },
  // Weak/slow acceleration
  { field: 'fInitialDriveForce', min: 0.10, max: Infinity, label: 'drive force was too low for the vehicle to accelerate normally' },
  { field: 'fInitialDriveMaxFlatVel', min: 30, max: Infinity, label: 'top speed was implausibly low' },
  { field: 'nInitialDriveGears', min: 1, max: 8, integer: true, label: "gear count was outside FiveM's safe range (more than 8 risks a downshift bug)" },
  { field: 'fClutchChangeRateScaleUpShift', min: 1.0, max: Infinity, label: 'upshift rate was near zero, causing extremely slow gear changes' },
  { field: 'fClutchChangeRateScaleDownShift', min: 1.0, max: Infinity, label: 'downshift rate was near zero, causing extremely slow gear changes' },
  // Poor/twitchy steering
  { field: 'fSteeringLock', min: 20, max: 55, label: 'steering lock was outside the range that keeps a car controllable' },
  { field: 'fLowSpeedTractionLossMult', min: 0, max: 1.5, label: 'low-speed traction loss was too high, causing excess wheelspin pulling away' },
];

// vecCentreOfMassOffset's Z component (height) is a vector attribute, not a plain <field value="">
// tag, so it needs its own regex - and its rule is "reset to a safe default if implausible", not
// a min/max clamp, since a value just outside the safe band could be positive (COM above the
// axle - guaranteed flip-prone) or wildly negative (an unconverted donor-vehicle leftover).
const HANDLING_COM_OFFSET_MIN_Z = -0.5;
const HANDLING_COM_OFFSET_MAX_Z = -0.02;
const HANDLING_COM_OFFSET_SAFE_Z = -0.15;

/** Locates each vehicle's own field block within a (possibly multi-vehicle) handling.meta by
 *  anchoring on `<handlingName>` boundaries - same anchor-on-a-known-tag approach as
 *  rewriteTxdNameInPlace, so a field edit for one vehicle can never bleed into another's block. */
function handlingItemSegments(xml: string): { name: string; start: number; end: number }[] {
  const matches = [...xml.matchAll(/<handlingName>\s*([^<\s]+)\s*<\/handlingName>/gi)];
  return matches.map((m, i) => ({
    name: m[1],
    start: m.index ?? 0,
    end: i + 1 < matches.length ? (matches[i + 1].index ?? xml.length) : xml.length,
  }));
}

function clampScalarHandlingField(itemText: string, rule: HandlingFieldRule): { text: string; from: number; to: number } | null {
  const re = new RegExp(`(<${rule.field}\\s+value=")(-?[\\d.]+(?:[eE][-+]?\\d+)?)("\\s*/>)`, 'i');
  const m = itemText.match(re);
  if (!m) return null;
  const current = parseFloat(m[2]);
  if (!Number.isFinite(current)) return null;
  let clamped = current;
  if (current < rule.min) clamped = rule.min;
  else if (current > rule.max) clamped = rule.max;
  if (clamped === current) return null;
  const formatted = rule.integer ? String(Math.round(clamped)) : clamped.toFixed(6);
  return { text: itemText.replace(re, `$1${formatted}$3`), from: current, to: clamped };
}

function resetComOffsetZIfImplausible(itemText: string): { text: string; from: number; to: number } | null {
  const re = /(<vecCentreOfMassOffset\s+x="-?[\d.]+(?:[eE][-+]?\d+)?"\s+y="-?[\d.]+(?:[eE][-+]?\d+)?"\s+z=")(-?[\d.]+(?:[eE][-+]?\d+)?)("\s*\/>)/i;
  const m = itemText.match(re);
  if (!m) return null;
  const current = parseFloat(m[2]);
  if (!Number.isFinite(current)) return null;
  if (current >= HANDLING_COM_OFFSET_MIN_Z && current <= HANDLING_COM_OFFSET_MAX_Z) return null;
  return {
    text: itemText.replace(re, `$1${HANDLING_COM_OFFSET_SAFE_Z.toFixed(6)}$3`),
    from: current,
    to: HANDLING_COM_OFFSET_SAFE_Z,
  };
}

/**
 * Auto-repairs handling.meta driving-behavior problems: excessive rollover, unrealistically weak
 * acceleration, and poor/uncontrollable steering - real, common problems in a straight
 * SP-mod-to-FiveM conversion where the source handling data was hand-tuned around different
 * assumptions (or copied from an unrelated donor vehicle) and never rescaled. Edits are scoped
 * per-<handlingName> segment (handlingItemSegments) and done as targeted regex replacement, never
 * a full parse/rebuild, so every other field, comment, and the file's original formatting survive
 * byte-for-byte untouched outside the specific values actually clamped - same approach as
 * rewriteTxdNameInPlace above, for the same reason (the XML builder would reformat/lose fields
 * this parser doesn't model).
 */
function repairHandlingBehavior(files: ClassifiedFiles, fixLog: string[]): void {
  for (const handlingPath of files.meta.handling) {
    let xml: string;
    try {
      xml = fs.readFileSync(handlingPath, 'utf-8');
    } catch {
      continue;
    }

    const segments = handlingItemSegments(xml);
    if (segments.length === 0) continue;

    let changed = false;
    const rebuilt: string[] = [xml.slice(0, segments[0].start)];

    for (const segment of segments) {
      let itemText = xml.slice(segment.start, segment.end);
      const itemFixes: string[] = [];

      const comFix = resetComOffsetZIfImplausible(itemText);
      if (comFix) {
        itemText = comFix.text;
        itemFixes.push(
          `centre-of-mass height was implausible (${comFix.from.toFixed(3)}) and reset to a safe default (${comFix.to.toFixed(3)}), reducing rollover risk`
        );
      }

      for (const rule of HANDLING_FIELD_RULES) {
        const fix = clampScalarHandlingField(itemText, rule);
        if (!fix) continue;
        itemText = fix.text;
        itemFixes.push(`${rule.label} (was ${fix.from}, now ${fix.to})`);
      }

      if (itemFixes.length > 0) {
        changed = true;
        fixLog.push(`Handling repair for "${segment.name}": ${itemFixes.join('; ')}.`);
      }
      rebuilt.push(itemText);
    }

    if (!changed) continue;
    fs.writeFileSync(handlingPath, rebuilt.join(''));
  }
}

function repairVehicleHandlingIds(vehicles: VehicleEntry[], handlingNames: string[]): number {
  if (handlingNames.length === 0) return 0;

  const byUpper = new Map(handlingNames.map((name) => [name.toUpperCase(), name]));
  let repaired = 0;

  vehicles.forEach((vehicle, index) => {
    const current = vehicle.handlingId ? byUpper.get(vehicle.handlingId.toUpperCase()) : undefined;
    const modelMatch = vehicle.modelName ? byUpper.get(vehicle.modelName.toUpperCase()) : undefined;
    const txdMatch = vehicle.txdName ? byUpper.get(vehicle.txdName.toUpperCase()) : undefined;
    const orderMatch = vehicles.length === handlingNames.length ? handlingNames[index] : undefined;
    const fallback = handlingNames.length === 1 ? handlingNames[0] : undefined;
    const nextHandlingId = current ?? modelMatch ?? txdMatch ?? orderMatch ?? fallback;

    if (!nextHandlingId || nextHandlingId === vehicle.handlingId) return;
    vehicle.handlingId = nextHandlingId;
    repaired++;
  });

  return repaired;
}

function defaultCarvariationsItem(modelName: string): string {
  return `    <Item>
      <modelName>${modelName}</modelName>
      <colors>
        <Item>
          <indices content="char_array">0</indices>
        </Item>
      </colors>
    </Item>
`;
}

/** Writes a brand-new carvariations.meta covering every vehicle in this archive - used when
 *  none was present at all. */
function writeNewCarvariationsMeta(workDir: string, vehicles: VehicleEntry[]): string {
  const items = vehicles.map((v) => defaultCarvariationsItem(v.modelName)).join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<CVehicleModelInfoVariation>\n  <variationData>\n${items}  </variationData>\n</CVehicleModelInfoVariation>\n`;
  const outPath = path.join(workDir, 'carvariations.meta');
  fs.writeFileSync(outPath, xml);
  return outPath;
}

/** Appends a default entry for one vehicle into an existing carvariations.meta that's missing
 *  it - string-level insertion (mirrors the approach in addonify.ts) rather than a full
 *  parse/rebuild, so the rest of the file's formatting and any fields this parser doesn't model
 *  are left untouched. */
function appendCarvariationsItem(filePath: string, modelName: string): void {
  const xml = fs.readFileSync(filePath, 'utf-8');
  const closeTag = '</variationData>';
  const idx = xml.lastIndexOf(closeTag);
  if (idx === -1) return; // unexpected shape - leave the file alone rather than risk corrupting it
  const updated = xml.slice(0, idx) + defaultCarvariationsItem(modelName) + xml.slice(idx);
  fs.writeFileSync(filePath, updated);
}

/** Real Replace-mod downloads ship the .yft under the exact vanilla filename (that's how the
 *  replace technique works in the first place) - "_hi"/"_hi2" etc. high-LOD variants share the
 *  same vanilla name, so they're deduped down to one vehicle, not double-counted. */
function uniqueYftBaseNames(yftPaths: string[]): string[] {
  const seen = new Set<string>();
  for (const p of yftPaths) {
    const stem = path.basename(p, path.extname(p)).toLowerCase().replace(/_hi\d*$/, '');
    seen.add(stem);
  }
  return [...seen];
}

/**
 * Some real downloads (confirmed against an actual gta5-mods.com "singleplayer Replace" pack)
 * ship with no vehicles.meta at all - the mod only overwrites the vanilla .yft/.ytd in place, so
 * the game's own base vehicles.meta entry is normally what's used. That entry doesn't exist in
 * this archive for us to read, so without this there's no modelName to addon-ify and the vehicle
 * would silently never convert. Synthesizes one real <Item> per recognized vanilla filename using
 * a verified-real template (see vanillaVehicleMeta.ts) - unrecognized filenames (genuine custom
 * addon names) are left alone and surfaced as a warning instead, since there's no vanilla data to
 * build a safe entry from.
 */
function synthesizeMissingVehiclesMeta(files: ClassifiedFiles, workDir: string): { path: string | null; fixLog: string[]; warnings: string[] } {
  const fixLog: string[] = [];
  const warnings: string[] = [];
  const items: string[] = [];

  for (const baseName of uniqueYftBaseNames(files.yft)) {
    const vanilla = lookupVanillaVehicle(baseName);
    if (!vanilla) {
      warnings.push(
        `No vehicles.meta was found in this archive, and "${baseName}" doesn't match a known vanilla vehicle - could not generate one, so this vehicle won't be converted.`
      );
      continue;
    }
    items.push(buildVehiclesMetaItem(baseName, vanilla));
    fixLog.push(
      `Generated a vehicles.meta entry for "${baseName}" (handling/layout copied from the vanilla ${vanilla.handlingId}) - none was present in the source archive.`
    );
  }

  if (items.length === 0) return { path: null, fixLog, warnings };

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<CVehicleModelInfo__InitDataList>\n  <InitDatas>\n${items.join('')}  </InitDatas>\n</CVehicleModelInfo__InitDataList>\n`;
  const outPath = path.join(workDir, 'vehicles.meta');
  fs.writeFileSync(outPath, xml);
  return { path: outPath, fixLog, warnings };
}

/**
 * Cross-checks vehicles.meta's references against what's actually present in the archive:
 * does txdName resolve to a bundled .ytd, does handlingId exist in the bundled handling.meta,
 * does carvariations.meta have an entry for the model. This is the meta-layer half of "auto-fix
 * broken cars" - binary-level checks (texture names referenced *inside* the .yft, embedded
 * collision bounds) need the native engine (Blender/Sollumz) and are out of scope here.
 */
export function validateAndFixMeta(files: ClassifiedFiles, workDir: string): MetaValidationResult {
  const fixLog: string[] = [];
  const warnings: string[] = [];
  const vehicles: VehicleEntry[] = [];

  files.meta.vehicles = expandAndFilterValidMetaFiles(files.meta.vehicles, 'vehicles', workDir, warnings, fixLog);
  files.meta.handling = expandAndFilterValidMetaFiles(files.meta.handling, 'handling', workDir, warnings, fixLog);
  files.meta.carcols = expandAndFilterValidMetaFiles(files.meta.carcols, 'carcols', workDir, warnings, fixLog);
  files.meta.carvariations = expandAndFilterValidMetaFiles(files.meta.carvariations, 'carvariations', workDir, warnings, fixLog);
  files.meta.vehiclelayouts = expandAndFilterValidMetaFiles(files.meta.vehiclelayouts, 'vehiclelayouts', workDir, warnings, fixLog);

  if (files.meta.vehicles.length === 0) {
    const synthesized = synthesizeMissingVehiclesMeta(files, workDir);
    if (synthesized.path) files.meta.vehicles.push(synthesized.path);
    fixLog.push(...synthesized.fixLog);
    warnings.push(...synthesized.warnings);
  }

  normalizeMultiMetaFiles(files, workDir, warnings, fixLog);
  repairHandlingBehavior(files, fixLog);

  const ytdStems = stemNamesOf(files.ytd);
  const normalizedVehicleMeta = files.meta.vehicles.length === 1 && path.basename(files.meta.vehicles[0]).includes('.merged.');
  const handlingNames = collectHandlingNames(files, warnings);

  for (const vehiclesMetaPath of files.meta.vehicles) {
    let doc: any;
    try {
      doc = readXml(vehiclesMetaPath);
    } catch (err) {
      warnings.push(`Could not parse ${path.basename(vehiclesMetaPath)} as XML: ${(err as Error).message}`);
      continue;
    }

    const root = doc.CVehicleModelInfo__InitDataList ?? doc.InitDatas;
    const items = asArray<any>(root?.InitDatas?.Item ?? root?.Item);
    // Pre-compute once per file - same parent set applies to every <Item> in it.
    const txdParents = collectTxdParents(doc);
    const VEHSHARE_ROOTS = new Set(['vehshare', 'vehicles_race_generic', 'vehicles_cav_interior', 'vehicles_common_interior']);

    for (const item of items) {
      const modelName: string | undefined = item?.modelName;
      const txdName: string | undefined = item?.txdName;
      const handlingId: string | undefined = item?.handlingId;
      const audioNameHash = scalarText(item?.audioNameHash);
      // The real field GTA5 itself reads is "layout" - verified against an actual vanilla
      // vehicles.meta dump. "vehicleLayoutName" isn't a real field, but kept as a fallback in
      // case a sloppy community file uses it anyway; it never hurts to also check.
      const vehicleLayoutName: string | undefined = item?.layout ?? item?.vehicleLayoutName;
      if (!modelName) continue;

      // Some community uploads point <txdName> at the LEAF of a texture chain (e.g. an author
      // writes <txdName>s650_6</txdName> while the actual .ytd chain is s650 -> s650_1 -> ...
      // -> s650_6). FiveM can't reach the model's primary textures from a leaf entry, so the
      // vehicle either fails to register its spawn name ("Invalid model") or, on material-tight
      // Sketchfab-sourced vehicles, hard-crashes the client on spawn. If modelName itself is a
      // parent in the chain (or its .ytd exists on disk), rewrite the leaf txdName to the
      // modelName - the canonical vanilla shape (<modelName>s650</modelName><txdName>s650</txdName>).
      let resolvedTxdName = txdName ?? '';
      if (
        resolvedTxdName &&
        resolvedTxdName.toLowerCase() !== modelName.toLowerCase() &&
        !txdParents.has(resolvedTxdName.toLowerCase()) &&
        !VEHSHARE_ROOTS.has(resolvedTxdName.toLowerCase()) &&
        (txdParents.has(modelName.toLowerCase()) || ytdStems.has(modelName.toLowerCase()))
      ) {
        const rewrote = rewriteTxdNameInPlace(vehiclesMetaPath, modelName, resolvedTxdName, modelName);
        if (rewrote) {
          fixLog.push(
            `Rewrote "${modelName}" <txdName> from "${resolvedTxdName}" (a non-root texture dictionary) to "${modelName}" - the source file pointed at a leaf .ytd in the chain, which FiveM can't resolve back to the model's primary textures.`
          );
          resolvedTxdName = modelName;
        }
      }

      if (resolvedTxdName && !ytdStems.has(resolvedTxdName.toLowerCase())) {
        warnings.push(
          `${modelName}: vehicles.meta references txdName "${resolvedTxdName}" but no matching .ytd was found in the archive. Textures will likely be missing in-game.`
        );
      }

      vehicles.push({
        modelName,
        txdName: resolvedTxdName,
        handlingId: handlingId ?? '',
        audioNameHash,
        vehicleLayoutName: vehicleLayoutName ?? '',
      });
    }
  }

  // Large packs often contain vehicles.meta entries that are well-formed XML but not acceptable
  // to FiveM's schema/PSO loader (duplicate singleton fields, odd legacy fields, bad value
  // shapes). If FiveM rejects vehicles.meta, none of the spawn codes register. For merged packs,
  // rebuild a conservative, schema-safe vehicles.meta from just the fields needed to register
  // each model, while keeping the source modelName/txdName/handlingId/layout.
  if (normalizedVehicleMeta && vehicles.length > 1) {
    const deduped = uniqueVehicles(vehicles);
    if (deduped.dropped > 0) {
      vehicles.splice(0, vehicles.length, ...deduped.vehicles);
      fixLog.push(`Removed ${deduped.dropped} duplicate vehicles.meta registration entr${deduped.dropped === 1 ? 'y' : 'ies'}.`);
    }
    const repairedHandlingIds = repairVehicleHandlingIds(vehicles, handlingNames);
    if (repairedHandlingIds > 0) {
      fixLog.push(`Repaired ${repairedHandlingIds} vehicles.meta handlingId value(s) to match the bundled handling.meta.`);
    }
    files.meta.vehicles = [writeSafeVehiclesMeta(workDir, vehicles)];
    fixLog.push(`Rebuilt vehicles.meta with ${vehicles.length} schema-safe FiveM vehicle registration entries.`);
  }

  if (handlingNames.length > 0) {
    const handlingNameSet = new Set(handlingNames.map((name) => name.toUpperCase()));
    for (const v of vehicles) {
      if (v.handlingId && !handlingNameSet.has(v.handlingId.toUpperCase())) {
        warnings.push(
          `${v.modelName}: handlingId "${v.handlingId}" not found in the bundled handling.meta. The vehicle may fall back to default handling.`
        );
      }
    }
  }

  if (files.meta.vehiclelayouts.length > 0) {
    const layoutNames = new Set<string>();
    for (const layoutPath of files.meta.vehiclelayouts) {
      try {
        const doc: any = readXml(layoutPath);
        const dicts = asArray<any>(doc?.CVehicleMetadataMgr?.VehicleLayoutInfos?.Item);
        for (const dict of dicts) {
          if (dict?.Name) layoutNames.add(String(dict.Name).toUpperCase());
        }
      } catch (err) {
        warnings.push(`Could not parse ${path.basename(layoutPath)} as XML: ${(err as Error).message}`);
      }
    }
    for (const v of vehicles) {
      if (v.vehicleLayoutName && layoutNames.size > 0 && !layoutNames.has(v.vehicleLayoutName.toUpperCase())) {
        warnings.push(
          `${v.modelName}: vehicleLayoutName "${v.vehicleLayoutName}" not found in the bundled vehiclelayouts.meta. If this isn't a standard vanilla layout, entering the vehicle may crash the client.`
        );
      }
    }
  }

  if (files.meta.carvariations.length === 0 && vehicles.length > 0) {
    const newPath = writeNewCarvariationsMeta(workDir, vehicles);
    files.meta.carvariations.push(newPath);
    fixLog.push(
      `Generated a default carvariations.meta entry for ${vehicles.map((v) => v.modelName).join(', ')} (none was present in the source archive).`
    );
  } else {
    const variedModels = new Set<string>();
    for (const carvariationsPath of files.meta.carvariations) {
      try {
        const doc: any = readXml(carvariationsPath);
        const items = asArray<any>(doc?.CVehicleModelInfoVariation?.variationData?.Item);
        for (const item of items) {
          if (item?.modelName) variedModels.add(String(item.modelName).toLowerCase());
        }
      } catch (err) {
        warnings.push(`Could not parse ${path.basename(carvariationsPath)} as XML: ${(err as Error).message}`);
      }
    }
    for (const v of vehicles) {
      if (!variedModels.has(v.modelName.toLowerCase())) {
        appendCarvariationsItem(files.meta.carvariations[0], v.modelName);
        fixLog.push(`Generated a default carvariations.meta entry for "${v.modelName}" (was missing from the source archive).`);
      }
    }
  }

  return { vehicles, fixLog, warnings };
}
