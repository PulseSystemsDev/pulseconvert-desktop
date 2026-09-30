import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Box,
  CheckCircle2,
  Clock3,
  Download,
  FolderOpen,
  ImagePlus,
  ListTodo,
  RefreshCw,
  Rocket,
  ShieldCheck,
  Trash2,
  Wrench,
} from 'lucide-react';
import { pc, type JobListItem, type JobRecord, type Task } from '../lib/bridge';
import { cx, formatBytes, formatDuration, timeAgo } from '../lib/format';
import { useApi, useNow } from '../lib/hooks';
import { useRouter } from '../lib/router';
import { useToast } from '../lib/toast';
import { Badge, Button, Card, Drawer, EmptyState, ErrorNote, PageHeader, ProgressBar, Segmented, SectionTitle, Skeleton } from '../components/ui';
import { TaskRow } from '../components/TaskRow';
import { JOB_STATUS_LABEL, SOURCE_ICON, SOURCE_LABEL, isActive, jobTone } from '../components/taskMeta';

const ModelViewer = lazy(() => import('../components/ModelViewer'));

type Filter = 'all' | 'active' | 'done' | 'failed';

function JobDrawer({ jobId, listItem, tasks, onClose, onChanged }: { jobId: string; listItem: JobListItem | null; tasks: Task[]; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const { navigate } = useRouter();
  const [poll, setPoll] = useState<number | undefined>(undefined);
  const { data: job, error, reload } = useApi<JobRecord>(`/api/jobs/${jobId}`, { poll });
  const [show3d, setShow3d] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const localTask = tasks.find((task) => task.jobId === jobId && task.outputPath && task.phase === 'done');
  const trackingTask = tasks.find((task) => task.jobId === jobId && isActive(task));
  const running = job && job.status !== 'done' && job.status !== 'failed';

  useEffect(() => setPoll(running ? 2500 : undefined), [running]);
  useEffect(() => setShow3d(false), [jobId]);

  const act = async (key: string, fn: () => Promise<{ ok: boolean; error?: string }>, success: string) => {
    setBusy(key);
    const result = await fn();
    setBusy(null);
    if (result.ok) toast.success(success);
    else toast.error('That did not work', result.error);
    return result.ok;
  };

  const title = job?.title ?? listItem?.title ?? 'Job';
  const hasActions = !!job && ((job.status === 'done' && !!job.downloadUrl) || !!localTask?.outputPath || (!!running && !trackingTask) || (listItem?.sourceType === 'url' && !running));
  const fixLog = job?.fixLog ?? [];

  return (
    <Drawer
      open
      onClose={onClose}
      width={640}
      title={title}
      subtitle={
        <span className="flex items-center gap-2">
          {listItem && SOURCE_LABEL[listItem.sourceType]}
          {listItem?.createdAt && <span>· {new Date(listItem.createdAt).toLocaleString()}</span>}
        </span>
      }
      footer={
        hasActions && job && (
          <>
            {job.status === 'done' && job.downloadUrl && (
              <Button
                variant="primary"
                icon={Download}
                loading={busy === 'download'}
                onClick={() => void act('download', () => pc.downloadJob(jobId, title), 'Downloading to your output folder')}
              >
                Download
              </Button>
            )}
            {localTask?.outputPath && (
              <>
                <Button icon={FolderOpen} onClick={() => pc.showInFolder(localTask.outputPath!)}>
                  Show file
                </Button>
                <Button icon={Rocket} onClick={() => void act('deploy', () => pc.deployOutput(localTask.outputPath!), 'Deploying')}>
                  Deploy
                </Button>
              </>
            )}
            {running && !trackingTask && (
              <Button variant="primary" icon={Download} loading={busy === 'track'} onClick={() => void act('track', () => pc.trackJob(jobId, title), 'Will download when it finishes')}>
                Download when done
              </Button>
            )}
            {listItem?.sourceType === 'url' && !running && (
              <Button
                icon={RefreshCw}
                loading={busy === 'rerun'}
                onClick={async () => {
                  setBusy('rerun');
                  const result = await pc.api<{ jobId: string }>({ method: 'POST', path: `/api/jobs/${jobId}/rerun` });
                  setBusy(null);
                  if (!result.ok) return toast.error('Could not re-run', result.error);
                  await pc.trackJob(result.data.jobId, title);
                  toast.success('Re-running with the latest pipeline');
                  onChanged();
                }}
              >
                Re-run
              </Button>
            )}
            {job.status === 'done' && job.downloadUrl && (
              <Button
                variant="ghost"
                icon={Trash2}
                className="ml-auto text-status-danger hover:text-status-danger"
                loading={busy === 'delete'}
                onClick={async () => {
                  if (!window.confirm('Delete the files for this job from the server now? The history entry stays.')) return;
                  if (await act('delete', () => pc.api({ method: 'DELETE', path: `/api/jobs/${jobId}` }), 'Server files deleted')) {
                    reload();
                    onChanged();
                  }
                }}
              >
                Delete files
              </Button>
            )}
          </>
        )
      }
    >
      {error && <ErrorNote message={error} onRetry={reload} />}
      {!job && !error && <Skeleton className="h-40" />}
      {job && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={jobTone(job.status)}>{JOB_STATUS_LABEL[job.status]}</Badge>
            {job.health.score != null && (
              <Badge tone={job.health.score >= 80 ? 'success' : job.health.score >= 50 ? 'warning' : 'danger'} icon={ShieldCheck}>
                Health {job.health.score}
              </Badge>
            )}
            {job.outputSizeBytes ? <Badge>{formatBytes(job.outputSizeBytes)}</Badge> : null}
            {job.expiresAt && job.status === 'done' && <Badge icon={Clock3}>Files kept until {new Date(job.expiresAt).toLocaleString()}</Badge>}
          </div>

          {running && (
            <Card className="bg-bg-base/60">
              <p className="text-sm font-medium text-white">
                {job.status === 'queued'
                  ? job.queuePosition > 0
                    ? `${job.queuePosition} ${job.queuePosition === 1 ? 'job' : 'jobs'} ahead of you`
                    : 'Up next'
                  : job.status === 'scraping'
                    ? 'Finding the mod source'
                    : job.progress.label ?? 'Processing'}
              </p>
              <ProgressBar className="mt-3" percent={job.progress.current != null && job.progress.total ? (job.progress.current / job.progress.total) * 100 : null} />
              {job.etaMs ? <p className="mt-2 text-xs text-zinc-500">About {formatDuration(job.etaMs)} left</p> : null}
              {trackingTask && <p className="mt-2 text-xs text-accent-teal">This app will download it automatically when it is done.</p>}
            </Card>
          )}

          {job.status === 'failed' && (
            <div className="flex gap-3 rounded-[5px] border border-status-danger-border bg-status-danger-bg p-4">
              <AlertTriangle className="h-4 w-4 shrink-0 text-status-danger" />
              <p className="selectable text-[13px] leading-relaxed text-status-danger">{job.error ?? 'The server could not finish this job.'}</p>
            </div>
          )}

          {job.realBrand && (
            <p className="rounded-[5px] border border-status-warning-border bg-status-warning-bg px-3 py-2.5 text-[13px] text-status-warning">
              This looks like a real-world brand ({job.realBrand}). Check that you have the rights to use it on your server.
            </p>
          )}

          {job.previewUrl &&
            (show3d ? (
              <Suspense fallback={<Skeleton className="aspect-[16/10]" />}>
                <ModelViewer source={{ kind: 'job', id: jobId }} />
              </Suspense>
            ) : (
              <button onClick={() => setShow3d(true)} className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-border py-8 text-sm text-zinc-400 transition-colors hover:border-accent-orange/50 hover:text-white">
                <Box className="h-4 w-4" /> Show 3D preview
              </button>
            ))}

          {job.batch && (
            <div>
              <SectionTitle title="Pack" description={`${job.batch.done} of ${job.batch.total} processed`} />
              {job.batch.failedItems.length > 0 && (
                <ul className="space-y-1.5">
                  {job.batch.failedItems.map((item) => (
                    <li key={item.title} className="rounded-[5px] border border-status-danger-border bg-status-danger-bg px-3 py-2 text-xs">
                      <span className="font-semibold text-white">{item.title}</span>
                      <span className="block text-status-danger">{item.error}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {fixLog.length > 0 && (
            <div>
              <SectionTitle title="What we fixed" description={`${fixLog.length} ${fixLog.length === 1 ? 'change' : 'changes'} applied automatically.`} />
              <ol className="selectable max-h-[300px] space-y-1 overflow-y-auto rounded-[5px] border border-border-subtle bg-bg-base/60 p-3 font-mono text-[11.5px] leading-relaxed text-zinc-400">
                {fixLog.map((line, index) => (
                  <li key={index} className="flex gap-2">
                    <Wrench className="mt-1 h-3 w-3 shrink-0 text-zinc-600" />
                    <span>{line}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {job.status === 'done' && (
            <div className="grid gap-3 sm:grid-cols-2">
              {listItem?.sourceType === 'url' && (
                <Button
                  icon={CheckCircle2}
                  loading={busy === 'verify'}
                  onClick={() => void act('verify', () => pc.api({ method: 'POST', path: `/api/jobs/${jobId}/verify` }), 'Thanks! That helps other people trust this mod.')}
                >
                  It works in game
                </Button>
              )}
              <Button icon={ImagePlus} loading={busy === 'shot'} onClick={async () => {
                setBusy('shot');
                const result = await pc.submitScreenshot(jobId);
                setBusy(null);
                if (!result.ok) toast.error('Could not submit the screenshot', result.error);
                else if (result.data.submitted) toast.success('Screenshot submitted', 'It shows in the gallery once a moderator approves it.', { label: 'Open gallery', onClick: () => navigate('gallery') });
              }}>
                Submit a screenshot
              </Button>
            </div>
          )}

          {job.licenseText && (
            <details className="rounded-[5px] border border-border-subtle bg-bg-base/60 p-3 text-xs text-zinc-400">
              <summary className="cursor-pointer font-semibold text-zinc-300">Original license</summary>
              <p className="selectable mt-2 whitespace-pre-line leading-relaxed">{job.licenseText}</p>
            </details>
          )}
        </div>
      )}
    </Drawer>
  );
}

export function Jobs({ tasks }: { tasks: Task[] }) {
  const { params } = useRouter();
  const [filter, setFilter] = useState<Filter>('all');
  const [openJob, setOpenJob] = useState<string | null>(params.job ?? null);
  const { data, error, loading, reload } = useApi<{ jobs: JobListItem[] }>('/api/jobs?limit=100', { poll: 8000 });
  useNow();

  useEffect(() => {
    if (params.job) setOpenJob(params.job);
  }, [params.job]);

  const jobs = data?.jobs ?? [];
  const counts = useMemo(
    () => ({
      all: jobs.length,
      active: jobs.filter((job) => job.status !== 'done' && job.status !== 'failed').length,
      done: jobs.filter((job) => job.status === 'done').length,
      failed: jobs.filter((job) => job.status === 'failed').length,
    }),
    [jobs],
  );
  const visible = jobs.filter((job) => filter === 'all' || (filter === 'active' ? job.status !== 'done' && job.status !== 'failed' : job.status === filter));
  const deviceTasks = tasks.filter((task) => isActive(task) || Date.now() - (task.finishedAt ?? 0) < 24 * 3600_000).slice(0, 12);

  return (
    <div className="mx-auto max-w-[1180px]">
      <PageHeader
        title="Jobs"
        description="Everything you've converted, from this app and the website."
        actions={
          <>
            <Button size="sm" variant="ghost" icon={FolderOpen} onClick={() => pc.openOutputFolder()}>
              Output folder
            </Button>
            <Button size="sm" icon={RefreshCw} onClick={reload}>
              Refresh
            </Button>
          </>
        }
      />

      <section className="mb-6">
        <SectionTitle
          title="On this device"
          description="You can close the app once a job reaches the server. It picks back up next time."
          action={
            tasks.some((task) => !isActive(task)) && (
              <Button size="sm" variant="ghost" onClick={() => pc.clearFinishedTasks()}>
                Clear finished
              </Button>
            )
          }
        />
        {deviceTasks.length === 0 ? (
          <p className="rounded-[5px] border border-dashed border-border-subtle py-6 text-center text-[13px] text-zinc-500">Nothing in the last 24 hours.</p>
        ) : (
          <div className="grid gap-1.5 lg:grid-cols-2">
            {deviceTasks.map((task) => (
              <TaskRow key={task.id} task={task} onOpen={task.jobId ? () => setOpenJob(task.jobId) : undefined} />
            ))}
          </div>
        )}
      </section>

      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-4 py-2.5">
          <h2 className="text-[13px] font-semibold text-zinc-100">All conversions</h2>
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'All', count: counts.all },
              { value: 'active', label: 'Running', count: counts.active },
              { value: 'done', label: 'Done', count: counts.done },
              { value: 'failed', label: 'Failed', count: counts.failed },
            ]}
          />
        </div>
        {error && (
          <div className="p-5">
            <ErrorNote message={error} onRetry={reload} />
          </div>
        )}
        {loading && !data ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-12" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <EmptyState icon={ListTodo} title={filter === 'all' ? 'No conversions yet' : 'Nothing here'} description="Start a conversion and it will appear here." />
        ) : (
          <table className="w-full table-fixed text-left text-[13px]">
            <colgroup>
              <col />
              <col className="w-[150px]" />
              <col className="w-[130px]" />
              <col className="w-[100px]" />
              <col className="w-[110px]" />
            </colgroup>
            <thead>
              <tr className="text-[12px] font-normal text-zinc-500">
                <th className="px-4 py-2 font-normal">Name</th>
                <th className="px-3 py-2 font-normal">Type</th>
                <th className="px-3 py-2 font-normal">Status</th>
                <th className="px-3 py-2 text-right font-normal">Size</th>
                <th className="px-4 py-2 text-right font-normal">Started</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((job) => {
                const Icon = SOURCE_ICON[job.sourceType];
                const expired = job.status === 'done' && !job.hasOutput;
                return (
                  <tr key={job.id} onClick={() => setOpenJob(job.id)} className="cursor-pointer border-t border-border-subtle transition-colors hover:bg-white/[0.02]">
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-3">
                        <Icon className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                        <span className="truncate text-zinc-100" title={job.title ?? undefined}>
                          {job.title ?? 'Untitled job'}
                        </span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-zinc-400">{SOURCE_LABEL[job.sourceType]}</td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <Badge tone={expired ? 'neutral' : jobTone(job.status)}>{expired ? 'Expired' : JOB_STATUS_LABEL[job.status]}</Badge>
                    </td>
                    <td className={cx('whitespace-nowrap px-3 py-2 text-right font-mono text-xs', job.outputSizeBytes ? 'text-zinc-300' : 'text-zinc-600')}>
                      {job.outputSizeBytes ? formatBytes(job.outputSizeBytes) : '-'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-right text-xs text-zinc-500">{timeAgo(job.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {openJob && (
        <JobDrawer jobId={openJob} listItem={jobs.find((job) => job.id === openJob) ?? null} tasks={tasks} onClose={() => setOpenJob(null)} onChanged={reload} />
      )}
    </div>
  );
}
