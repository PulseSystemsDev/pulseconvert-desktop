import { useState } from 'react';
import { ArrowRight, CheckCircle2, Clock3, Gauge, Hammer, LayoutGrid, Link2, RefreshCw, Server, Sparkles, UploadCloud, Zap } from 'lucide-react';
import { pc, type JobListItem, type Task } from '../lib/bridge';
import { useAccount } from '../lib/account';
import { cx, formatBytes, formatDuration, formatNumber, isSupportedSourceUrl, timeAgo } from '../lib/format';
import { useApi } from '../lib/hooks';
import { useRouter } from '../lib/router';
import { useToast } from '../lib/toast';
import { Badge, Button, Card, EmptyState, SectionTitle, Skeleton } from '../components/ui';
import { TaskRow } from '../components/TaskRow';
import { JOB_STATUS_LABEL, SOURCE_ICON, SOURCE_LABEL, isActive, jobTone } from '../components/taskMeta';

interface LiveStats {
  totalConverted: number;
  totalFixesApplied: number;
  totalBytesSaved: number;
  catalogVehiclesIndexed: number;
  activeNow: number;
  avgConversionMs: number;
  workerOnline: boolean;
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return 'Up late';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
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
    const result = await pc.startConvert({ urls: [trimmed], inputs: [], profile: 'preserve', target: (await pc.getSettings()).defaultTarget, packBundleMode: 'separate' });
    setBusy(false);
    if (result.ok) {
      setUrl('');
      toast.success('Conversion started', 'It will download to your output folder when it finishes.', { label: 'View in Jobs', onClick: () => navigate('jobs') });
    } else toast.error('Could not start', result.error);
  };

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-bg-surface p-7">
      <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-accent-orange/[0.09] blur-[80px]" />
      <div className="relative">
        <Badge tone="orange" icon={Sparkles}>
          Quick convert
        </Badge>
        <h2 className="mt-3 text-xl font-bold tracking-tight text-white">Paste a mod link and walk away.</h2>
        <p className="mt-1 text-sm text-slate-400">gta5-mods.com, MediaFire and ShareMods links. The finished resource lands in your output folder.</p>
        <form
          className="mt-5 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="relative flex-1">
            <Link2 className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://www.gta5-mods.com/vehicles/..."
              className={cx('field h-12 pl-10 text-[15px]', invalid && 'border-status-danger/60')}
              spellCheck={false}
            />
          </div>
          <Button type="submit" variant="primary" size="lg" icon={RefreshCw} loading={busy} disabled={!trimmed || invalid}>
            Convert
          </Button>
        </form>
        <div className="mt-3 flex items-center justify-between text-xs">
          {invalid ? <span className="text-status-danger">Only gta5-mods.com, MediaFire and ShareMods links are supported.</span> : <span className="text-slate-500">Have files instead? Drop them anywhere in this window.</span>}
          <button className="font-semibold text-slate-400 hover:text-white" onClick={() => navigate('convert')}>
            More options
          </button>
        </div>
      </div>
    </div>
  );
}

const ACTIONS = [
  { route: 'convert' as const, icon: UploadCloud, title: 'Convert files', desc: 'Archives, folders, packs' },
  { route: 'optimize' as const, icon: Gauge, title: 'Optimize', desc: 'Shrink heavy textures' },
  { route: 'fix' as const, icon: Hammer, title: 'Fix a resource', desc: 'Re-check broken meta' },
  { route: 'catalog' as const, icon: LayoutGrid, title: 'Browse catalog', desc: 'Instant prebuilt downloads' },
];

