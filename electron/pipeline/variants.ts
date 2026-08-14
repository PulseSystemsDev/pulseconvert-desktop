import path from 'path';

// Many real gta5-mods.com uploads put alternative installs below a harmless wrapper directory,
// for example `Vehicle Name/Add-On/...` beside `Vehicle Name/Replace/...`. Match complete words or
// phrases in every directory segment instead of using a substring against only the first segment:
// the old `includes("sp")` check could classify an unrelated `scripts/` directory as replace mode.
const INSTALL_VARIANTS = {
  addon: ['addon', 'add on', 'fivem', 'five m', 'dlcpack', 'dlc pack'],
  replace: ['replace', 'replacement', 'singleplayer', 'single player', 'sp'],
} as const;
const EDITION_VARIANTS = {
  enhanced: ['enhanced'],
  legacy: ['legacy'],
} as const;

type InstallVariant = keyof typeof INSTALL_VARIANTS;
type EditionVariant = keyof typeof EDITION_VARIANTS;
type VariantKey = InstallVariant | EditionVariant;

function normalizeSegment(segment: string): string {
  return segment.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const VARIANT_QUALIFIERS = new Set(['version', 'files', 'install', 'installation', 'option', 'variant', 'ready', 'only']);

function segmentMatchesLabels(segment: string, labels: readonly string[]): boolean {
  const normalizedSegment = normalizeSegment(segment);
  if (!normalizedSegment) return false;
  const paddedSegment = ` ${normalizedSegment} `;
  const normalizedLabels = labels.map(normalizeSegment).filter(Boolean);
  if (!normalizedLabels.some((label) => paddedSegment.includes(` ${label} `))) return false;

  // Once an exact label/phrase is present, permit only synonymous label words and generic
  // qualifiers around it. This accepts "Add-On Version" and "FiveM Addon", but not a model
  // wrapper named "My SP Vehicle" merely because it contains the token "sp".
  const allowedTokens = new Set([
    ...VARIANT_QUALIFIERS,
    ...normalizedLabels.flatMap((label) => label.split(' ')),
  ]);
  return normalizedSegment.split(' ').every((token) => allowedTokens.has(token));
}

function segmentVariantKeys(segment: string): VariantKey[] {
  const keys: VariantKey[] = [];
  for (const [key, labels] of Object.entries(INSTALL_VARIANTS) as Array<[InstallVariant, readonly string[]]>) {
    if (segmentMatchesLabels(segment, labels)) keys.push(key);
  }
  for (const [key, labels] of Object.entries(EDITION_VARIANTS) as Array<[EditionVariant, readonly string[]]>) {
    if (segmentMatchesLabels(segment, labels)) keys.push(key);
  }
  return keys;
}

function containerNameVariantKeys(fileName: string): VariantKey[] {
  const extension = path.extname(fileName).toLowerCase();
  if (!['.zip', '.rar', '.7z', '.oiv', '.rpf'].includes(extension)) return [];
  const normalized = normalizeSegment(path.basename(fileName, extension));
  const padded = ` ${normalized} `;
  const keys: VariantKey[] = [];
  for (const [key, labels] of [
    ...Object.entries(INSTALL_VARIANTS),
    ...Object.entries(EDITION_VARIANTS),
  ] as Array<[VariantKey, readonly string[]]>) {
    if (labels.map(normalizeSegment).some((label) => label && padded.includes(` ${label} `))) keys.push(key);
  }
  return keys;
}

function variantKeysForPath(extractDir: string, filePath: string): Set<VariantKey> {
  const relative = path.relative(extractDir, filePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return new Set();
  const segments = relative.split(/[\\/]+/);
  const directoryKeys = segments.slice(0, -1).flatMap(segmentVariantKeys);
  // Alternative installs also commonly arrive as sibling `Add-On.zip` / `Replace.zip` or RPF
  // files. Match complete words in container basenames so the preferred branch is chosen before
  // expansion, while names such as `scripts.zip` still cannot be mistaken for the `sp` label.
  return new Set([...directoryKeys, ...containerNameVariantKeys(segments.at(-1) ?? '')]);
}

/**
 * If the archive contains more than one known "pick one" variant folder (e.g. both "Add-On/" and
 * "Replace/" below a vehicle-name wrapper), keeps only the requested install type. Edition
 * variants are an independent dimension: when both Enhanced and Legacy are present, Enhanced wins.
 * Unmarked files such as README/license content remain included. Found via
 * a real Ford F-450 mod: without this, both variants' tt45.yft/tt45_hi.yft/tt45.ytd ended up
 * classified together and bundle.ts silently wrote two same-named entries into the output zip.
 */
export function selectPreferredVariant(
  extractDir: string,
  extractedPaths: string[],
  preferred: 'addon' | 'replace' = 'addon',
): { paths: string[]; note: string | null } {
  const tagged = extractedPaths.map((filePath) => ({ filePath, keys: variantKeysForPath(extractDir, filePath) }));
  const notes: string[] = [];
  let filtered = tagged;

  const installPresent = (Object.keys(INSTALL_VARIANTS) as InstallVariant[])
    .filter((key) => filtered.some((entry) => entry.keys.has(key)));
  if (installPresent.length > 1) {
    const ignored = installPresent.filter((key) => key !== preferred);
    filtered = filtered.filter((entry) => !installPresent.some((key) => entry.keys.has(key)) || entry.keys.has(preferred));
    notes.push(`used "${preferred}" and ignored ${ignored.join(', ')}`);
  }

  const editionPresent = (Object.keys(EDITION_VARIANTS) as EditionVariant[])
    .filter((key) => filtered.some((entry) => entry.keys.has(key)));
  if (editionPresent.length > 1) {
    const chosen: EditionVariant = 'enhanced';
    const ignored = editionPresent.filter((key) => key !== chosen);
    filtered = filtered.filter((entry) => !editionPresent.some((key) => entry.keys.has(key)) || entry.keys.has(chosen));
    notes.push(`used "${chosen}" and ignored ${ignored.join(', ')}`);
  }

  return {
    paths: filtered.map((entry) => entry.filePath),
    note: notes.length > 0 ? `This archive bundles multiple variants: ${notes.join('; ')}.` : null,
  };
}
