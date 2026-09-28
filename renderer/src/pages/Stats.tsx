import { useEffect, useState } from 'react';
import { Activity, Boxes, CheckCircle2, Clock3, Database, HardDriveDownload, Server, Wrench } from 'lucide-react';
import { CHART_COLORS, DailyBars, Legend, RankedBars, Sparkline, type DayPoint, type SamplePoint } from '../components/charts';
import { SOURCE_LABEL } from '../components/taskMeta';
import { formatBytes, formatDuration, formatNumber } from '../lib/format';
import { useApi } from '../lib/hooks';
import { useAccount } from '../lib/account';
import { Badge, Card, ErrorNote, PageHeader, SectionTitle, Skeleton, StatTile } from '../components/ui';

interface LiveStats {
  totalConverted: number;
  totalFixesApplied: number;
  totalBytesSaved: number;
  catalogVehiclesIndexed: number;
  activeNow: number;
  avgConversionMs: number;
  workerOnline: boolean;
}

interface History {
  days: DayPoint[];
  byType: Record<string, number>;
}

function HistoryCharts({ samples }: { samples: SamplePoint[] }) {
  const { data } = useApi<History>('/api/stats/history', { poll: 60_000 });
  const days = data?.days ?? [];
  const finished = days.reduce((sum, day) => sum + day.done, 0);
  const failed = days.reduce((sum, day) => sum + day.failed, 0);
  const types = Object.entries(data?.byType ?? {})
    .map(([key, value]) => ({ label: SOURCE_LABEL[key as keyof typeof SOURCE_LABEL] ?? key, value }))
    .sort((a, b) => b.value - a.value);

  return (
    <div className="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card>
        <SectionTitle
          title="Jobs per day"
          description={data ? `${finished.toLocaleString()} finished and ${failed.toLocaleString()} failed in the last 30 days (UTC).` : 'Last 30 days'}
          action={<Legend items={[{ label: 'Finished', color: CHART_COLORS.done }, { label: 'Failed', color: CHART_COLORS.failed }]} />}
        />
        {data ? <DailyBars days={days} /> : <Skeleton className="h-[220px]" />}
        {data && (
          <details className="mt-3 text-xs text-slate-500">
            <summary className="cursor-pointer hover:text-slate-300">View as table</summary>
            <table className="mt-2 w-full font-mono">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="py-1 font-medium">Day</th>
                  <th className="py-1 text-right font-medium">Finished</th>
                  <th className="py-1 text-right font-medium">Failed</th>
                </tr>
              </thead>
              <tbody>
                {[...days].reverse().map((day) => (
                  <tr key={day.day} className="border-t border-border-subtle text-slate-300">
                    <td className="py-1">{day.day}</td>
                    <td className="py-1 text-right">{day.done}</td>
                    <td className="py-1 text-right">{day.failed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}
      </Card>
      <div className="grid gap-4">
        <Card>
          <SectionTitle title="Queue right now" description="Jobs active or queued, sampled every 5 seconds while this page is open." />
          {samples.length < 2 ? <p className="py-8 text-center text-xs text-slate-500">Collecting samples...</p> : <Sparkline points={samples} unit={(value) => `${value} ${value === 1 ? 'job' : 'jobs'}`} />}
        </Card>
        <Card>
          <SectionTitle title="Finished by type" description="Last 30 days." />
          {types.length ? <RankedBars rows={types} /> : <p className="text-xs text-slate-500">{data ? 'Nothing finished yet.' : 'Loading...'}</p>}
        </Card>
      </div>
    </div>
  );
}

export function Stats() {
  const { data, error, reload } = useApi<LiveStats>('/api/stats/live', { poll: 5000 });
  const { data: account } = useAccount();
  const [samples, setSamples] = useState<SamplePoint[]>([]);
  useEffect(() => {
    if (data) setSamples((current) => [...current, { at: Date.now(), value: data.activeNow }].slice(-120));
  }, [data]);

  return (
    <div className="mx-auto max-w-[1180px]">
      <PageHeader
        title="Live stats"
        description="Everything Pulse Convert has done, updating every few seconds. Site-wide numbers are aggregate only."
        actions={
          data && (
            <Badge tone={data.workerOnline ? 'success' : 'warning'} icon={data.workerOnline ? CheckCircle2 : Server}>
              {data.workerOnline ? 'Converter online' : 'Converter restarting'}
            </Badge>
          )
        }
      />
      {error && <ErrorNote message={error} onRetry={reload} />}
      {!data ? (
        <div className="grid gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-28" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatTile label="Mods converted" value={formatNumber(data.totalConverted)} icon={Boxes} accent />
            <StatTile label="Catalog vehicles" value={formatNumber(data.catalogVehiclesIndexed)} icon={Database} />
            <StatTile label="Fixes applied" value={formatNumber(data.totalFixesApplied)} icon={Wrench} />
            <StatTile label="Space saved" value={formatBytes(data.totalBytesSaved)} icon={HardDriveDownload} />
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <StatTile label="Active or queued right now" value={formatNumber(data.activeNow)} icon={Activity} sub={data.activeNow === 1 ? 'conversion' : 'conversions'} />
            <StatTile label="Typical conversion time" value={formatDuration(data.avgConversionMs)} icon={Clock3} sub="Rolling average of recent jobs" />
          </div>
          <HistoryCharts samples={samples} />
        </>
      )}

      {account && (
        <Card className="mt-6">
          <SectionTitle title="Your lifetime numbers" description="Only you can see these." />
          <div className="grid gap-4 md:grid-cols-5">
            {[
              ['Jobs', formatNumber(account.stats.totalJobs)],
              ['Finished', formatNumber(account.stats.doneJobs)],
              ['Failed', formatNumber(account.stats.failedJobs)],
              ['Uploaded', formatBytes(account.stats.totalInputBytes)],
              ['Delivered', formatBytes(account.stats.totalOutputBytes)],
            ].map(([label, value]) => (
              <div key={label}>
                <p className="eyebrow">{label}</p>
                <p className="mt-1 font-mono text-xl font-bold text-white">{value}</p>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
