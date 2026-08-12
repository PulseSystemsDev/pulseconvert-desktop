import path from 'path';

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
   *  reliably auto-detect by name, so this is never populated by classifyFiles - only by
   *  convertEupPostprocess's own generation step (see eupify.ts). */
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
        // fxmanifest mounter) - see propify.ts, which is what actually generates one for a fresh
        // props conversion. Classified here too so an archive that already ships its own ytyp
        // (rare, but possible for a pre-packaged FiveM prop resource run back through the
        // optimizer) is recognized rather than silently dropped into `other`.
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
