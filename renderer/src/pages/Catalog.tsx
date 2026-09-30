import { lazy, Suspense, useEffect, useState } from 'react';
import {
  ArrowUpDown,
  Box,
  CarFront,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Download,
  ExternalLink,
  Heart,
  ImageOff,
  Map as MapIcon,
  PersonStanding,
  RefreshCw,
  Search,
  Shirt,
  Star,
  ThumbsUp,
  Zap,
} from 'lucide-react';
import { pc } from '../lib/bridge';
import { compactNumber, cx } from '../lib/format';
import { useApi, useDebounced } from '../lib/hooks';
import { useRouter } from '../lib/router';
import { useToast } from '../lib/toast';
import { Badge, Button, Drawer, EmptyState, ErrorNote, IconButton, PageHeader, Segmented, Select, Skeleton, Spinner, StatTile } from '../components/ui';

const ModelViewer = lazy(() => import('../components/ModelViewer'));

type Kind = 'vehicles' | 'animations' | 'map' | 'ped' | 'eup';

interface Entry {
  id: string;
  title: string;
  author: string | null;
  sourceUrl: string;
  thumbnailUrl: string | null;
  description?: string | null;
  tags?: string | null;
  likes?: number;
  downloads?: number;
  rating?: number;
  favorited?: boolean;
  prebuilt?: boolean;
  hasPreview?: boolean;
}

interface ListResponse {
  entries: Entry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const KINDS: Array<{ value: Kind; label: string; icon: typeof CarFront }> = [
  { value: 'vehicles', label: 'Vehicles', icon: CarFront },
  { value: 'animations', label: 'Weapon animations', icon: Crosshair },
  { value: 'map', label: 'Maps', icon: MapIcon },
  { value: 'ped', label: 'Peds', icon: PersonStanding },
  { value: 'eup', label: 'EUP & clothing', icon: Shirt },
];

function listPath(kind: Kind, search: string, sort: string, page: number): string {
  const params = new URLSearchParams({ search, sort, page: String(page), pageSize: '24' });
  if (kind === 'vehicles') return `/api/catalog/vehicles/list?${params}`;
  if (kind === 'animations') return `/api/catalog/animations/list?${params}`;
  params.set('kind', kind);
  return `/api/catalog-content/list?${params}`;
}

function favoritePath(kind: Kind, id: string): string {
  if (kind === 'vehicles') return `/api/vehicles/${id}/favorite`;
  if (kind === 'animations') return `/api/animations/${id}/favorite`;
  return `/api/catalog-content/${id}/favorite`;
}

function parseTags(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === 'string').slice(0, 12) : [];
  } catch {
    return [];
  }
}

function Thumb({ src, className }: { src: string | null; className?: string }) {
  const [failed, setFailed] = useState(false);
  const url = pc.resolveUrl(src);
  if (!url || failed) {
    return (
      <div className={cx('flex items-center justify-center bg-bg-elevated', className)}>
        <ImageOff className="h-6 w-6 text-zinc-600" />
      </div>
    );
  }
  return <img src={url} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} className={cx('object-cover', className)} />;
}

function useEntryActions(kind: Kind) {
  const toast = useToast();
  const { navigate } = useRouter();
  const [working, setWorking] = useState<string | null>(null);

  const instant = async (entry: Entry) => {
    setWorking(entry.id);
    const result = await pc.downloadCatalogItem({ kind: kind === 'vehicles' ? 'vehicle' : 'animation', id: entry.id, title: entry.title });
    setWorking(null);
    if (result.ok) toast.success('Downloading', `${entry.title} is on its way to your output folder.`, { label: 'Open Jobs', onClick: () => navigate('jobs') });
    else toast.error('Could not download', result.error);
  };

  const convert = async (entry: Entry) => {
    setWorking(entry.id);
    const result = await pc.startConvert({ urls: [entry.sourceUrl], inputs: [], profile: 'preserve', target: 'addon', packBundleMode: 'separate' });
    setWorking(null);
    if (result.ok) toast.success('Conversion started', entry.title, { label: 'Open Jobs', onClick: () => navigate('jobs') });
    else toast.error('Could not start', result.error);
  };

  return { working, instant, convert };
}

