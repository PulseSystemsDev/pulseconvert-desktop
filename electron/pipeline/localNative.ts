import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { MAX_ARCHIVE_ENTRIES, formatBytes, MAX_DECOMPRESSED_BYTES } from './localConstants';
import { safeJoin, ensureDir } from './localStorage';
import config from '../configStore';

/**
 * Local port of pulseconvert/src/lib/pipeline/native.ts, adapted for a user's own machine instead
 * of the server's controlled container: paths are resolved against bundled resources
 * (resources/rpf-tool.exe, resources/blender-scripts/) or detected/configured Blender installs,
 * not server env vars. Archive-format detection functions are copied verbatim (pure, no
 * adaptation needed).
 */

function resourcesRoot(): string {
  // Packaged: electron-builder's extraResources (electron-builder.yml) copies resources/ to
  // process.resourcesPath/resources/. Dev: read straight from the project's own resources/ dir,
  // two levels up from dist/electron/ (tsup's output dir - see main.ts's identical renderer-path
  // comment for why it's two levels, not one).
  return app.isPackaged ? path.join(process.resourcesPath, 'resources') : path.join(__dirname, '..', '..', 'resources');
}

function resolveRpfToolPath(): string {
  const override = config.get('rpfToolPath');
  if (override) return override;
  const bundled = path.join(resourcesRoot(), process.platform === 'win32' ? 'rpf-tool.exe' : 'rpf-tool');
  return bundled;
}

function resolveConvertScriptPath(): string {
  return path.join(resourcesRoot(), 'blender-scripts', 'convert.py');
}

const WINDOWS_BLENDER_SEARCH_ROOTS = ['C:\\Program Files\\Blender Foundation', 'C:\\Program Files (x86)\\Blender Foundation'];

/** Best-effort detection of a local Blender install - there is no single fixed path (the version
 *  number is baked into the install directory name), so this scans the usual install root(s) for
 *  a "Blender <version>" subdirectory containing blender.exe and picks the newest-sounding one by
 *  directory name sort, which is good enough for "found something" without needing exact version
 *  parsing. Returns null (not a guess) if nothing is found - callers must treat that as "ask the
 *  user to set it up," never silently proceed with a bad path. */
export function detectBlenderPath(): string | null {
  const override = config.get('blenderPath');
  if (override && fs.existsSync(override)) return override;

  if (process.platform === 'win32') {
    for (const root of WINDOWS_BLENDER_SEARCH_ROOTS) {
      if (!fs.existsSync(root)) continue;
      const entries = fs
        .readdirSync(root, { withFileTypes: true })
        .filter((e) => e.isDirectory() && e.name.toLowerCase().startsWith('blender'))
        .map((e) => e.name)
        .sort()
        .reverse(); // lexicographic sort puts the highest version number first for "Blender 5.1" vs "Blender 4.2"
      for (const dirName of entries) {
        const candidate = path.join(root, dirName, 'blender.exe');
        if (fs.existsSync(candidate)) return candidate;
      }
    }
    return null;
  }

  if (process.platform === 'darwin') {
    const candidate = '/Applications/Blender.app/Contents/MacOS/Blender';
    return fs.existsSync(candidate) ? candidate : null;
  }

  // Linux: assume it's on PATH if installed - resolved at spawn time, not checked here.
  return 'blender';
}

