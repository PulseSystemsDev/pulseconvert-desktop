import { useState } from 'react';
import { Images, X } from 'lucide-react';
import { pc } from '../lib/bridge';
import { useApi } from '../lib/hooks';
import { useRouter } from '../lib/router';
import { Button, Card, EmptyState, ErrorNote, PageHeader, Skeleton } from '../components/ui';

interface Shot {
  id: string;
  title: string | null;
  imageUrl: string;
  submittedAt: string;
}

export function Gallery() {
  const { data, error, loading, reload } = useApi<{ screenshots: Shot[] }>('/api/gallery');
  const [open, setOpen] = useState<Shot | null>(null);
  const { navigate } = useRouter();
  const shots = data?.screenshots ?? [];

  return (
    <div className="mx-auto max-w-[1320px]">
      <PageHeader
        title="Community gallery"
        description="Cars converted with Pulse Convert, running in FiveM - submitted by the people who converted them."
        actions={
          <Button size="sm" onClick={() => navigate('jobs')}>
            Submit yours from a job
          </Button>
        }
      />
      {error && <ErrorNote message={error} onRetry={reload} />}
      {loading && !data ? (
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="aspect-video" />
          ))}
        </div>
      ) : shots.length === 0 ? (
        <Card>
          <EmptyState icon={Images} title="No screenshots yet" description="Be the first - open a finished job and submit a screenshot of it in game." />
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
          {shots.map((shot) => (
            <button key={shot.id} onClick={() => setOpen(shot)} className="card group overflow-hidden text-left">
              <img src={pc.resolveUrl(shot.imageUrl) ?? undefined} alt={shot.title ?? 'Converted car'} loading="lazy" className="aspect-video w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
              {shot.title && <p className="truncate p-3 text-[13px] text-zinc-300">{shot.title}</p>}
            </button>
          ))}
        </div>
      )}
      {open && (
        <div className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-black/85 p-10" onClick={() => setOpen(null)}>
          <img src={pc.resolveUrl(open.imageUrl) ?? undefined} alt={open.title ?? ''} className="max-h-full max-w-full rounded-[5px] shadow-panel" />
          <button className="absolute right-6 top-16 text-zinc-300 hover:text-white" aria-label="Close">
            <X className="h-6 w-6" />
          </button>
        </div>
      )}
    </div>
  );
}
