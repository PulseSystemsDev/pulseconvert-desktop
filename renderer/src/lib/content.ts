import { Boxes, Brush, CarFront, Crosshair, ImageDown, Map, PersonStanding, Shirt, Sparkles, type LucideIcon } from 'lucide-react';
import type { OptimizeCategory } from './bridge';

export type ConvertCategory = 'vehicle' | 'prop' | 'map' | 'eup' | 'weapon' | 'ped' | 'animation';

export interface CategoryInfo {
  icon: LucideIcon;
  label: string;
  noun: string;
  intro: string;
  points: Array<{ title: string; desc: string }>;
  placeholder: string;
}

export const CONVERT_CATEGORY_ORDER: ConvertCategory[] = ['vehicle', 'prop', 'map', 'eup', 'weapon', 'ped', 'animation'];

export const CONVERT_CATEGORIES: Record<ConvertCategory, CategoryInfo> = {
  vehicle: {
    icon: CarFront,
    label: 'Vehicle',
    noun: 'vehicle',
    intro: 'Broken files auto-fixed, textures split correctly, handed back as a server-ready resource.',
    placeholder: 'https://www.gta5-mods.com/vehicles/...',
    points: [
      { title: 'Auto-fixes broken vehicles', desc: 'Cross-checks vehicles.meta, handling.meta, carcols.meta, carvariations.meta and load order, patching what it safely can.' },
      { title: 'Preserves quality', desc: 'Oversized texture dictionaries are split correctly for FiveM. Original resolution is always kept.' },
      { title: 'Builds packs', desc: 'Add several vehicles or links and get them back as one pack with a server.cfg snippet.' },
    ],
  },
  prop: {
    icon: Boxes,
    label: 'Prop',
    noun: 'prop pack',
    intro: 'Addon-renamed against a collision-safe hash history, with the .ytyp FiveM needs to spawn them.',
    placeholder: 'https://www.gta5-mods.com/objects/...',
    points: [
      { title: 'Collision-safe naming', desc: 'Every prop is checked against vanilla objects and every name Pulse Convert has issued before.' },
      { title: 'Generates the .ytyp', desc: 'An archetype registration covering every prop, wired through a DLC_ITYP_REQUEST entry.' },
      { title: 'Wheel packs flagged', desc: 'Wheel and rim packs convert as props with a clear warning that they need vehicle wiring.' },
    ],
  },
  map: {
    icon: Map,
    label: 'Map',
    noun: 'map',
    intro: 'this_is_a_map wired automatically and bundled .ytyp files registered, without renaming placements.',
    placeholder: 'https://www.gta5-mods.com/maps/...',
    points: [
      { title: 'Manifest flag wired', desc: 'Detected from real .ymap placement files, the standard FiveM convention for maps and MLOs.' },
      { title: 'Placements never broken', desc: 'Nothing a .ymap references is renamed, so placements stay exactly as authored.' },
      { title: 'Missing-archetype warning', desc: 'Custom props with no .ytyp get a warning instead of silently missing in game.' },
    ],
  },
  eup: {
    icon: Shirt,
    label: 'EUP & clothing',
    noun: 'clothing pack',
    intro: "Drawables renamed into FiveM's real addon-clothing convention, with the registration meta generated.",
    placeholder: 'https://www.gta5-mods.com/player/...',
    points: [
      { title: 'Real naming convention', desc: 'Confirmed against working FiveM addon-clothing resources. Variations stay separate files.' },
      { title: 'Gender-aware', desc: 'Female naming registers on mp_f_freemode_01 automatically; mixed archives get a warning.' },
      { title: 'Works with shop scripts', desc: 'illenium-appearance, qb-clothing and ESX skinchanger read the drawables directly.' },
    ],
  },
  weapon: {
    icon: Crosshair,
    label: 'Weapon',
    noun: 'weapon',
    intro: 'WEAPONINFO and component registrations wired up and name collisions checked. Stats stay exactly as authored.',
    placeholder: 'https://www.gta5-mods.com/weapons/...',
    points: [
      { title: 'Stats never touched', desc: 'Damage, fire rate and every balance value come straight from the source weapons.meta.' },
      { title: 'Collision-checked', desc: "The weapon's name is checked against every name Pulse Convert has issued." },
      { title: 'Not an animation pack', desc: 'Use the Animation type for new animations on an existing weapon.' },
    ],
  },
  ped: {
    icon: PersonStanding,
    label: 'Ped',
    noun: 'ped',
    intro: 'PED_METADATA_FILE registration wired and names collision-checked. Model data stays as authored.',
    placeholder: 'https://www.gta5-mods.com/player/...',
    points: [
      { title: 'Registration wired', desc: 'The data_file entry FiveM needs to recognise a custom ped model.' },
      { title: 'Collision-checked', desc: "The ped's model name is checked against every name issued before." },
      { title: 'Standalone peds only', desc: 'For clothing on the freemode models, use EUP & clothing instead.' },
    ],
  },
  animation: {
    icon: Sparkles,
    label: 'Animation',
    noun: 'animation pack',
    intro: 'Weapon reanimations and other .ycd packs handed back server-ready, with every alternative style kept.',
    placeholder: 'https://www.gta5-mods.com/weapons/...',
    points: [
      { title: 'Both real-world shapes', desc: 'Bare .ycd replacements and packs with weaponanimations.meta both convert correctly.' },
      { title: 'Styles split apart', desc: 'Alternative styles become separate resources instead of one silently winning.' },
      { title: 'Orphans dropped', desc: 'Dictionaries nothing references are left out instead of shipping dead weight.' },
    ],
  },
};

