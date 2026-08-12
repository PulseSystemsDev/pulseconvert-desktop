/** MAX_ARCHIVE_ENTRIES matches pulseconvert/src/lib/constants.ts exactly. MAX_DECOMPRESSED_BYTES
 *  mirrors env.ts's own default derivation (maxUploadSizeBytes * 4, with a 1 GiB default upload
 *  size) rather than importing the rest of env.ts's server-only config (DB, Discord, etc.) just
 *  for this one number - a locally converted archive is still someone's own download, so the same
 *  zip-bomb/entry-count guards apply. */
export const MAX_ARCHIVE_ENTRIES = 2000;
export const MAX_DECOMPRESSED_BYTES = 4 * 1024 * 1024 * 1024; // 4 GiB (1 GiB upload cap * 4, same derivation env.ts uses)

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
