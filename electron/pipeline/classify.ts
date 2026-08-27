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

  shopPedApparel: string[];
  other: string[];
}

const META_KIND_BY_FILENAME: Array<[RegExp, keyof ClassifiedFiles['meta']]> = [
  [/^vehicles(\.meta)?$/i, 'vehicles'],
  [/^handling(\.meta)?$/i, 'handling'],
  [/^carcols(\.meta)?$/i, 'carcols'],
  [/^carvariations(\.meta)?$/i, 'carvariations'],
  [/^vehiclelayouts(\.meta)?$/i, 'vehiclelayouts'],

  [/^weapons?animations(\.meta)?$/i, 'weaponanimations'],
  [/^weapons(\.meta)?$/i, 'weapons'],
  [/^weaponcomponents(\.meta)?$/i, 'weaponcomponents'],
  [/^peds(\.meta)?$/i, 'peds'],
];

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

        result.ydd.push(filePath);
        break;
      case 'ytyp':

        result.ytyp.push(filePath);
        break;
      case 'ymap':

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
