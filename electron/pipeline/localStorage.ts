import fs from 'fs';
import path from 'path';

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function safeJoin(baseDir: string, entryPath: string): string {
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(resolvedBase, entryPath);
  if (resolvedTarget !== resolvedBase && !resolvedTarget.startsWith(resolvedBase + path.sep)) {
    throw new Error(`Unsafe archive entry path (zip-slip attempt): ${entryPath}`);
  }
  return resolvedTarget;
}
