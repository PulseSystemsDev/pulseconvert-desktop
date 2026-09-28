import { useState } from 'react';
import { Archive, Check, FileImage, FolderOpen, Gauge, ShieldCheck, X } from 'lucide-react';
import { pc, type OptimizeCategory, type SelectedInput } from '../lib/bridge';
import { OPTIMIZE_CATEGORIES, OPTIMIZE_ORDER } from '../lib/content';
import { cx, formatBytes } from '../lib/format';
import { useRouter } from '../lib/router';
import { useToast } from '../lib/toast';
import { Button, Card, PageHeader, SectionTitle } from '../components/ui';
import { Dropzone } from '../components/Dropzone';

export function SelectedFile({ input, onClear }: { input: SelectedInput; onClear: () => void }) {
  const Icon = input.inputKind === 'folder' ? FolderOpen : input.inputKind === 'file' ? FileImage : Archive;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-accent-orange/30 bg-accent-orange/[0.04] p-4">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-orange-dim">
        <Icon className="h-5 w-5 text-accent-orange" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-white">{input.name}</p>
        <p className="truncate font-mono text-[11px] text-slate-500" title={input.inputPath}>
          {input.inputKind === 'folder' ? 'Folder' : formatBytes(input.sizeBytes)} · {input.inputPath}
        </p>
      </div>
      <Button size="sm" variant="ghost" icon={X} onClick={onClear}>
        Remove
      </Button>
    </div>
  );
}

export function Optimize() {
  const toast = useToast();
  const { navigate } = useRouter();
  const [category, setCategory] = useState<OptimizeCategory>('vehicles');
  const [input, setInput] = useState<SelectedInput | null>(null);
  const [busy, setBusy] = useState(false);
  const info = OPTIMIZE_CATEGORIES[category];
  const ytdMismatch = input?.inputKind === 'file' && category !== 'textures';

  const start = async () => {
    if (!input) return;
    setBusy(true);
    const result = await pc.startOptimize({ inputPath: input.inputPath, category });
    setBusy(false);
    if (!result.ok) return toast.error('Could not start', result.error);
    setInput(null);
    toast.success('Optimization started', 'Your original files are never touched - a new copy is written.', { label: 'Open Jobs', onClick: () => navigate('jobs') });
  };

  return (
    <div className="mx-auto max-w-[1180px]">
      <PageHeader title="Optimize" description="Make heavy resources lighter so they stream smoothly. The original is never overwritten; you get a new optimized copy." />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {OPTIMIZE_ORDER.map((key) => {
          const { icon: Icon, label } = OPTIMIZE_CATEGORIES[key];
          const active = key === category;
          return (
            <button
              key={key}
              onClick={() => setCategory(key)}
              className={cx('card relative flex flex-col items-start p-4 text-left transition-colors', active ? 'border-accent-orange/50 bg-accent-orange/[0.05]' : 'hover:border-border hover:bg-bg-elevated')}
            >
              {active && (
                <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-accent-orange">
                  <Check className="h-3 w-3 text-bg-base" />
                </span>
              )}
              <Icon className={cx('h-5 w-5', active ? 'text-accent-orange' : 'text-slate-500')} />
              <p className="mt-3 text-sm font-semibold text-white">{label}</p>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <SectionTitle title="Resource" description={category === 'textures' ? 'A resource archive, a resource folder, or a single .ytd file.' : 'A resource archive or a resource folder.'} />
          {input ? (
            <SelectedFile input={input} onClear={() => setInput(null)} />
          ) : (
            <Dropzone
              modes={['archives', 'folder']}
              onSelect={([picked]) => setInput(picked)}
              title="Drop a resource to optimize"
              hint=".zip, .rar, .7z, .oiv, .rpf, a resource folder, or a standalone .ytd for textures."
            />
          )}
          {ytdMismatch && <p className="mt-3 text-xs text-status-warning">A standalone .ytd can only be optimized as Textures.</p>}
        </Card>

        <aside className="space-y-5">
          <Card>
            <div className="flex items-center gap-2">
              <info.icon className="h-4 w-4 text-accent-orange" />
              <p className="text-sm font-semibold text-white">{info.label}</p>
            </div>
            <p className="mt-2 text-[13px] leading-relaxed text-slate-400">{info.intro}</p>
            <ul className="mt-4 space-y-2">
              {info.points.map((point) => (
                <li key={point} className="flex gap-2 text-[13px] text-slate-300">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-teal" />
                  {point}
                </li>
              ))}
            </ul>
            <p className="mt-4 flex gap-2 rounded-lg border border-border-subtle bg-bg-base/60 p-3 text-xs leading-relaxed text-slate-500">
              <ShieldCheck className="h-4 w-4 shrink-0 text-status-success" />
              Nested ZIP, RAR, 7z, OIV and RPF containers inside the resource are kept byte-for-byte.
            </p>
            <Button variant="primary" size="lg" icon={Gauge} className="mt-5 w-full" disabled={!input || ytdMismatch} loading={busy} onClick={() => void start()}>
              {input ? `Optimize ${info.label.toLowerCase()}` : 'Choose a resource first'}
            </Button>
          </Card>
        </aside>
      </div>
    </div>
  );
}
