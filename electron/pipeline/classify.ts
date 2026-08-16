import path from 'path';

// Classifies files for BOTH of this app's local pipelines - convertVehicleLocally (a genuine
// from-scratch conversion, localConvert.ts) and the manual optimize flow (re-processing an
// already-FiveM-formatted resource, optimizeFlow.ts) - but only the vehicle path actually exists
// as a from-scratch conversion here. There is no local port of the web app's (../pulseconvert)
// propify.ts/eupify.ts - convertVehicleLocally rejects any archive with no vehicle signal
// outright ("only vehicle mods can be converted locally right now"), it fails loudly rather than
// silently producing a broken prop/EUP resource. Props/clothing only ever appear here via the
// optimize flow re-processing pre-existing FiveM content, never via generating one from a raw
// gta5-mods.com archive - see the ytyp and shopPedApparel field comments below for exactly where
// each is actually populated in this repo.
export interface ClassifiedFiles {
  yft: string[];
  ytd: string[];
  ydr: string[];
  ydd: string[];
  ycd: string[];
  ybn: string[];
  ytyp: string[];
  ymap: string[];
  meta: {
    vehicles: string[];
    handling: string[];
    carcols: string[];
    carvariations: string[];
    vehiclelayouts: string[];
    weaponanimations: string[];
    weapons: string[];
    weaponcomponents: string[];
    peds: string[];
  };
  /** SHOP_PED_APPAREL_META_FILE - registers addon ped clothing/props. Real filenames follow a
   *  per-ped-model/DLC convention (e.g. mp_m_freemode_01_mycollection.meta), too variable to
   *  reliably auto-detect by name, so this is never populated here by classifyFiles itself.
   *  Note this repo's own scope, distinct from the web app (../pulseconvert): there is no local
   *  "fresh EUP conversion" pipeline in this desktop app at all - convertVehicleLocally
   *  (localConvert.ts) rejects any archive with no vehicle signal outright ("only vehicle mods
   *  can be converted locally right now"). The only place this field is ever populated here is
   *  optimizeFlow.ts's clothing optimize category, which content-sniffs the source archive for
   *  an already-existing `<ShopPedApparel` meta file and pushes it directly, bypassing
   *  classifyFiles entirely. */
  shopPedApparel: string[];
  other: string[];
}

const META_KIND_BY_FILENAME: Array<[RegExp, keyof ClassifiedFiles['meta']]> = [
  [/^vehicles(\.meta)?$/i, 'vehicles'],
  [/^handling(\.meta)?$/i, 'handling'],
  [/^carcols(\.meta)?$/i, 'carcols'],
  [/^carvariations(\.meta)?$/i, 'carvariations'],
  [/^vehiclelayouts(\.meta)?$/i, 'vehiclelayouts'],
  // Real gta5-mods.com weapon-animation packs were observed shipping this filename verbatim
  // (no "s" variant found in practice) - the `s?` is a cheap hedge, not a confirmed alternate spelling.
  [/^weapons?animations(\.meta)?$/i, 'weaponanimations'],
  [/^weapons(\.meta)?$/i, 'weapons'],
  [/^weaponcomponents(\.meta)?$/i, 'weaponcomponents'],
  [/^peds(\.meta)?$/i, 'peds'],
];

/** Walks the extracted file list and buckets everything by GTA5/FiveM resource type. Detection
 *  is filename/extension based - that's sufficient for the binary formats (their extension is
 *  authoritative) and for the well-known meta filenames every vehicle mod uses. */
export function classifyFiles(extractedPaths: string[]): ClassifiedFiles {
  const result: ClassifiedFiles = {
    yft: [],
    ytd: [],
    ydr: [],
    ydd: [],
    ycd: [],
    ybn: [],
    ytyp: [],
    ymap: [],
    meta: {
      vehicles: [], handling: [], carcols: [], carvariations: [], vehiclelayouts: [],
      weaponanimations: [], weapons: [], weaponcomponents: [], peds: [],
    },
    shopPedApparel: [],
    other: [],
  };

  for (const filePath of extractedPaths) {
    const base = path.basename(filePath);
    const ext = path.extname(base).toLowerCase().replace('.', '');
    const stem = path.basename(base, path.extname(base));

    if (ext === 'meta' || ext === '') {
      const match = META_KIND_BY_FILENAME.find(([re]) => re.test(stem) || re.test(base));
      if (match) {
        result.meta[match[1]].push(filePath);
        continue;
      }
    }

    switch (ext) {
      case 'yft':
        result.yft.push(filePath);
        break;
      case 'ytd':
        result.ytd.push(filePath);
        break;
      case 'ydr':
        result.ydr.push(filePath);
        break;
      case 'ydd':
        // Drawable dictionary - the model format ped clothing/component packs ship instead of
        // .yft/.ydr (a single .ydd can hold several drawables, e.g. all variations of one
        // clothing slot). Not produced by any vehicle mod, so this only ever populates for the
        // optimize pipeline's clothing category (see worker/index.ts's processOptimizeJob).
        result.ydd.push(filePath);
        break;
      case 'ytyp':
        // Archetype-definition file (registers prop/object types via the DLC_ITYP_REQUEST
        // fxmanifest mounter). This desktop app has no local "generate a fresh ytyp for a
        // from-scratch props conversion" step at all (unlike the web app, ../pulseconvert's
        // propify.ts - see this file's own top-of-file note on the vehicle-only scope of local
        // conversion here). Classified here so an archive that already ships its own ytyp (a
        // pre-packaged FiveM prop resource run back through the optimizer) is recognized rather
        // than silently dropped into `other`.
        result.ytyp.push(filePath);
        break;
      case 'ymap':
        // Entity-placement file (props/objects positioned in the world) - presence alone is the
        // defining signal for a map conversion (see isMapContent in worker/index.ts), since a real
        // map mod's own ytyp/ydr/ytd needs stay exactly as the source authored them.
        result.ymap.push(filePath);
        break;
      case 'ycd':
        result.ycd.push(filePath);
        break;
      case 'ybn':
        result.ybn.push(filePath);
        break;
      default:
        result.other.push(filePath);
    }
  }

  return result;
}
