import { Cog, Hourglass, ListOrdered, Search, User } from 'lucide-react';
import type { JobListItem } from '../lib/bridge';
import { cx } from '../lib/format';
import { useApi } from '../lib/hooks';
import { Badge, Card, EmptyState, ErrorNote, PageHeader, SectionTitle, Skeleton } from '../components/ui';
import { SOURCE_LABEL } from '../components/taskMeta';

interface Entry {
  jobId: string;
  sourceType: JobListItem['sourceType'];
  status: 'scraping' | 'queued' | 'processing';
  isMine: boolean;
  title: string | null;
  queuePosition?: number;
  scrapeQueuePosition?: number;
}

interface Overview {
  processingMany: Entry[];
  scraping: Entry[];
  queued: Entry[];
}

function Row({ entry, index, icon: Icon }: { entry: Entry; index: number; icon: typeof Cog }) {
  return (
    <li className={cx('flex items-center gap-3 rounded-lg border px-3 py-2.5', entry.isMine ? 'border-accent-orange/40 bg-accent-orange/[0.06]' : 'border-border-subtle bg-bg-base/60')}>
      <span className="w-6 text-right font-mono text-xs text-slate-500">{index + 1}</span>
      <Icon className={cx('h-4 w-4', entry.status === 'processing' ? 'animate-spin text-accent-orange [animation-duration:3s]' : 'text-slate-500')} />
      <span className="min-w-0 flex-1 truncate text-[13px] text-slate-200">{entry.title ?? SOURCE_LABEL[entry.sourceType]}</span>
      {entry.isMine && (
        <Badge tone="orange" icon={User}>
          Yours
        </Badge>
      )}
    </li>
  );
}

function Column({ title, description, entries, icon, empty }: { title: string; description: string; entries: Entry[]; icon: typeof Cog; empty: string }) {
  return (
    <Card>
      <SectionTitle title={title} description={description} action={<Badge>{entries.length}</Badge>} />
      {entries.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-slate-500">{empty}</p>
      ) : (
        <ol className="space-y-1.5">
          {entries.map((entry, index) => (
            <Row key={entry.jobId} entry={entry} index={index} icon={icon} />
          ))}
        </ol>
      )}
    </Card>
  );
}

export function Queue() {
  const { data, error, loading, reload } = useApi<Overview>('/api/queue', { poll: 4000 });
  const mine = data ? [...data.processingMany, ...data.scraping, ...data.queued].filter((entry) => entry.isMine) : [];

  return (
    <div className="mx-auto max-w-[1180px]">
      <PageHeader
        title="Server queue"
        description="What the converter is working on right now. Everyone gets a fair turn - one person's big pack can't hold up everyone else. Other people's jobs stay anonymous."
      />
      {error && <ErrorNote message={error} onRetry={reload} />}
      {loading && !data ? (
        <div className="grid gap-5 lg:grid-cols-3">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      ) : data ? (
        <>
          {mine.length > 0 && (
            <p className="mb-5 rounded-lg border border-accent-orange/30 bg-accent-orange/[0.06] px-4 py-3 text-[13px] text-slate-200">
              You have <span className="font-semibold text-white">{mine.length}</span> {mine.length === 1 ? 'job' : 'jobs'} in the pipeline.
            </p>
          )}
          {data.processingMany.length + data.scraping.length + data.queued.length === 0 ? (
            <Card>
              <EmptyState icon={ListOrdered} title="The queue is empty" description="Anything you submit now starts right away." />
            </Card>
          ) : (
            <div className="grid gap-5 lg:grid-cols-3">
              <Column title="Converting" description="Running on the converter now." entries={data.processingMany} icon={Cog} empty="Nothing converting." />
              <Column title="Finding sources" description="Links being resolved to real downloads." entries={data.scraping} icon={Search} empty="No links waiting." />
              <Column title="Waiting" description="In line, in the order they will run." entries={data.queued} icon={Hourglass} empty="Nobody waiting." />
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
