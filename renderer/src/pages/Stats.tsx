import { Activity, Boxes, CheckCircle2, Clock3, Database, HardDriveDownload, Server, Wrench } from 'lucide-react';
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

export function Stats() {
  const { data, error, reload } = useApi<LiveStats>('/api/stats/live', { poll: 5000 });
  const { data: account } = useAccount();

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