function EntryCard({ entry, kind, onOpen, onFavorite }: { entry: Entry; kind: Kind; onOpen: () => void; onFavorite: () => void }) {
  return (
    <article className="card group flex cursor-pointer flex-col overflow-hidden transition-[border-color,transform] hover:-translate-y-0.5 hover:border-border" onClick={onOpen}>
      <div className="relative aspect-video overflow-hidden">
        <Thumb src={entry.thumbnailUrl} className="h-full w-full transition-transform duration-300 group-hover:scale-[1.03]" />
        <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-bg-surface to-transparent" />
        {entry.prebuilt && (
          <span className="absolute left-2.5 top-2.5">
            <Badge tone="teal" icon={Zap} className="bg-bg-base/80 backdrop-blur">
              Instant
            </Badge>
          </span>
        )}
        {kind === 'vehicles' && entry.hasPreview && (
          <span className="absolute right-11 top-2.5">
            <Badge icon={Box} className="bg-bg-base/80 backdrop-blur">
              3D
            </Badge>
          </span>
        )}
        <button
          onClick={(event) => {
            event.stopPropagation();
            onFavorite();
          }}
          aria-label={entry.favorited ? 'Remove from favorites' : 'Add to favorites'}
          className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-[5px] bg-bg-base/70 backdrop-blur transition-colors hover:bg-bg-base"
        >
          <Heart className={cx('h-3.5 w-3.5', entry.favorited ? 'fill-accent-orange text-accent-orange' : 'text-zinc-300')} />
        </button>
      </div>
      <div className="flex flex-1 flex-col p-3.5 pt-2">
        <p className="line-clamp-2 text-[13px] font-semibold leading-snug text-white" title={entry.title}>
          {entry.title}
        </p>
        <p className="mt-1 truncate text-xs text-zinc-500">{entry.author ? `by ${entry.author}` : 'Unknown author'}</p>
        <div className="mt-auto flex items-center gap-3 pt-3 font-mono text-[11px] text-zinc-500">
          {entry.downloads !== undefined && (
            <span className="flex items-center gap-1">
              <Download className="h-3 w-3" /> {compactNumber(entry.downloads)}
            </span>
          )}
          {entry.likes !== undefined && (
            <span className="flex items-center gap-1">
              <ThumbsUp className="h-3 w-3" /> {compactNumber(entry.likes)}
            </span>
          )}
          {entry.rating ? (
            <span className="flex items-center gap-1">
              <Star className="h-3 w-3" /> {entry.rating.toFixed(1)}
            </span>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function EntryDrawer({ entry, kind, onClose, onFavorite }: { entry: Entry | null; kind: Kind; onClose: () => void; onFavorite: (entry: Entry) => void }) {
  const { working, instant, convert } = useEntryActions(kind);
  const [show3d, setShow3d] = useState(false);
  useEffect(() => setShow3d(false), [entry?.id]);
  if (!entry) return null;
  const tags = parseTags(entry.tags);
  const canInstant = (kind === 'vehicles' || kind === 'animations') && entry.prebuilt;

  return (
    <Drawer
      open
      onClose={onClose}
      title={entry.title}
      subtitle={entry.author ? `by ${entry.author}` : undefined}
      width={620}
      footer={
        <>
          {canInstant ? (
            <Button variant="primary" icon={Zap} loading={working === entry.id} onClick={() => void instant(entry)}>
              Instant download
            </Button>
          ) : (
            <Button variant="primary" icon={RefreshCw} loading={working === entry.id} onClick={() => void convert(entry)}>
              Convert this
            </Button>
          )}
          {canInstant && (
            <Button variant="ghost" icon={RefreshCw} onClick={() => void convert(entry)}>
              Fresh conversion
            </Button>
          )}
          <div className="ml-auto flex items-center gap-1">
            <IconButton icon={Heart} label={entry.favorited ? 'Remove from favorites' : 'Add to favorites'} active={entry.favorited} onClick={() => onFavorite(entry)} className={entry.favorited ? '[&>svg]:fill-accent-orange' : undefined} />
            <IconButton icon={ExternalLink} label="Open the source page" onClick={() => pc.openExternal(entry.sourceUrl)} />
          </div>
        </>
      }
    >
      {show3d ? (
        <Suspense fallback={<Skeleton className="aspect-[16/10]" />}>
          <ModelViewer source={{ kind: 'vehicle', id: entry.id }} />
        </Suspense>
      ) : (
        <div className="relative overflow-hidden rounded-md border border-border-subtle">
          <Thumb src={entry.thumbnailUrl} className="aspect-video w-full" />
          {kind === 'vehicles' && entry.hasPreview && (
            <Button size="sm" icon={Box} className="absolute bottom-3 right-3" onClick={() => setShow3d(true)}>
              View in 3D
            </Button>
          )}
        </div>
      )}

      <div className="mt-4 grid grid-cols-3">
        <StatTile label="Downloads" value={compactNumber(entry.downloads)} />
        <StatTile label="Likes" value={compactNumber(entry.likes)} />
        <StatTile label="Rating" value={entry.rating ? entry.rating.toFixed(1) : '-'} />
      </div>

      {canInstant ? (
        <p className="mt-4 text-[12px] text-zinc-400">A prebuilt copy is ready, so Instant download skips the queue.</p>
      ) : (
        (kind === 'vehicles' || kind === 'animations') && <p className="mt-4 text-[12px] text-zinc-400">No prebuilt copy yet, so this goes through a normal conversion.</p>
      )}

      {tags.length > 0 && (
        <div className="mt-5 flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <Badge key={tag}>{tag}</Badge>
          ))}
        </div>
      )}

      {entry.description && (
        <div className="mt-5">
          <p className="eyebrow mb-2">About</p>
          <p className="selectable max-h-[340px] overflow-y-auto whitespace-pre-line text-[13px] leading-relaxed text-zinc-400">{entry.description}</p>
        </div>
      )}
    </Drawer>
  );
}

export function Catalog() {
  const { params } = useRouter();
  const [kind, setKind] = useState<Kind>('vehicles');
  const [search, setSearch] = useState(params.q ?? '');
  const [sort, setSort] = useState('latest');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Entry | null>(null);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const debounced = useDebounced(search.trim(), 300);
  const toast = useToast();

  useEffect(() => {
    if (params.q !== undefined) setSearch(params.q);
  }, [params.q]);
  useEffect(() => setPage(1), [kind, debounced, sort]);

  const { data, error, loading, reload } = useApi<ListResponse>(listPath(kind, debounced, sort, page));
  const entries = (data?.entries ?? []).map((entry) => (entry.id in overrides ? { ...entry, favorited: overrides[entry.id] } : entry));

  const toggleFavorite = async (entry: Entry) => {
    const next = !entry.favorited;
    setOverrides((current) => ({ ...current, [entry.id]: next }));
    if (selected?.id === entry.id) setSelected({ ...entry, favorited: next });
    const result = await pc.api<{ favorited: boolean }>({ method: 'POST', path: favoritePath(kind, entry.id) });
    if (result.ok) {
      setOverrides((current) => ({ ...current, [entry.id]: result.data.favorited }));
    } else {
      setOverrides((current) => ({ ...current, [entry.id]: !next }));
      toast.error('Could not update favorites', result.error);
    }
  };

  return (
    <div className="mx-auto max-w-[1320px]">
      <PageHeader title="Catalog" description="Everything Pulse Convert has indexed. Prebuilt entries download instantly; everything else converts on demand." />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Segmented value={kind} onChange={(value) => setKind(value)} options={KINDS} />
        <div className="ml-auto flex w-full max-w-[500px] items-center gap-3">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by name, author or tag" className="field h-9 py-0 pl-9" />
          </div>
          <Select
          value={sort}
          onChange={setSort}
          label="Sort"
          icon={ArrowUpDown}
          className="w-[180px] shrink-0"
          options={[
            { value: 'latest', label: 'Newest' },
            { value: 'downloads', label: 'Most downloaded' },
            { value: 'likes', label: 'Most liked' },
            { value: 'rating', label: 'Highest rated' },
          ]}
          />
        </div>
      </div>

      {error && <ErrorNote message={error} onRetry={reload} />}

      {loading && !data ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="aspect-[4/4]" />
          ))}
        </div>
      ) : entries.length === 0 && !error ? (
        <div className="card">
          <EmptyState icon={Search} title="Nothing matches" description={debounced ? `No ${KINDS.find((item) => item.value === kind)?.label.toLowerCase()} match "${debounced}".` : 'This catalog is empty right now.'} />
        </div>
      ) : (
        <>
          <div className="mb-3 flex items-center justify-between text-xs text-zinc-500">
            <span>
              {data?.total.toLocaleString()} results {loading && <Spinner className="ml-1 inline h-3 w-3" />}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 2xl:grid-cols-4">
            {entries.map((entry) => (
              <EntryCard key={entry.id} entry={entry} kind={kind} onOpen={() => setSelected(entry)} onFavorite={() => void toggleFavorite(entry)} />
            ))}
          </div>
          {data && data.totalPages > 1 && (
            <div className="mt-6 flex items-center justify-center gap-3">
              <Button size="sm" icon={ChevronLeft} disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
                Previous
              </Button>
              <span className="font-mono text-xs text-zinc-400">
                {data.page} / {data.totalPages}
              </span>
              <Button size="sm" disabled={page >= data.totalPages} onClick={() => setPage((value) => value + 1)}>
                Next <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </>
      )}

      <EntryDrawer entry={selected} kind={kind} onClose={() => setSelected(null)} onFavorite={(entry) => void toggleFavorite(entry)} />
    </div>
  );
}
