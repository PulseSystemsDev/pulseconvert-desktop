export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatNumber(value: number | null | undefined): string {
  return (value ?? 0).toLocaleString();
}

export function compactNumber(value: number | null | undefined): string {
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value ?? 0);
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return '-';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function timeAgo(value: string | number | null | undefined): string {
  if (value == null) return '';
  const time = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(time)) return '';
  const diff = Date.now() - time;
  const abs = Math.abs(diff);
  const future = diff < 0;
  const wrap = (text: string) => (future ? `in ${text}` : `${text} ago`);
  if (abs < 45_000) return future ? 'soon' : 'just now';
  if (abs < 3_600_000) return wrap(`${Math.round(abs / 60_000)}m`);
  if (abs < 86_400_000) return wrap(`${Math.round(abs / 3_600_000)}h`);
  if (abs < 30 * 86_400_000) return wrap(`${Math.round(abs / 86_400_000)}d`);
  return new Date(time).toLocaleDateString();
}

export function isSupportedSourceUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    return ['gta5-mods.com', 'mediafire.com', 'sharemods.com'].includes(url.hostname.replace(/^www\./, ''));
  } catch {
    return false;
  }
}

export function plural(count: number, word: string, pluralWord = `${word}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? word : pluralWord}`;
}

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
