import { useMemo, useState } from 'react';
import { Archive, FileText, FolderOpen, Layers, Link2, Plus, RefreshCw, Rocket, X } from 'lucide-react';
import { pc, type SelectedInput } from '../lib/bridge';
import { CONVERT_CATEGORIES, CONVERT_CATEGORY_ORDER, type ConvertCategory } from '../lib/content';
import { cx, formatBytes, isSupportedSourceUrl } from '../lib/format';
import { useSettings } from '../lib/hooks';
import { takePendingInputs } from '../lib/pendingInputs';
import { useRouter } from '../lib/router';
import { useToast } from '../lib/toast';
import { Badge, Button, Card, PageHeader, Segmented, SectionTitle } from '../components/ui';
import { Dropzone } from '../components/Dropzone';

type Item = { key: string; kind: 'url'; url: string } | { key: string; kind: 'input'; input: SelectedInput };

const MAX_ITEMS = 50;
let keySeed = 0;
const nextKey = () => `item-${keySeed++}`;

export function Convert() {
  const { params, navigate } = useRouter();
  const toast = useToast();
  const [settings] = useSettings();
  const [category, setCategory] = useState<ConvertCategory>((params.category as ConvertCategory) || 'vehicle');
  const [items, setItems] = useState<Item[]>(() => {
    const initial: Item[] = takePendingInputs().map((input) => ({ key: nextKey(), kind: 'input', input }));
    if (params.url) initial.push({ key: nextKey(), kind: 'url', url: params.url });
    return initial;
  });
  const [draft, setDraft] = useState('');
  const [packMode, setPackMode] = useState<'separate' | 'single'>('separate');
  const [busy, setBusy] = useState(false);

  const info = CONVERT_CATEGORIES[category];
  const trimmedDraft = draft.trim();
  const draftInvalid = trimmedDraft.length > 0 && !isSupportedSourceUrl(trimmedDraft);
  const isPack = items.length > 1;

  const addUrls = (urls: string[]) => {
    const valid = urls.map((url) => url.trim()).filter((url) => url && isSupportedSourceUrl(url));
    const skipped = urls.filter((url) => url.trim()).length - valid.length;
    setItems((current) => {
      const existing = new Set(current.filter((item) => item.kind === 'url').map((item) => (item as { url: string }).url));
      const fresh = valid.filter((url) => !existing.has(url)).slice(0, MAX_ITEMS - current.length);
      return [...current, ...fresh.map((url) => ({ key: nextKey(), kind: 'url' as const, url }))];
    });
    if (skipped > 0) toast.info(`Skipped ${skipped} unsupported ${skipped === 1 ? 'link' : 'links'}`, 'Only gta5-mods.com, MediaFire and ShareMods are supported.');
  };

  const addInputs = async (inputs: SelectedInput[]) => {
    const textFiles = inputs.filter((input) => input.inputKind === 'file' && input.name.toLowerCase().endsWith('.txt'));
    for (const file of textFiles) {
      const text = await pc.readTextFile(file.inputPath);
      if (text) addUrls(text.split(/\r?\n/).filter((line) => !line.trim().startsWith('#')));
    }
    const usable = inputs.filter((input) => input.inputKind === 'archive' || input.inputKind === 'folder');
    if (inputs.length > textFiles.length + usable.length) toast.info('Some files were skipped', 'Conversions take .zip, .rar, .7z, .oiv, .rpf archives or folders.');
    setItems((current) => {
      const existing = new Set(current.filter((item) => item.kind === 'input').map((item) => (item as { input: SelectedInput }).input.inputPath));
      const fresh = usable.filter((input) => !existing.has(input.inputPath)).slice(0, MAX_ITEMS - current.length);
      return [...current, ...fresh.map((input) => ({ key: nextKey(), kind: 'input' as const, input }))];
    });
  };

  const addDraft = () => {
    if (!trimmedDraft || draftInvalid) return;
    const lines = trimmedDraft.split(/\s+/);
    addUrls(lines);
    setDraft('');
  };

  const totalBytes = useMemo(() => items.reduce((sum, item) => sum + (item.kind === 'input' ? item.input.sizeBytes ?? 0 : 0), 0), [items]);

  const start = async () => {
    const pendingUrls = trimmedDraft && !draftInvalid ? trimmedDraft.split(/\s+/).filter(isSupportedSourceUrl) : [];
    const urls = [...items.filter((item) => item.kind === 'url').map((item) => (item as { url: string }).url), ...pendingUrls];
    const inputs = items.filter((item) => item.kind === 'input').map((item) => (item as { input: SelectedInput }).input.inputPath);
    if (urls.length + inputs.length === 0) return;
    setBusy(true);
    const result = await pc.startConvert({ urls, inputs, profile: 'preserve', target: 'addon', packBundleMode: packMode });
    setBusy(false);
    if (!result.ok) {
      toast.error('Could not start the conversion', result.error);
      return;
    }
    setItems([]);
    setDraft('');
    toast.success(urls.length + inputs.length > 1 ? 'Pack started' : 'Conversion started', 'Follow along in Jobs, or keep working. You will get a notification when it is done.', {
      label: 'Open Jobs',
      onClick: () => navigate('jobs'),
    });
  };

  const count = items.length + (trimmedDraft && !draftInvalid ? 1 : 0);
  const deployText =
    settings?.deployMode === 'local' ? `copied into ${settings.localDeployFolder ?? 'your resources folder'}` : settings?.deployMode === 'sftp' ? `uploaded to ${settings.sftpHost ?? 'your server'} over SFTP` : null;

  return (
    <div className="mx-auto max-w-[1180px]">
      <PageHeader title="Convert" description="Turn GTA V mods into FiveM-ready resources. Add one item for a single resource, or several to build a pack." />

      <div className="mb-5 flex flex-wrap gap-2">
        {CONVERT_CATEGORY_ORDER.map((key) => {
          const { icon: Icon, label } = CONVERT_CATEGORIES[key];
          const active = key === category;
          return (
            <button
              key={key}
              onClick={() => setCategory(key)}
              className={cx(
                'flex h-9 items-center gap-2 rounded-lg border px-3.5 text-[13px] font-medium transition-colors',
                active ? 'border-accent-orange/50 bg-accent-orange-dim text-white' : 'border-border-subtle bg-bg-surface text-slate-400 hover:border-border hover:text-white',
              )}
            >
              <Icon className={cx('h-4 w-4', active ? 'text-accent-orange' : 'text-slate-500')} />
              {label}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <Card>
            <SectionTitle title="What to convert" description={`Paste links or add files. The server detects the real type, so a ${info.noun} is handled correctly either way.`} />
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                addDraft();
              }}
            >
              <div className="relative flex-1">
                <Link2 className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onPaste={(event) => {
                    const text = event.clipboardData.getData('text');
                    if (/\s/.test(text.trim())) {
                      event.preventDefault();
                      addUrls(text.split(/\s+/));
                    }
                  }}
                  placeholder={info.placeholder}
                  spellCheck={false}
                  className={cx('field h-11 pl-10', draftInvalid && 'border-status-danger/60')}
                />
              </div>
              <Button type="submit" icon={Plus} disabled={!trimmedDraft || draftInvalid || items.length >= MAX_ITEMS} className="h-11">
                Add link
              </Button>
            </form>
            {draftInvalid && <p className="mt-2 text-xs text-status-danger">Only gta5-mods.com, MediaFire and ShareMods links are supported.</p>}

            <div className="mt-4">
              <Dropzone
                multiple
                compact={items.length > 0}
                modes={['archives', 'folder']}
                onSelect={(inputs) => void addInputs(inputs)}
                title={items.length ? 'Add more files' : 'Drop archives or resource folders'}
                hint=".zip, .rar, .7z, .oiv or .rpf, or a whole folder. Drop a .txt with one link per line to import a list."
              >
                <Button
                  size="sm"
                  variant="ghost"
                  icon={FileText}
                  onClick={async () => {
                    const picked = await pc.pickInputs('text', false);
                    if (picked.length) void addInputs(picked);
                  }}
                >
                  Import links
                </Button>
              </Dropzone>
            </div>

            {items.length > 0 && (
              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-400">
                    {items.length} {items.length === 1 ? 'item' : 'items'}
                    {totalBytes > 0 && <span className="ml-2 font-mono font-normal text-slate-500">{formatBytes(totalBytes)} to upload</span>}
                  </p>
                  <button className="text-xs font-semibold text-slate-500 hover:text-white" onClick={() => setItems([])}>
                    Clear all
                  </button>
                </div>
                <ul className="max-h-[300px] space-y-1.5 overflow-y-auto pr-1">
                  {items.map((item) => (
                    <li key={item.key} className="flex items-center gap-3 rounded-lg border border-border-subtle bg-bg-base/60 px-3 py-2">
                      {item.kind === 'url' ? (
                        <Link2 className="h-4 w-4 shrink-0 text-accent-teal" />
                      ) : item.input.inputKind === 'folder' ? (
                        <FolderOpen className="h-4 w-4 shrink-0 text-accent-orange" />
                      ) : (
                        <Archive className="h-4 w-4 shrink-0 text-accent-orange" />
                      )}
                      <span className="min-w-0 flex-1 truncate text-[13px] text-slate-200" title={item.kind === 'url' ? item.url : item.input.inputPath}>
                        {item.kind === 'url' ? item.url.replace(/^https?:\/\/(www\.)?/, '') : item.input.name}
                      </span>
                      {item.kind === 'input' && item.input.sizeBytes ? <span className="font-mono text-[11px] text-slate-500">{formatBytes(item.input.sizeBytes)}</span> : null}
                      <button className="text-slate-500 hover:text-white" aria-label="Remove" onClick={() => setItems((current) => current.filter((entry) => entry.key !== item.key))}>
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>

          {isPack && category === 'vehicle' && (
            <Card>
              <p className="text-[15px] font-semibold text-white">Pack output</p>
              <p className="mt-0.5 mb-4 text-[13px] text-slate-500">
                {packMode === 'separate' ? 'Each car gets its own folder and fxmanifest.lua.' : 'Every car in one folder with a single fxmanifest.lua.'}
              </p>
              <Segmented
                value={packMode}
                onChange={setPackMode}
                options={[
                  { value: 'separate', label: 'One resource per car' },
                  { value: 'single', label: 'One merged resource' },
                ]}
              />
            </Card>
          )}
        </div>

        <aside className="space-y-5">
          <Card>
            <div className="flex items-center gap-2">
              <info.icon className="h-4 w-4 text-accent-orange" />
              <p className="text-sm font-semibold text-white">{info.label}</p>
            </div>
            <p className="mt-2 text-[13px] leading-relaxed text-slate-400">{info.intro}</p>
            <ul className="mt-4 space-y-3">
              {info.points.map((point) => (
                <li key={point.title} className="border-l-2 border-border pl-3">
                  <p className="text-[13px] font-medium text-slate-200">{point.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{point.desc}</p>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <p className="eyebrow">When it finishes</p>
            <ul className="mt-3 space-y-2.5 text-[13px] text-slate-400">
              <li className="flex gap-2">
                <FolderOpen className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                <span>
                  {settings?.autoDownload === false ? 'Stays on the server, ready to download from Jobs' : 'Saved to '}
                  {settings?.autoDownload !== false && (
                    <button className="break-all text-left font-mono text-xs text-slate-200 hover:text-accent-orange" onClick={() => pc.openOutputFolder()}>
                      {settings?.outputFolder}
                    </button>
                  )}
                </span>
              </li>
              <li className="flex gap-2">
                <Rocket className={cx('mt-0.5 h-4 w-4 shrink-0', deployText ? 'text-accent-teal' : 'text-slate-500')} />
                <span>
                  {deployText ? `Then ${deployText}.` : 'No automatic deploy. '}
                  <button className="font-semibold text-accent-orange hover:underline" onClick={() => navigate('deploy')}>
                    {deployText ? 'Change' : 'Set one up'}
                  </button>
                </span>
              </li>
            </ul>
            <Button variant="primary" size="lg" icon={isPack ? Layers : RefreshCw} className="mt-5 w-full" disabled={count === 0} loading={busy} onClick={() => void start()}>
              {count === 0 ? 'Add something to convert' : isPack ? `Convert pack of ${items.length}` : 'Start conversion'}
            </Button>
            {isPack && (
              <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-xs text-slate-500">
                <Badge tone="teal">Pack</Badge> One bad link never sinks the rest.
              </p>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}
