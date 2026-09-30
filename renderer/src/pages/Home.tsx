import { useState } from 'react';
import { ArrowRight, Clock3, Link2 } from 'lucide-react';
import { pc, type JobListItem, type Task } from '../lib/bridge';
import { useAccount } from '../lib/account';
import { cx, formatBytes, formatDuration, formatNumber, isSupportedSourceUrl, timeAgo } from '../lib/format';
import { useApi } from '../lib/hooks';
import { useRouter } from '../lib/router';
import { useToast } from '../lib/toast';
import { Badge, Button, EmptyState, Skeleton, StatTile } from '../components/ui';
import { TaskRow } from '../components/TaskRow';
import { JOB_STATUS_LABEL, SOURCE_ICON, SOURCE_LABEL, isActive, jobTone } from '../components/taskMeta';
import type React from 'react';

interface LiveStats {
  totalConverted: number;
  totalFixesApplied: number;
  totalBytesSaved: number;
  catalogVehiclesIndexed: number;
  activeNow: number;
  avgConversionMs: number;
  workerOnline: boolean;
}

function QuickConvert() {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const { navigate } = useRouter();
  const toast = useToast();
  const trimmed = url.trim();
  const invalid = trimmed.length > 0 && !isSupportedSourceUrl(trimmed);

  const submit = async () => {
    if (!trimmed || invalid) return;
    setBusy(true);
    const result = await pc.startConvert({ urls: [trimmed], inputs: [], profile: 'preserve', target: 'addon', packBundleMode: 'separate' });
    setBusy(false);
    if (result.ok) {
      setUrl('');
      toast.success('Conversion started', 'It will download to your output folder when it finishes.', { label: 'View in Jobs', onClick: () => navigate('jobs') });
    } else toast.error('Could not start', result.error);
  };

  return (
    <div>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="relative flex-1">
          <Link2 className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="Paste a gta5-mods.com, MediaFire or ShareMods link"
            className={cx('field h-9 pl-8', invalid && 'border-status-danger/60')}
            spellCheck={false}
          />
        </div>
        <Button type="submit" variant="primary" size="lg" loading={busy} disabled={!trimmed || invalid}>
          Convert
        </Button>
        <Button size="lg" onClick={() => navigate('convert')}>
          Files or pack...
        </Button>
      </form>
      <p className="mt-1.5 text-[12px] text-zinc-500">
        {invalid ? <span className="text-status-danger">That site isn&apos;t supported. Use gta5-mods.com, MediaFire or ShareMods, or download it and drop the file here.</span> : 'You can also drop files anywhere in this window.'}
      </p>
    </div>
  );
}

function Numbers() {
  const { data: account } = useAccount();
  const { data: live } = useApi<LiveStats>('/api/stats/live', { poll: 10_000 });
  const rate = account?.stats.totalJobs ? `${Math.round((account.stats.doneJobs / account.stats.totalJobs) * 100)}%` : '-';
  return (
    <div className="grid grid-cols-2 gap-y-3 sm:grid-cols-5">
      <StatTile label="You converted" value={account ? formatNumber(account.stats.doneJobs) : '-'} />
      <StatTile label="Succeeded" value={rate} />
      <StatTile label="Delivered" value={account ? formatBytes(account.stats.totalOutputBytes) : '-'} />
      <StatTile label="Server queue" value={live ? live.activeNow : '-'} sub={live ? (live.workerOnline ? 'converter online' : 'converter restarting') : undefined} />
      <StatTile label="Typical job" value={live ? formatDuration(live.avgConversionMs) : '-'} />
    </div>
  );
}

function RecentJobs() {
  const { data, loading } = useApi<{ jobs: JobListItem[] }>('/api/jobs?limit=8', { poll: 15_000 });
  const { navigate } = useRouter();
  if (loading && !data) return <Skeleton className="h-[260px]" />;
  const jobs = data?.jobs ?? [];
  if (jobs.length === 0) return <EmptyState icon={Clock3} title="No conversions yet" description="Jobs from this app and the website show up here." />;
  return (
    <ul className="divide-y divide-border-subtle border-y border-border-subtle">
      {jobs.map((job) => {
        const Icon = SOURCE_ICON[job.sourceType];
        return (
          <li key={job.id}>
            <button onClick={() => navigate('jobs', { job: job.id })} className="flex w-full items-center gap-3 px-1 py-2 text-left transition-colors hover:bg-white/[0.03]">
              <Icon className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
              <span className="min-w-0 flex-1 truncate text-[13px] text-zinc-100">{job.title ?? 'Untitled job'}</span>
              <span className="hidden w-28 shrink-0 text-[12px] text-zinc-500 lg:block">{SOURCE_LABEL[job.sourceType]}</span>
              <span className="w-24 shrink-0">
                <Badge tone={jobTone(job.status)}>{JOB_STATUS_LABEL[job.status]}</Badge>
              </span>
              <span className="w-16 shrink-0 text-right text-[12px] text-zinc-500">{timeAgo(job.createdAt)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Heading({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <h2 className="text-[13px] font-semibold text-zinc-100">{title}</h2>
      {action}
    </div>
  );
}

export function Home({ tasks }: { tasks: Task[] }) {
  const { navigate } = useRouter();
  const active = tasks.filter(isActive);
  const recentDone = tasks.filter((task) => !isActive(task)).slice(0, 3);
  const onDevice = [...active, ...recentDone].slice(0, 5);
  const more = (label: string, route: 'jobs') => (
    <button className="flex items-center gap-1 text-[12px] text-zinc-500 hover:text-white" onClick={() => navigate(route)}>
      {label} <ArrowRight className="h-3 w-3" />
    </button>
  );

  return (
    <div className="mx-auto max-w-[1100px] space-y-7">
      <QuickConvert />
      <Numbers />
      <section>
        <Heading title={active.length ? `On this device (${active.length} running)` : 'On this device'} action={more('Jobs', 'jobs')} />
        {onDevice.length === 0 ? (
          <p className="border-y border-border-subtle py-6 text-center text-[12px] text-zinc-500">Nothing running. Paste a link above or drop a file into the window.</p>
        ) : (
          <div className="space-y-1.5">
            {onDevice.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </div>
        )}
      </section>
      <section>
        <Heading title="Recent jobs" action={more('All jobs', 'jobs')} />
        <RecentJobs />
      </section>
    </div>
  );
}