function RecentJobs() {
  const { data, loading } = useApi<{ jobs: JobListItem[] }>('/api/jobs?limit=6', { poll: 15_000 });
  const { navigate } = useRouter();
  if (loading && !data) return <Skeleton className="h-[260px]" />;
  const jobs = data?.jobs ?? [];
  return (
    <Card>
      <SectionTitle
        title="Recent conversions"
        description="From this app and the website."
        action={
          <Button size="sm" variant="ghost" onClick={() => navigate('jobs')}>
            All jobs <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        }
      />
      {jobs.length === 0 ? (
        <EmptyState icon={Clock3} title="No conversions yet" description="Your conversions will show up here, including ones you start on the website." />
      ) : (
        <ul className="-mx-2">
          {jobs.map((job) => {
            const Icon = SOURCE_ICON[job.sourceType];
            return (
              <li key={job.id}>
                <button onClick={() => navigate('jobs', { job: job.id })} className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-white/[0.03]">
                  <Icon className="h-4 w-4 shrink-0 text-slate-500" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-white">{job.title ?? 'Untitled job'}</span>
                    <span className="block text-[11px] text-slate-500">
                      {SOURCE_LABEL[job.sourceType]} · {timeAgo(job.createdAt)}
                    </span>
                  </span>
                  <Badge tone={jobTone(job.status)}>{JOB_STATUS_LABEL[job.status]}</Badge>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function ServiceStatus() {
  const { data } = useApi<LiveStats>('/api/stats/live', { poll: 10_000 });
  const { navigate } = useRouter();
  return (
    <Card>
      <SectionTitle title="Pulse Convert right now" action={<Button size="sm" variant="ghost" onClick={() => navigate('stats')}>Stats</Button>} />
      {!data ? (
        <Skeleton className="h-24" />
      ) : (
        <div className="space-y-3 text-[13px]">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-slate-400">
              <Server className="h-4 w-4" /> Converter
            </span>
            {data.workerOnline ? <Badge tone="success" icon={CheckCircle2}>Online</Badge> : <Badge tone="warning">Restarting</Badge>}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Jobs in line</span>
            <span className="font-mono text-white">{data.activeNow}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Typical conversion</span>
            <span className="font-mono text-white">{formatDuration(data.avgConversionMs)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Converted so far</span>
            <span className="font-mono text-white">{formatNumber(data.totalConverted)}</span>
          </div>
        </div>
      )}
    </Card>
  );
}

function YourNumbers() {
  const { data } = useAccount();
  if (!data) return <Skeleton className="h-[132px]" />;
  const successRate = data.stats.totalJobs ? Math.round((data.stats.doneJobs / data.stats.totalJobs) * 100) : 0;
  return (
    <Card>
      <SectionTitle title="Your numbers" />
      <div className="grid grid-cols-3 gap-3">
        <div>
          <p className="font-mono text-xl font-bold text-white">{formatNumber(data.stats.doneJobs)}</p>
          <p className="text-[11px] text-slate-500">converted</p>
        </div>
        <div>
          <p className="font-mono text-xl font-bold text-white">{successRate}%</p>
          <p className="text-[11px] text-slate-500">success rate</p>
        </div>
        <div>
          <p className="font-mono text-xl font-bold text-white">{formatBytes(data.stats.totalOutputBytes)}</p>
          <p className="text-[11px] text-slate-500">delivered</p>
        </div>
      </div>
    </Card>
  );
}

export function Home({ tasks }: { tasks: Task[] }) {
  const { data: account } = useAccount();
  const { navigate } = useRouter();
  const active = tasks.filter(isActive);
  const recentDone = tasks.filter((task) => !isActive(task)).slice(0, 3);
  const onDevice = [...active, ...recentDone].slice(0, 4);

  return (
    <div className="mx-auto max-w-[1180px]">
      <header className="mb-7">
        <p className="eyebrow mb-2">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
        <h1 className="text-[28px] font-bold tracking-[-0.015em] text-white">
          {greeting()}
          {account?.username ? `, ${account.username}` : ''}.
        </h1>
      </header>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <QuickConvert />

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {ACTIONS.map(({ route, icon: Icon, title, desc }) => (
              <button key={route} onClick={() => navigate(route)} className="card group flex flex-col items-start p-4 text-left transition-colors hover:border-border hover:bg-bg-elevated">
                <Icon className="h-5 w-5 text-accent-orange" />
                <p className="mt-3 text-sm font-semibold text-white">{title}</p>
                <p className="mt-0.5 text-xs text-slate-500">{desc}</p>
              </button>
            ))}
          </div>

          <Card>
            <SectionTitle
              title="On this device"
              description={active.length ? `${active.length} running now. You can keep working - they finish in the background.` : 'Uploads, conversions and downloads from this app.'}
              action={
                <Button size="sm" variant="ghost" onClick={() => navigate('jobs')}>
                  Jobs <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              }
            />
            {onDevice.length === 0 ? (
              <EmptyState icon={Zap} title="Nothing running" description="Paste a link above or drop a file into the window to get started." />
            ) : (
              <div className="space-y-2">
                {onDevice.map((task) => (
                  <TaskRow key={task.id} task={task} />
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <YourNumbers />
          <ServiceStatus />
          <RecentJobs />
        </div>
      </div>
    </div>
  );
}
