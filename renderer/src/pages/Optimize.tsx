import { useState } from 'react';
import { Archive, FileImage, FolderOpen, X } from 'lucide-react';
import { pc, type OptimizeCategory, type SelectedInput } from '../lib/bridge';
import { OPTIMIZE_CATEGORIES, OPTIMIZE_ORDER } from '../lib/content';
import { formatBytes } from '../lib/format';
import { useRouter } from '../lib/router';
import { useToast } from '../lib/toast';
import { Button, Card, PageHeader, Segmented, SectionTitle } from '../components/ui';
import { Dropzone } from '../components/Dropzone';

export function SelectedFile({ input, onClear }: { input: SelectedInput; onClear: () => void }) {
  const Icon = input.inputKind === 'folder' ? FolderOpen : input.inputKind === 'file' ? FileImage : Archive;
  return (
    <div className="flex items-center gap-3 rounded-[5px] border border-border bg-bg-base px-3 py-2.5">
      <Icon className="h-4 w-4 shrink-0 text-zinc-400" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-zinc-100">{input.name}</p>
        <p className="truncate font-mono text-[11px] text-zinc-500" title={input.inputPath}>
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
      <PageHeader
        title="Optimize"
        description="Makes a lighter copy of a resource so it streams smoothly. Your original is never changed."
        actions={<Segmented value={category} onChange={setCategory} options={OPTIMIZE_ORDER.map((key) => ({ value: key, label: OPTIMIZE_CATEGORIES[key].label, icon: OPTIMIZE_CATEGORIES[key].icon }))} />}
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
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
            <p className="text-[13px] font-semibold text-zinc-100">What it does</p>
            <p className="mt-1 text-[12px] leading-relaxed text-zinc-400">{info.intro}</p>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-[12px] text-zinc-400 marker:text-zinc-600">
              {info.points.map((point) => (
                <li key={point}>{point}</li>
              ))}
              <li>Nested archives inside the resource are kept as they are.</li>
            </ul>
            <Button variant="primary" size="lg" className="mt-4 w-full" disabled={!input || ytdMismatch} loading={busy} onClick={() => void start()}>
              {input ? `Optimize ${info.label.toLowerCase()}` : 'Choose a resource first'}
            </Button>
          </Card>
        </aside>
      </div>
    </div>
  );
}