export interface OptimizeInfo {
  icon: LucideIcon;
  label: string;
  intro: string;
  points: string[];
}

export const OPTIMIZE_ORDER: OptimizeCategory[] = ['vehicles', 'props', 'clothing', 'textures'];

export const OPTIMIZE_CATEGORIES: Record<OptimizeCategory, OptimizeInfo> = {
  vehicles: {
    icon: CarFront,
    label: 'Vehicles',
    intro: 'Re-run texture shrinking and metadata validation on an already-converted vehicle. Same names, leaner bundle.',
    points: ['Oversized .dds layers downscaled under the streaming target', 'vehicles, handling, carcols and carvariations re-validated', 'Every dictionary re-measured and reported'],
  },
  props: {
    icon: Boxes,
    label: 'Props',
    intro: 'Recompress stream-heavy prop packs and re-bundle them as a leaner resource with the same fxmanifest.',
    points: ['Texture dictionaries shrunk against smaller mip caps', "Dictionaries that still don't fit are split and relinked", 'Report of anything still oversized'],
  },
  clothing: {
    icon: Shirt,
    label: 'Clothing',
    intro: 'Recompress EUP and clothing packs and split oversized .ytd files. Drawable and texture IDs never change.',
    points: ['Oversized .ytd downscaled, IDs untouched', 'Files over FiveM read limits split and relinked', 'Report of anything still oversized'],
  },
  textures: {
    icon: ImageDown,
    label: 'Textures',
    intro: 'Texture-only pass. Point it at a standalone .ytd or a full resource and every layer is re-encoded.',
    points: ['Bare .ytd in, slimmer .ytd out', 'Full resources re-packed with the same fxmanifest', 'Never removes a texture a model references'],
  },
};

export const FIX_POINTS = [
  { icon: Brush, title: 'Meta files re-checked', desc: 'vehicles.meta, handling.meta, carcols.meta and carvariations.meta are validated and patched where it is safe.' },
  { icon: Boxes, title: 'Nothing renamed', desc: 'Model and resource names stay exactly as they are, so existing references keep working.' },
  { icon: ImageDown, title: 'Textures untouched', desc: 'No texture changes at all. Use Optimize if you also want the resource slimmed down.' },
];
