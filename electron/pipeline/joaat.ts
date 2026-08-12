/** Jenkins one-at-a-time hash (JOAAT), lowercase-input - the hash GTA5/FiveM uses internally
 *  for model names, handling names, etc. Standard, well-documented algorithm (also exported as
 *  `rage_joaat` by the rpf-archive Rust crate, confirmed during the Phase 0 spike - this is a
 *  plain reimplementation in TS so the web/worker side doesn't need a Rust round-trip for it). */
export function joaat(input: string): number {
  const str = input.toLowerCase();
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash + str.charCodeAt(i)) >>> 0;
    hash = (hash + (hash << 10)) >>> 0;
    hash = (hash ^ (hash >>> 6)) >>> 0;
  }
  hash = (hash + (hash << 3)) >>> 0;
  hash = (hash ^ (hash >>> 11)) >>> 0;
  hash = (hash + (hash << 15)) >>> 0;
  return hash >>> 0;
}
