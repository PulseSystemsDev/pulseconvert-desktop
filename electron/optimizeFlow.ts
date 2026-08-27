import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { classifyFiles } from './pipeline/classify';
import { downloadJobOutput, pollJobUntilDone, submitOptimizeJob, zipFolder } from './jobFlow';
import { uploadLocalFile } from './uploadFlow';
import type { OptimizeCategory, OptimizeRequest, OptimizeResult } from './types';

function sanitizeResourceName(input: string): string {
  const cleaned = input
    .toLowerCase()
    .replace(/\.(zip|rar|7z|oiv|rpf)$/i, '')
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned.length > 0 ? cleaned.slice(0, 60) : 'optimized_resource';
}

function uniqueOutputPath(resourceName: string, outputFolder: string): string {
  fs.mkdirSync(outputFolder, { recursive: true });
  const base = `${resourceName}_optimized`;
  let candidate = path.join(outputFolder, `${base}.zip`);
  let suffix = 2;
  while (fs.existsSync(candidate)) candidate = path.join(outputFolder, `${base}_${suffix++}.zip`);
  return candidate;
}

function listFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push(full);
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out;
}

function workDirFor(sessionId: string): string {
  return path.join(app.getPath('temp'), 'pulseconvert-desktop', `optimize-${sessionId}`);
}

function removeWorkDir(workDir: string): void {
  const base = path.resolve(app.getPath('temp'), 'pulseconvert-desktop');
  const resolved = path.resolve(workDir);
  if (resolved.startsWith(base + path.sep)) fs.rmSync(resolved, { recursive: true, force: true });
}

export async function runManualOptimize(
  request: OptimizeRequest,
  onProgress: (label: string, current?: number, total?: number) => void,
  outputFolder: string,
): Promise<OptimizeResult> {
  const sessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const workDir = workDirFor(sessionId);

  try {
    let archivePath = request.inputPath;
    if (request.inputKind === 'folder') {
      onProgress('Zipping the resource folder');
      archivePath = path.join(workDir, `${path.basename(request.inputPath)}.zip`);
      await zipFolder(request.inputPath, archivePath);
    }

    onProgress('Uploading file', 0, 1);
    const { uploadId } = await uploadLocalFile(archivePath, (sent, total) => onProgress('Uploading file', sent, total));
    onProgress('Submitting to the server');
    const { jobId } = await submitOptimizeJob(uploadId, request.category);
    const job = await pollJobUntilDone(jobId, onProgress);

    const resourceName = sanitizeResourceName(job.title ?? path.basename(request.inputPath));
    const outputZipPath = uniqueOutputPath(resourceName, outputFolder);
    await downloadJobOutput(job, outputZipPath);
    return { outputZipPath, resourceName, category: request.category, fixLog: job.fixLog, outputSizeBytes: fs.statSync(outputZipPath).size };
  } finally {
    removeWorkDir(workDir);
  }
}

export interface LocalOptimizeSummary {
  scanned: number;
  optimized: number;
  fixLog: string[];
  outputs: OptimizeResult[];
}

function detectResourceCategory(resourceFolder: string): OptimizeCategory {
  const files = classifyFiles(listFilesRecursive(resourceFolder));
  if (files.meta.vehicles.length > 0 || files.yft.length > 0) return 'vehicles';
  if (files.ydd.length > 0) return 'clothing';
  if (files.ydr.length > 0) return 'props';
  return 'textures';
}

export async function runLocalOptimize(
  targetFolder: string,
  outputFolder: string,
  onProgress: (label: string, current?: number, total?: number) => void,
): Promise<LocalOptimizeSummary> {
  if (!fs.existsSync(targetFolder) || !fs.statSync(targetFolder).isDirectory()) {
    throw new Error(`Deploy folder does not exist: ${targetFolder}`);
  }
  const targetIsResource = fs.existsSync(path.join(targetFolder, 'stream'));
  const candidates = targetIsResource
    ? [targetFolder]
    : fs.readdirSync(targetFolder, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && fs.existsSync(path.join(targetFolder, entry.name, 'stream')))
        .map((entry) => path.join(targetFolder, entry.name));

  const outputs: OptimizeResult[] = [];
  const fixLog: string[] = [];

  for (const [index, resourceFolder] of candidates.entries()) {
    const resourceLabel = path.basename(resourceFolder);
    onProgress(`Optimizing ${resourceLabel} (${index + 1}/${candidates.length})`, index + 1, candidates.length);
    try {
      const category = detectResourceCategory(resourceFolder);
      const result = await runManualOptimize(
        { inputPath: resourceFolder, inputKind: 'folder', category },
        (label, current, total) => onProgress(`${resourceLabel}: ${label}`, current, total),
        outputFolder,
      );
      outputs.push(result);
      fixLog.push(...result.fixLog.map((line) => `${resourceLabel}: ${line}`));
    } catch (err) {
      fixLog.push(`${resourceLabel}: skipped (${(err as Error).message})`);
    }
  }

  return { scanned: candidates.length, optimized: outputs.length, fixLog, outputs };
}
