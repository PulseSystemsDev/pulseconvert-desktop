import { useMemo, useState } from 'react';
import { Archive, FileText, FolderOpen, Link2, Plus, Rocket, X } from 'lucide-react';
import { pc, type SelectedInput } from '../lib/bridge';
import { CONVERT_CATEGORIES, CONVERT_CATEGORY_ORDER, type ConvertCategory } from '../lib/content';
import { cx, formatBytes, isSupportedSourceUrl } from '../lib/format';
import { useSettings } from '../lib/hooks';
import { takePendingInputs } from '../lib/pendingInputs';
import { useRouter } from '../lib/router';
import { useToast } from '../lib/toast';
import { Button, Card, PageHeader, Segmented, SectionTitle } from '../components/ui';
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
      <PageHeader
        title="Convert"
        description="Links or files. Add more than one to make a pack."
        actions={
          <Segmented
            value={category}
            onChange={setCategory}
            options={CONVERT_CATEGORY_ORDER.map((key) => ({ value: key, label: CONVERT_CATEGORIES[key].label, icon: CONVERT_CATEGORIES[key].icon }))}
          />
        }
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-5">
          <Card>
            <SectionTitle title="Input" description={`The server checks what each item really is, so a mislabelled ${info.noun} still converts correctly.`} />
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                addDraft();
              }}
            >
              <div className="relative flex-1">
                <Link2 className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
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
                  className={cx('field h-9 pl-8', draftInvalid && 'border-status-danger/60')}
                />
              </div>
              <Button type="submit" size="lg" icon={Plus} disabled={!trimmedDraft || draftInvalid || items.length >= MAX_ITEMS}>
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
                  <p className="text-[12px] text-zinc-400">
                    {items.length} {items.length === 1 ? 'item' : 'items'}
                    {totalBytes > 0 && <span className="ml-2 font-mono font-normal text-zinc-500">{formatBytes(totalBytes)} to upload</span>}
                  </p>
                  <button className="text-[12px] text-zinc-500 hover:text-white" onClick={() => setItems([])}>
                    Clear all
                  </button>
                </div>
                <ul className="max-h-[300px] overflow-y-auto rounded-[5px] border border-border-subtle px-2">
                  {items.map((item) => (
                    <li key={item.key} className="flex items-center gap-2.5 border-b border-border-subtle px-1 py-1.5 last:border-b-0">
                      {item.kind === 'url' ? (
                        <Link2 className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                      ) : item.input.inputKind === 'folder' ? (
                        <FolderOpen className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                      ) : (
                        <Archive className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                      )}
                      <span className="min-w-0 flex-1 truncate text-[13px] text-zinc-200" title={item.kind === 'url' ? item.url : item.input.inputPath}>
                        {item.kind === 'url' ? item.url.replace(/^https?:\/\/(www\.)?/, '') : item.input.name}
                      </span>
                      {item.kind === 'input' && item.input.sizeBytes ? <span className="font-mono text-[11px] text-zinc-500">{formatBytes(item.input.sizeBytes)}</span> : null}
                      <button className="text-zinc-500 hover:text-white" aria-label="Remove" onClick={() => setItems((current) => current.filter((entry) => entry.key !== item.key))}>
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
              <p className="text-[13px] font-semibold text-zinc-100">Pack layout</p>
              <p className="mb-3 mt-0.5 text-[12px] text-zinc-500">
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
            <p className="text-[13px] font-semibold text-zinc-100">Output</p>
            <ul className="mt-2 space-y-2 text-[12px] text-zinc-400">
              <li className="flex gap-2">
                <FolderOpen className="mt-px h-3.5 w-3.5 shrink-0 text-zinc-500" />
                <span>
                  {settings?.autoDownload === false ? 'Stays on the server, ready to download from Jobs' : 'Saved to '}
                  {settings?.autoDownload !== false && (
                    <button className="break-all text-left font-mono text-[12px] text-zinc-200 hover:underline" onClick={() => pc.openOutputFolder()}>
                      {settings?.outputFolder}
                    </button>
                  )}
                </span>
              </li>
              <li className="flex gap-2">
                <Rocket className="mt-px h-3.5 w-3.5 shrink-0 text-zinc-500" />
                <span>
                  {deployText ? `Then ${deployText}.` : 'No automatic deploy. '}
                  <button className="text-zinc-200 underline-offset-2 hover:underline" onClick={() => navigate('deploy')}>
                    {deployText ? 'Change' : 'Set one up'}
                  </button>
                </span>
              </li>
            </ul>
            <Button variant="primary" size="lg" className="mt-4 w-full" disabled={count === 0} loading={busy} onClick={() => void start()}>
              {count === 0 ? 'Add something to convert' : isPack ? `Convert pack of ${items.length}` : 'Start conversion'}
            </Button>
            {isPack && <p className="mt-2 text-[12px] text-zinc-500">If one item fails, the rest still convert.</p>}
          </Card>
        </aside>
      </div>
    </div>
  );
}
