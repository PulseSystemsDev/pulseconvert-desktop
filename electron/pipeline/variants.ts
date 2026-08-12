import path from 'path';

// Many real gta5-mods.com vehicle uploads ship two complete, alternative installs side by side -
// one per GTA5 data branch - meant for the user to pick ONE based on their server's game version,
// not install both. Preference order also doubles as which one wins when both are present.
const VARIANT_GROUPS = [
  { key: 'addon', labels: ['addon', 'add-on', 'add on', 'fivem', 'five m', 'dlcpack'] },
  { key: 'replace', labels: ['replace', 'replacement', 'singleplayer', 'sp'] },
  { key: 'enhanced', labels: ['enhanced'] },
  { key: 'legacy', labels: ['legacy'] },
];

function topLevelSegment(extractDir: string, filePath: string): string {
  return path.relative(extractDir, filePath).split(path.sep)[0]?.toLowerCase() ?? '';
}

function variantKey(segment: string): string | null {
  const normalized = segment.replace(/[_-]+/g, ' ').trim();
  return VARIANT_GROUPS.find((group) => group.labels.some((label) => normalized === label || normalized.includes(label)))?.key ?? null;
}

/**
 * If the archive's top level contains more than one of the known "pick one" variant folders
 * (e.g. both "Legacy/" and "Enhanced/"), keeps only the most-preferred one and drops every file
 * under the others - before any nested-.rpf extraction is wasted on the unused variant. Found via
 * a real Ford F-450 mod: without this, both variants' tt45.yft/tt45_hi.yft/tt45.ytd ended up
 * classified together and bundle.ts silently wrote two same-named entries into the output zip.
 */
export function selectPreferredVariant(extractDir: string, extractedPaths: string[]): { paths: string[]; note: string | null } {
  const topLevelDirs = [...new Set(extractedPaths.map((p) => topLevelSegment(extractDir, p)))];
  const present = VARIANT_GROUPS.map((group) => group.key).filter((key) => topLevelDirs.some((dir) => variantKey(dir) === key));
  if (present.length < 2) return { paths: extractedPaths, note: null };

  const [chosen, ...ignored] = present;
  const filtered = extractedPaths.filter((p) => {
    const topVariant = variantKey(topLevelSegment(extractDir, p));
    return !topVariant || topVariant === chosen;
  });

  return {
    paths: filtered,
    note: `This archive bundles multiple variants (${present.join(', ')}) - used "${chosen}" and ignored ${ignored.join(', ')}.`,
  };
}
