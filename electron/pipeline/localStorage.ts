import fs from 'fs';
import path from 'path';

/**
 * Deliberate small port of pulseconvert/src/lib/storage.ts's two pure helpers - not importing
 * that file directly because it also exports `paths.*` for the server's own on-disk job layout
 * (env.dataDir, etc.), which has no meaning on a user's own machine. See this project's README
 * for why the pipeline modules are copied rather than shared via a package.
 */

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Resolves `entryPath` (as read from inside an archive) against `baseDir` and throws if the
 * result would land outside `baseDir` - the standard zip-slip guard. Archive entry names are
 * attacker-controlled and can contain `../` segments or absolute paths.
 */
export function safeJoin(baseDir: string, entryPath: string): string {
  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(resolvedBase, entryPath);
  if (resolvedTarget !== resolvedBase && !resolvedTarget.startsWith(resolvedBase + path.sep)) {
    throw new Error(`Unsafe archive entry path (zip-slip attempt): ${entryPath}`);
  }
  return resolvedTarget;
}
