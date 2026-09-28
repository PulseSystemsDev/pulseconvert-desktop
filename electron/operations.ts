import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import config from './configStore';
import { ApiError, desktopFetch, desktopFetchJson, postJson } from './apiClient';
import { applyConfiguredDeploy } from './deploy/deployFlow';
import { registerOutput, safeStem, uniqueOutputPath } from './files';
import { classifyFiles } from './pipeline/classify';
import { taskManager, uploadSlots, type TaskContext } from './taskManager';
import { downloadToFile, sleep, throwIfAborted, uploadLocalFile, zipFolder } from './transfer';
import type {
  CatalogDownloadRequest,
  ConversionProfile,
  ConversionTarget,
  JobRecord,
  OptimizeCategory,
  SelectedInput,
  SirenBuildRequest,
  Task,
  TaskOrigin,
} from './types';

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_FAILURES = 15;

function workDir(prefix: string): string {
  const dir = path.join(app.getPath('temp'), 'pulseconvert-desktop', `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function removeWorkDir(dir: string): void {
  const base = path.resolve(app.getPath('temp'), 'pulseconvert-desktop');
  const resolved = path.resolve(dir);
  if (resolved.startsWith(base + path.sep)) fs.rmSync(resolved, { recursive: true, force: true });
}

function titleFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split('/').filter(Boolean).pop();
    return last ? decodeURIComponent(last).replace(/[-_]+/g, ' ') : parsed.hostname;
  } catch {
    return url;
  }
}

/** Uploads a local archive, or zips-then-uploads a folder, reporting progress within the
 *  [from, to] slice of the task's overall percentage. */
async function uploadInput(ctx: TaskContext, input: SelectedInput, from: number, to: number, label = 'Uploading'): Promise<string> {
  const release = await uploadSlots.acquire(ctx.signal);
  const temp = input.inputKind === 'folder' ? workDir('upload') : null;
  try {
    let filePath = input.inputPath;
    if (temp) {
      ctx.progress('preparing', `Packing ${input.name}`, from);
      filePath = path.join(temp, `${safeStem(input.name, 'resource')}.zip`);
      await zipFolder(input.inputPath, filePath);
    }
    throwIfAborted(ctx.signal);
    ctx.progress('uploading', `${label} ${input.name}`, from);
    const { uploadId } = await uploadLocalFile(
      filePath,
      (sent, total) => ctx.progress('uploading', `${label} ${input.name}`, from + ((to - from) * sent) / Math.max(total, 1)),
      ctx.signal,
    );
    return uploadId;
  } finally {
    release();
    if (temp) removeWorkDir(temp);
  }
}

function describeJob(job: JobRecord): { phase: Task['phase']; label: string; percent: number | null } {
  if (job.status === 'scraping') {
    if (job.batch) return { phase: 'scraping', label: `Finding sources (${job.batch.done}/${job.batch.total})`, percent: null };
    return { phase: 'scraping', label: job.scrapeQueuePosition > 0 ? `Finding the mod source (${job.scrapeQueuePosition} ahead)` : 'Finding the mod source', percent: null };
  }
  if (job.status === 'queued') {
    return { phase: 'queued', label: job.queuePosition > 0 ? `In the server queue, ${job.queuePosition} ahead of you` : 'Next in the server queue', percent: null };
  }
  const { label, current, total } = job.progress;
  let text = label ?? 'Processing on the server';
  if (job.batch && job.batch.total > 1) {
    text = `${job.batch.currentTitle ?? 'Vehicle'} (${Math.min(job.batch.currentIndex + 1, job.batch.total)}/${job.batch.total}) - ${text}`;
  }
  return { phase: 'processing', label: text, percent: current != null && total ? Math.round((current / total) * 100) : null };
}

async function pollJob(ctx: TaskContext, jobId: string, from: number, to: number): Promise<JobRecord> {
  let failures = 0;
  for (;;) {
    throwIfAborted(ctx.signal);
    let job: JobRecord;
    try {
      job = await desktopFetchJson<JobRecord>(`/api/jobs/${encodeURIComponent(jobId)}`, { signal: ctx.signal });
      failures = 0;
    } catch (err) {
      if (ctx.signal.aborted) throwIfAborted(ctx.signal);
      if (err instanceof ApiError && (err.status === 404 || err.status === 401 || err.status === 403)) throw err;
      failures += 1;
      if (failures >= MAX_POLL_FAILURES) throw new Error(`Lost contact with the server: ${(err as Error).message}`);
      ctx.progress(ctx.task.phase, 'Reconnecting to the server...', ctx.task.percent);
      await sleep(Math.min(POLL_INTERVAL_MS * failures, 15_000), ctx.signal);
      continue;
    }

    if (job.title && job.title !== ctx.task.title) ctx.update({ title: job.title });
    if (job.status === 'done') {
      ctx.update({ fixLog: job.fixLog ?? [], outputSizeBytes: job.outputSizeBytes, queuePosition: null, etaMs: null });
      return job;
    }
    if (job.status === 'failed') {
      ctx.update({ fixLog: job.fixLog ?? [] });
      throw new Error(job.error ?? 'The server could not finish this job.');
    }
    const view = describeJob(job);
    ctx.update({
      phase: view.phase,
      label: view.label,
      percent: view.percent == null ? null : from + ((to - from) * view.percent) / 100,
      queuePosition: job.status === 'queued' ? job.queuePosition : null,
      etaMs: job.etaMs,
    });
    await sleep(POLL_INTERVAL_MS, ctx.signal);
  }
}

async function downloadResult(ctx: TaskContext, url: string, stem: string, from: number, to: number, extension = '.zip'): Promise<string> {
  const outputPath = uniqueOutputPath(stem, extension);
  ctx.progress('downloading', 'Downloading the result', from);
  const bytes = await downloadToFile(
    url,
    outputPath,
    (received, total) => ctx.progress('downloading', 'Downloading the result', total ? from + ((to - from) * received) / total : null),
    ctx.signal,
  );
  registerOutput(outputPath);
  ctx.update({ outputPath, outputSizeBytes: bytes });
  return outputPath;
}

async function maybeDeploy(ctx: TaskContext, outputPath: string): Promise<void> {
  if (config.get('deployMode') === 'none') return;
  ctx.progress('deploying', 'Deploying', 98);
  const outcome = await applyConfiguredDeploy(outputPath);
  ctx.update({ deploy: outcome });
}

/** Shared tail for every server job: wait for it, then (unless the user turned it off) pull the
 *  result down into the output folder and run the configured deploy. */
async function finishServerJob(ctx: TaskContext, jobId: string, fallbackStem: string, from: number, alwaysDownload = false, suffix = ''): Promise<JobRecord> {
  ctx.update({ jobId });
  const job = await pollJob(ctx, jobId, from, 90);
  const shouldDownload = alwaysDownload || ctx.task.origin === 'dashboard' || config.get('autoDownload');
  if (!shouldDownload) {
    ctx.progress('done', 'Ready to download', 100);
    return job;
  }
  if (!job.downloadUrl) throw new Error('The server finished the job but did not return a download link.');
  const outputPath = await downloadResult(ctx, job.downloadUrl, `${safeStem(job.title ?? fallbackStem, 'resource')}${suffix}`, 90, 98);
  await maybeDeploy(ctx, outputPath);
  ctx.progress('done', 'Finished', 100);
  return job;
}

interface ConvertItems {
  urls: string[];
  inputs: SelectedInput[];
  profile: ConversionProfile;
  target: ConversionTarget;
  packBundleMode: 'separate' | 'single';
}

export function startConvert(items: ConvertItems, origin: TaskOrigin = 'app'): Task {
  const count = items.urls.length + items.inputs.length;
  if (count === 0) throw new Error('Add a link or a file to convert.');

  if (count > 1) {
    const task = taskManager.create('convert-pack', `Pack of ${count} items`, origin, `${items.target === 'replace' ? 'Replacement' : 'Add-on'} pack`);
    void taskManager.run(task, async (ctx) => {
      const packItems: Array<{ sourceType: 'upload'; uploadId: string } | { sourceType: 'url'; url: string }> = [];
      const slice = items.inputs.length ? 40 / items.inputs.length : 0;
      for (const [index, input] of items.inputs.entries()) {
        const uploadId = await uploadInput(ctx, input, index * slice, (index + 1) * slice, `Uploading (${index + 1}/${items.inputs.length})`);
        packItems.push({ sourceType: 'upload', uploadId });
      }
      for (const url of items.urls) packItems.push({ sourceType: 'url', url });
      ctx.progress('submitting', 'Submitting the pack', 40);
      const { jobId } = await postJson<{ jobId: string }>(
        '/api/jobs/batch',
        { items: packItems, conversionProfile: items.profile, conversionTarget: items.target, packBundleMode: items.packBundleMode },
        ctx.signal,
      );
      await finishServerJob(ctx, jobId, 'vehicle_pack', 40);
    });
    return task;
  }

  if (items.urls.length === 1) {
    const url = items.urls[0];
    const task = taskManager.create('convert-url', titleFromUrl(url), origin, new URL(url).hostname.replace(/^www\./, ''));
    void taskManager.run(task, async (ctx) => {
      ctx.progress('submitting', 'Sending the link to Pulse Convert', 2);
      const { jobId } = await postJson<{ jobId: string }>('/api/jobs', { sourceType: 'url', url, conversionProfile: items.profile, conversionTarget: items.target }, ctx.signal);
      await finishServerJob(ctx, jobId, titleFromUrl(url), 5);
    });
    return task;
  }

  const input = items.inputs[0];
  const task = taskManager.create('convert-file', input.name, origin, items.target === 'replace' ? 'Replacement' : 'Add-on');
  void taskManager.run(task, async (ctx) => {
    const uploadId = await uploadInput(ctx, input, 0, 45);
    ctx.progress('submitting', 'Submitting to the server', 45);
    const { jobId } = await postJson<{ jobId: string }>(
      '/api/jobs',
      { sourceType: 'upload', uploadId, conversionProfile: items.profile, conversionTarget: items.target },
      ctx.signal,
    );
    await finishServerJob(ctx, jobId, input.name, 50);
  });
  return task;
}

const OPTIMIZE_LABELS: Record<OptimizeCategory, string> = { props: 'Props', vehicles: 'Vehicles', clothing: 'Clothing', textures: 'Textures' };

export function startOptimize(input: SelectedInput, category: OptimizeCategory, origin: TaskOrigin = 'app'): Task {
  const task = taskManager.create('optimize', input.name, origin, `Optimize - ${OPTIMIZE_LABELS[category]}`);
  void taskManager.run(task, async (ctx) => {
    const uploadId = await uploadInput(ctx, input, 0, 45);
    ctx.progress('submitting', 'Submitting to the server', 45);
    const { jobId } = await postJson<{ jobId: string }>('/api/jobs', { sourceType: 'optimize', uploadId, optimizeCategory: category }, ctx.signal);
    await finishServerJob(ctx, jobId, input.name, 50, false, '_optimized');
  });
  return task;
}

export function startFix(input: SelectedInput): Task {
  const task = taskManager.create('fix', input.name, 'app', 'Fix resource');
  void taskManager.run(task, async (ctx) => {
    const uploadId = await uploadInput(ctx, input, 0, 45);
    ctx.progress('submitting', 'Submitting to the server', 45);
    const { jobId } = await postJson<{ jobId: string }>('/api/jobs', { sourceType: 'fix', uploadId }, ctx.signal);
    await finishServerJob(ctx, jobId, input.name, 50, false, '_fixed');
  });
  return task;
}

/** Follows a job that was started somewhere else (the website, or before a restart). */
export function trackJob(jobId: string, title: string | null, existing?: Task): Task {
  const task = existing ?? taskManager.create('job-download', title ?? 'Conversion', 'app', 'Server job');
  void taskManager.run(task, async (ctx) => {
    await finishServerJob(ctx, jobId, title ?? jobId, 0);
  });
  return task;
}

export function downloadJob(jobId: string, title: string | null): Task {
  const task = taskManager.create('job-download', title ?? 'Conversion', 'app', 'Download');
  void taskManager.run(task, async (ctx) => {
    ctx.update({ jobId });
    const job = await desktopFetchJson<JobRecord>(`/api/jobs/${encodeURIComponent(jobId)}`, { signal: ctx.signal });
    if (job.status !== 'done' || !job.downloadUrl) throw new Error('This job has no files to download (it may have expired).');
    ctx.update({ fixLog: job.fixLog ?? [] });
    await downloadResult(ctx, job.downloadUrl, safeStem(job.title ?? title ?? jobId, 'resource'), 0, 100);
    ctx.progress('done', 'Saved to your output folder', 100);
  });
  return task;
}

export function downloadCatalogItem(request: CatalogDownloadRequest): Task {
  const task = taskManager.create('catalog-download', request.title, 'app', request.kind === 'vehicle' ? 'Instant download' : 'Animation download');
  void taskManager.run(task, async (ctx) => {
    const url =
      request.kind === 'vehicle'
        ? `/api/vehicles/${encodeURIComponent(request.id)}/prebuilt?target=addon&profile=preserve`
        : `/api/animations/${encodeURIComponent(request.id)}/prebuilt`;
    try {
      const outputPath = await downloadResult(ctx, url, safeStem(request.title, 'catalog_item'), 0, 95);
      await maybeDeploy(ctx, outputPath);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 404)) throw err;
      // No prebuilt copy yet - fall back to a normal server conversion of the catalog entry.
      ctx.progress('submitting', 'No prebuilt copy yet, starting a conversion', 5);
      const convertPath = request.kind === 'vehicle' ? `/api/vehicles/${encodeURIComponent(request.id)}/convert` : `/api/animations/${encodeURIComponent(request.id)}/convert`;
      const { jobId } = await postJson<{ jobId: string }>(convertPath, { conversionProfile: 'preserve', conversionTarget: config.get('defaultTarget') }, ctx.signal);
      await finishServerJob(ctx, jobId, request.title, 10, true);
    }
    ctx.progress('done', 'Finished', 100);
  });
  return task;
}

export function deployExisting(outputPath: string): Task {
  const task = taskManager.create('deploy', path.basename(outputPath), 'app', 'Deploy');
  void taskManager.run(task, async (ctx) => {
    if (config.get('deployMode') === 'none') throw new Error('Choose a deploy destination in Deploy settings first.');
    ctx.update({ outputPath });
    ctx.progress('deploying', 'Deploying', 30);
    const outcome = await applyConfiguredDeploy(outputPath);
    ctx.update({ deploy: outcome });
    if (!outcome.deployed) throw new Error(outcome.error ?? 'Deploy failed.');
    ctx.progress('done', `Deployed to ${outcome.destination ?? 'server'}`, 100);
  });
  return task;
}

export function startSirenBuild(input: SelectedInput, request: SirenBuildRequest): Task {
  const task = taskManager.create('siren-build', request.resourceName, 'app', 'Siren resource');
  void taskManager.run(task, async (ctx) => {
    const uploadId = await uploadInput(ctx, input, 0, 60);
    ctx.progress('processing', 'Building the siren resource', 70);
    const res = await desktopFetch('/api/tools/siren-builder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uploadId,
        resourceName: request.resourceName,
        dlcName: request.dlcName,
        soundsetName: request.soundsetName,
        tones: request.tones,
        gamedataPath: request.gamedataPath || undefined,
        sounddataPath: request.sounddataPath || undefined,
        wavepackPath: request.wavepackPath || undefined,
      }),
      signal: ctx.signal,
    });
    const outputPath = uniqueOutputPath(safeStem(request.resourceName, 'siren_resource'));
    fs.writeFileSync(outputPath, Buffer.from(await res.arrayBuffer()));
    registerOutput(outputPath);
    ctx.update({ outputPath, outputSizeBytes: fs.statSync(outputPath).size });
    ctx.progress('done', 'Siren resource saved', 100);
  });
  return task;
}

export function startMapInspect(input: SelectedInput): Task {
  const task = taskManager.create('map-inspect', input.name, 'app', 'Map & MLO inspection');
  void taskManager.run(task, async (ctx) => {
    const uploadId = await uploadInput(ctx, input, 0, 70);
    ctx.progress('processing', 'Inspecting the map', 80);
    const { report } = await postJson<{ report: unknown }>('/api/tools/map-inspect', { uploadId }, ctx.signal);
    ctx.update({ result: report });
    ctx.progress('done', 'Inspection complete', 100);
  });
  return task;
}

function listFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push(full);
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out;
}

function detectResourceCategory(resourceFolder: string): OptimizeCategory {
  const files = classifyFiles(listFilesRecursive(resourceFolder));
  if (files.meta.vehicles.length > 0 || files.yft.length > 0) return 'vehicles';
  if (files.ydd.length > 0) return 'clothing';
  if (files.ydr.length > 0) return 'props';
  return 'textures';
}

/** Dashboard "optimize my server" command: optimizes every resource in the configured local
 *  deploy folder as its own task so each one shows up (and can fail) independently. */
export async function optimizeDeployFolder(folder: string): Promise<{ scanned: number; optimized: number; outputs: string[]; errors: string[] }> {
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) throw new Error(`Deploy folder does not exist: ${folder}`);
  const candidates = fs.existsSync(path.join(folder, 'stream'))
    ? [folder]
    : fs
        .readdirSync(folder, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && fs.existsSync(path.join(folder, entry.name, 'stream')))
        .map((entry) => path.join(folder, entry.name));

  const outputs: string[] = [];
  const errors: string[] = [];
  for (const resource of candidates) {
    const input: SelectedInput = { inputPath: resource, inputKind: 'folder', name: path.basename(resource), sizeBytes: null };
    const task = startOptimize(input, detectResourceCategory(resource), 'dashboard');
    const finished = await waitForTask(task.id);
    if (finished.phase === 'done' && finished.outputPath) outputs.push(finished.outputPath);
    else errors.push(`${input.name}: ${finished.error ?? finished.phase}`);
  }
  return { scanned: candidates.length, optimized: outputs.length, outputs, errors };
}

export function waitForTask(taskId: string): Promise<Task> {
  return new Promise((resolve) => {
    const check = (task: Task) => {
      if (task.id !== taskId) return;
      stop();
      resolve(task);
    };
    const stop = taskManager.onFinish(check);
    const current = taskManager.get(taskId);
    if (current && ['done', 'failed', 'cancelled'].includes(current.phase)) {
      stop();
      resolve(current);
    }
  });
}

/** Picks up tasks that were mid-flight when the app last closed. A job the server already has
 *  keeps being tracked; anything that never reached the server can't be resumed. */
export function resumeInterruptedTasks(): void {
  for (const task of taskManager.interruptedTasks()) {
    if (task.jobId) {
      trackJob(task.jobId, task.title, task);
    } else {
      void taskManager.run(task, async () => {
        throw new Error('Interrupted when the app closed. Start it again to retry.');
      });
    }
  }
}
