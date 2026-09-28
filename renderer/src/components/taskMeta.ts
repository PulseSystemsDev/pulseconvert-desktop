import {
  AlertTriangle,
  Ban,
  CarFront,
  CheckCircle2,
  Download,
  FileSearch,
  Gauge,
  Layers,
  Link2,
  Loader2,
  Rocket,
  Siren,
  UploadCloud,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { JobListItem, Task, TaskKind, TaskPhase } from '../lib/bridge';

export const KIND_ICON: Record<TaskKind, LucideIcon> = {
  'convert-url': Link2,
  'convert-file': UploadCloud,
  'convert-pack': Layers,
  optimize: Gauge,
  fix: Wrench,
  'catalog-download': CarFront,
  'job-download': Download,
  'siren-build': Siren,
  'map-inspect': FileSearch,
  deploy: Rocket,
};

export type Tone = 'neutral' | 'orange' | 'teal' | 'success' | 'danger' | 'warning' | 'info';

export function phaseTone(phase: TaskPhase): Tone {
  if (phase === 'done') return 'success';
  if (phase === 'failed') return 'danger';
  if (phase === 'cancelled') return 'neutral';
  if (phase === 'queued' || phase === 'waiting' || phase === 'scraping') return 'info';
  return 'orange';
}

export const PHASE_LABEL: Record<TaskPhase, string> = {
  waiting: 'Waiting',
  preparing: 'Preparing',
  uploading: 'Uploading',
  submitting: 'Submitting',
  scraping: 'Finding source',
  queued: 'Queued',
  processing: 'Processing',
  downloading: 'Downloading',
  deploying: 'Deploying',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export function phaseIcon(phase: TaskPhase): LucideIcon {
  if (phase === 'done') return CheckCircle2;
  if (phase === 'failed') return AlertTriangle;
  if (phase === 'cancelled') return Ban;
  return Loader2;
}

export function isActive(task: Task): boolean {
  return !['done', 'failed', 'cancelled'].includes(task.phase);
}

export const SOURCE_LABEL: Record<JobListItem['sourceType'], string> = {
  url: 'Link conversion',
  upload: 'File conversion',
  batch: 'Pack',
  fix: 'Fix',
  optimize: 'Optimize',
};

export const SOURCE_ICON: Record<JobListItem['sourceType'], LucideIcon> = {
  url: Link2,
  upload: UploadCloud,
  batch: Layers,
  fix: Wrench,
  optimize: Gauge,
};

export function jobTone(status: JobListItem['status']): Tone {
  if (status === 'done') return 'success';
  if (status === 'failed') return 'danger';
  if (status === 'processing') return 'orange';
  return 'info';
}

export const JOB_STATUS_LABEL: Record<JobListItem['status'], string> = {
  scraping: 'Finding source',
  queued: 'Queued',
  processing: 'Processing',
  done: 'Done',
  failed: 'Failed',
};
