import fs from 'fs';
import path from 'path';
import { desktopFetchJson } from './apiClient';
import { downloadJobOutput, downloadToFile, pollJobUntilDone, submitConvertJob } from './jobFlow';
import { uploadLocalFile } from './uploadFlow';
import type { ConvertRequest } from './types';

interface ResolveResponse {
  status: 'cached' | 'resolved';
  catalogVehicleId?: string;
  title?: string;
  downloadUrl: string;
  author?: string;
  licenseText?: string;
  realBrand?: string;
}

function safeOutputStem(value: string): string {
  const cleaned = value.toLowerCase().replace(/\.zip$/i, '').replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned.slice(0, 60) || 'converted_vehicle';
}

function uniqueOutputPath(resourceName: string, outputFolder: string): string {
  fs.mkdirSync(outputFolder, { recursive: true });
  const stem = safeOutputStem(resourceName);
  let candidate = path.join(outputFolder, `${stem}.zip`);
  let suffix = 2;
  while (fs.existsSync(candidate)) candidate = path.join(outputFolder, `${stem}_${suffix++}.zip`);
  return candidate;
}

export interface ConvertFlowResult {
  outputZipPath: string;
  resourceName: string;
  fixLog: string[];
  fromCache: boolean;
}

function twoPhaseProgress(onProgress: (label: string, current?: number, total?: number) => void) {
  return {
    upload: (label: string, current: number, total: number) => onProgress(label, Math.round((current / total) * 50), 100),
    job: (label: string, current?: number, total?: number) => {
      if (current != null && total) onProgress(label, Math.round(50 + (current / total) * 50), 100);
      else onProgress(label);
    },
  };
}

export async function runConvertFlow(
  request: ConvertRequest & { inputPath?: string },
  onProgress: (label: string, current?: number, total?: number) => void,
  outputFolder: string,
): Promise<ConvertFlowResult> {
  const { profile, target, inputPath } = request;

  if (inputPath) {
    const phases = twoPhaseProgress(onProgress);
    phases.upload('Uploading file', 0, 1);
    const { uploadId } = await uploadLocalFile(inputPath, (sent, total) => phases.upload('Uploading file', sent, total));
    phases.job('Submitting to the server');
    const { jobId } = await submitConvertJob(undefined, uploadId, profile, target);
    const job = await pollJobUntilDone(jobId, phases.job);
    const resourceName = safeOutputStem(job.title ?? path.basename(inputPath));
    const outputZipPath = uniqueOutputPath(resourceName, outputFolder);
    await downloadJobOutput(job, outputZipPath);
    return { outputZipPath, resourceName, fixLog: job.fixLog, fromCache: false };
  }

  const url = request.url;
  onProgress('Checking the catalog');
  const resolved = await desktopFetchJson<ResolveResponse>('/api/desktop/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, conversionProfile: profile, conversionTarget: target }),
  });

  if (resolved.status === 'cached') {
    onProgress('Already converted - downloading the cached copy');
    const resourceName = safeOutputStem(resolved.title ?? 'vehicle');
    const outputZipPath = uniqueOutputPath(resourceName, outputFolder);
    await downloadToFile(resolved.downloadUrl, outputZipPath);
    return { outputZipPath, resourceName, fixLog: [], fromCache: true };
  }

  onProgress('Submitting to the server');
  const { jobId } = await submitConvertJob(url, undefined, profile, target);
  const job = await pollJobUntilDone(jobId, onProgress);
  const resourceName = safeOutputStem(job.title ?? resolved.title ?? 'converted_vehicle');
  const outputZipPath = uniqueOutputPath(resourceName, outputFolder);
  await downloadJobOutput(job, outputZipPath);
  return { outputZipPath, resourceName, fixLog: job.fixLog, fromCache: false };
}