function run(command: string, args: string[], env?: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${path.basename(command)} exited with code ${code}: ${(stderr || stdout).trim()}`));
    });
  });
}

export function isRawRpf(filePath: string): boolean {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    return buf.toString('ascii') === 'RPF7';
  } finally {
    fs.closeSync(fd);
  }
}

export function isRar(filePath: string): boolean {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(6);
    fs.readSync(fd, buf, 0, 6, 0);
    return buf.subarray(0, 4).toString('ascii') === 'Rar!' && buf[4] === 0x1a && buf[5] === 0x07;
  } finally {
    fs.closeSync(fd);
  }
}

export function is7z(filePath: string): boolean {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(6);
    fs.readSync(fd, buf, 0, 6, 0);
    return buf.toString('hex') === '377abcaf271c';
  } finally {
    fs.closeSync(fd);
  }
}

export function isZip(filePath: string): boolean {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    const sig = buf.toString('hex');
    return sig === '504b0304' || sig === '504b0506' || sig === '504b0708';
  } finally {
    fs.closeSync(fd);
  }
}

export function isRecognizedArchive(filePath: string): boolean {
  return isRawRpf(filePath) || isRar(filePath) || is7z(filePath) || isZip(filePath);
}

interface SevenZipEntry {
  path: string;
  size: number;
}

function parseSevenZipListing(output: string): SevenZipEntry[] {
  const entries: SevenZipEntry[] = [];
  let current: Partial<SevenZipEntry> = {};
  const flush = () => {
    if (current.path !== undefined) entries.push({ path: current.path, size: current.size ?? 0 });
    current = {};
  };
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') {
      flush();
      continue;
    }
    const eq = trimmed.indexOf(' = ');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq);
    const value = trimmed.slice(eq + 3);
    if (key === 'Path') current.path = value;
    else if (key === 'Size') current.size = parseInt(value, 10) || 0;
  }
  flush();
  return entries;
}

/** Requires system 7-Zip on PATH (or a configured override) - bundling 7-Zip's own binary is a
 *  separate licensing/packaging concern this phase doesn't take on; the error message tells the
 *  user exactly what's missing rather than failing silently. */
function resolveSevenZipPath(): string {
  const override = config.get('sevenZipPath');
  if (override) return override;
  return process.platform === 'win32' ? '7z' : '7zz';
}

export async function extractSevenZip(archivePath: string, destDir: string): Promise<string[]> {
  const tool = resolveSevenZipPath();
  let listing: string;
  try {
    listing = await run(tool, ['l', '-slt', '-ba', archivePath]);
  } catch (err) {
    throw new Error(`Could not list this archive with 7-Zip (${(err as Error).message}). Install 7-Zip and make sure "7z" is on your PATH.`);
  }

  const entries = parseSevenZipListing(listing);
  if (entries.length > MAX_ARCHIVE_ENTRIES) {
    throw new Error(`Archive has too many entries (>${MAX_ARCHIVE_ENTRIES}) - refusing to extract.`);
  }
  let totalBytes = 0;
  for (const entry of entries) {
    totalBytes += entry.size;
    if (totalBytes > MAX_DECOMPRESSED_BYTES) {
      throw new Error(`Archive decompresses beyond the configured safety limit (${formatBytes(MAX_DECOMPRESSED_BYTES)}) - refusing to extract.`);
    }
    safeJoin(destDir, entry.path);
  }

  ensureDir(destDir);
  await run(tool, ['x', archivePath, `-o${destDir}`, '-y', '-bd', '-bb0']);

  const extracted: string[] = [];
  const walk = (dir: string) => {
    for (const dirEntry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, dirEntry.name);
      if (dirEntry.isDirectory()) walk(full);
      else extracted.push(full);
    }
  };
  walk(destDir);
  return extracted;
}

export async function extractRpf(archivePath: string, destDir: string): Promise<void> {
  const tool = resolveRpfToolPath();
  if (!fs.existsSync(tool)) {
    throw new Error(`Bundled RPF tool not found at ${tool} - this build may be corrupted, try reinstalling.`);
  }
  await run(tool, ['extract', archivePath, '--out', destDir]);
}

/** Downscales any oversized texture in a standalone .ytd, in place, via the bundled rpf-tool's
 *  own `ytd-optimize` subcommand - direct port of native.ts's optimizeYtd (Sollumz can neither
 *  import nor export a standalone texture dictionary at all, confirmed during pulseconvert's own
 *  build - see that file's doc comment - so this patches the container's bytes directly instead,
 *  completely independent of Blender). Returns the new file size if the texture was rewritten, or
 *  null if it was already within maxSize. */
export async function optimizeYtd(ytdPath: string, outputPath: string, maxSize: number): Promise<number | null> {
  const tool = resolveRpfToolPath();
  if (!fs.existsSync(tool)) {
    throw new Error(`Bundled RPF tool not found at ${tool} - this build may be corrupted, try reinstalling.`);
  }
  const stdout = await run(tool, ['ytd-optimize', ytdPath, '--out', outputPath, '--max-size', String(maxSize)]);
  if (stdout.includes('SKIPPED')) return null;
  return fs.statSync(outputPath).size;
}

/** Same shape as the server's own runBlenderConvert (native.ts), minus the two things that only
 *  make sense server-side: no --max-texture-size downscaling decision here (that's a FiveM
 *  performance-profile choice the desktop app's own conversion UI makes separately, wired the
 *  same way as the server does) and no dependency on env.ts. */
export async function runBlenderConvert(inputDir: string, outputDir: string, maxTextureSize: number): Promise<string[]> {
  const blender = detectBlenderPath();
  if (!blender) {
    throw new Error('Blender was not found on this machine. Install Blender 5.1 with the Sollumz extension, or set a custom path in settings.');
  }
  const script = resolveConvertScriptPath();
  const rpfTool = resolveRpfToolPath();

  const args = ['--background', '--factory-startup', '--python', script, '--', '--input', inputDir, '--output', outputDir, '--max-texture-size', String(maxTextureSize)];
  if (fs.existsSync(rpfTool)) args.push('--rpf-tool-path', rpfTool);

  const stdout = await run(blender, args, { CI: '1' });
  return stdout
    .split('\n')
    .filter((line) => line.includes('[convert.py] FIX:'))
    .map((line) => line.split('[convert.py] FIX:')[1].trim());
}
