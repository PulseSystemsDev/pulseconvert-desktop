import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileSearch, FolderOpen, Search, Siren } from 'lucide-react';
import { pc, type SelectedInput, type Task } from '../lib/bridge';
import { formatBytes } from '../lib/format';
import { useRouter } from '../lib/router';
import { useToast } from '../lib/toast';
import { Badge, Button, Card, Field, PageHeader, ProgressBar, Segmented, SectionTitle } from '../components/ui';
import { Dropzone } from '../components/Dropzone';
import { SelectedFile } from './Optimize';

type Tool = 'collisions' | 'map' | 'sirens';

interface CollisionResult {
  name: string;
  hash: number;
  collidesWithVanilla: string | null;
  collidesWithIssued: string | null;
}

function Collisions() {
  const toast = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<CollisionResult[] | null>(null);
  const names = text
    .split(/[\s,]+/)
    .map((name) => name.trim())
    .filter(Boolean);

  const check = async () => {
    setBusy(true);
    const result = await pc.api<{ results: CollisionResult[] }>({ method: 'POST', path: '/api/tools/collisions', body: { names } });
    setBusy(false);
    if (result.ok) setResults(result.data.results);
    else toast.error('Could not check names', result.error);
  };

  const collisions = results?.filter((row) => row.collidesWithVanilla || row.collidesWithIssued) ?? [];
  const clear = results?.filter((row) => !row.collidesWithVanilla && !row.collidesWithIssued) ?? [];

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card>
        <SectionTitle title="Model names" description="Paste spawn or model names, one per line. Each is hashed the way the game does and checked against every vanilla vehicle and every addon name Pulse Convert has issued." />
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={12}
          placeholder={'boxville\nmycustomcar1\ntt45_aventador'}
          spellCheck={false}
          className="field resize-none font-mono text-[13px]"
        />
        <div className="mt-4 flex items-center justify-between">
          <span className="text-xs text-zinc-500">{names.length} names</span>
          <Button variant="primary" icon={Search} disabled={names.length === 0 || names.length > 2000} loading={busy} onClick={() => void check()}>
            Check for collisions
          </Button>
        </div>
      </Card>
      <Card>
        <SectionTitle title="Results" description={results ? `${collisions.length} colliding, ${clear.length} clear` : 'Results show up here.'} />
        {results && (
          <ul className="max-h-[420px] space-y-1.5 overflow-y-auto">
            {[...collisions, ...clear].map((row) => {
              const bad = row.collidesWithVanilla || row.collidesWithIssued;
              return (
                <li key={row.name} className="flex items-start gap-3 rounded-[5px] border border-border-subtle bg-bg-base/60 px-3 py-2">
                  {bad ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-status-danger" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-status-success" />}
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-[13px] text-white">{row.name}</p>
                    {bad ? (
                      <p className="text-xs text-status-danger">
                        {row.collidesWithVanilla && `Same hash as vanilla ${row.collidesWithVanilla}`}
                        {row.collidesWithVanilla && row.collidesWithIssued && ' and '}
                        {row.collidesWithIssued && `matches Pulse Convert addon ${row.collidesWithIssued}`}
                      </p>
                    ) : (
                      <p className="text-xs text-zinc-500">No collision</p>
                    )}
                  </div>
                  <span className="font-mono text-[11px] text-zinc-600">0x{(row.hash >>> 0).toString(16).padStart(8, '0')}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

interface MapReport {
  totalStreamBytes: number;
  fileCounts: { ymap: number; ytyp: number; ydr: number; ybn: number; ytd: number };
  archetypeCount: number;
  missingCollision: Array<{ name: string; file: string; reason: string }>;
  duplicateArchetypeNames: Array<{ name: string; file: string; reason: string }>;
  hashCollisions: Array<{ name: string; file: string; reason: string }>;
}

function IssueList({ title, items, tone }: { title: string; items: MapReport['missingCollision']; tone: 'danger' | 'warning' }) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <p className="text-[13px] font-semibold text-white">{title}</p>
        <Badge tone={items.length ? tone : 'success'}>{items.length}</Badge>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-zinc-500">None found.</p>
      ) : (
        <ul className="max-h-[220px] space-y-1 overflow-y-auto">
          {items.map((item, index) => (
            <li key={`${item.name}-${index}`} className="rounded-md border border-border-subtle bg-bg-base/60 px-3 py-1.5 text-xs">
              <span className="font-mono text-white">{item.name}</span>
              <span className="text-zinc-500"> · {item.file}</span>
              <span className="block text-zinc-400">{item.reason}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MapInspector({ tasks }: { tasks: Task[] }) {
  const toast = useToast();
  const [input, setInput] = useState<SelectedInput | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const task = tasks.find((item) => item.id === taskId) ?? tasks.find((item) => item.kind === 'map-inspect');
  const report = task?.phase === 'done' ? (task.result as MapReport | null) : null;

  const start = async () => {
    if (!input) return;
    const result = await pc.startMapInspect(input.inputPath);
    if (!result.ok) return toast.error('Could not inspect', result.error);
    setTaskId(result.data.taskId);
    setInput(null);
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[380px_minmax(0,1fr)]">
      <Card>
        <SectionTitle title="Map or MLO" description="A .zip of a map, MLO or interior resource. Checks for props with no collision, duplicate archetypes and hash collisions." />
        {input ? (
          <SelectedFile input={input} onClear={() => setInput(null)} />
        ) : (
          <Dropzone modes={['zip']} accept={(item) => /\.(zip|oiv)$/i.test(item.name)} onSelect={([picked]) => setInput(picked)} title="Drop a .zip to inspect" />
        )}
        <Button variant="primary" icon={FileSearch} className="mt-4 w-full" disabled={!input} onClick={() => void start()}>
          Inspect
        </Button>
      </Card>
      <Card>
        {!task ? (
          <SectionTitle title="Report" description="The report shows up here." />
        ) : task.phase !== 'done' ? (
          <div>
            <SectionTitle title={task.title} description={task.label} />
            {task.phase === 'failed' ? <p className="text-[13px] text-status-danger">{task.error}</p> : <ProgressBar percent={task.percent} />}
          </div>
        ) : report ? (
          <div className="space-y-5">
            <SectionTitle title={task.title} description={`${report.archetypeCount} archetypes · ${formatBytes(report.totalStreamBytes)} streamed`} />
            <div className="grid grid-cols-5 gap-2">
              {Object.entries(report.fileCounts).map(([ext, count]) => (
                <div key={ext} className="rounded-[5px] border border-border-subtle bg-bg-base/60 p-3 text-center">
                  <p className="font-mono text-lg font-bold text-white">{count}</p>
                  <p className="text-[11px] text-zinc-500">.{ext}</p>
                </div>
              ))}
            </div>
            <IssueList title="Props with no collision" items={report.missingCollision} tone="warning" />
            <IssueList title="Duplicate archetype names" items={report.duplicateArchetypeNames} tone="warning" />
            <IssueList title="Hash collisions" items={report.hashCollisions} tone="danger" />
          </div>
        ) : null}
      </Card>
    </div>
  );
}

function Sirens({ tasks }: { tasks: Task[] }) {
  const toast = useToast();
  const [input, setInput] = useState<SelectedInput | null>(null);
  const [form, setForm] = useState({ resourceName: '', dlcName: '', soundsetName: '', tones: '', gamedataPath: '', sounddataPath: '', wavepackPath: '' });
  const [taskId, setTaskId] = useState<string | null>(null);
  const task = tasks.find((item) => item.id === taskId);
  const tones = form.tones.split(/\r?\n/).map((tone) => tone.trim()).filter(Boolean);
  const ready = input && form.resourceName.trim() && form.dlcName.trim() && form.soundsetName.trim() && tones.length > 0;
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) => setForm((current) => ({ ...current, [key]: event.target.value }));

  useEffect(() => {
    if (task?.phase === 'done') toast.success('Siren resource saved', task.outputPath ?? undefined);
  }, [task?.phase]);

  const start = async () => {
    if (!input) return;
    const result = await pc.startSirenBuild({ inputPath: input.inputPath, ...form, tones });
    if (!result.ok) return toast.error('Could not build', result.error);
    setTaskId(result.data.taskId);
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card>
        <SectionTitle title="Siren resource" description="Turn already-built siren audio banks into a working FiveM resource with the Lua, manifest and LVC config generated for you." />
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Resource name">
            <input className="field" value={form.resourceName} onChange={set('resourceName')} placeholder="my_sirens" />
          </Field>
          <Field label="DLC name">
            <input className="field" value={form.dlcName} onChange={set('dlcName')} placeholder="mysirens" />
          </Field>
          <Field label="Soundset name" hint="Exactly as your audio tool named it." className="md:col-span-2">
            <input className="field font-mono" value={form.soundsetName} onChange={set('soundsetName')} placeholder="MYSIRENS_SOUNDSET" />
          </Field>
          <Field label="Tones" hint="One per line, matching the tone names in your audio bank." className="md:col-span-2">
            <textarea className="field resize-none font-mono" rows={5} value={form.tones} onChange={set('tones')} placeholder={'SIREN_ALPHA\nSIREN_BRAVO\nAIRHORN'} />
          </Field>
        </div>
        <details className="mt-4">
          <summary className="cursor-pointer text-[13px] font-medium text-zinc-400 hover:text-white">Custom data file paths (optional)</summary>
          <div className="mt-3 grid gap-3">
            <input className="field text-xs" value={form.gamedataPath} onChange={set('gamedataPath')} placeholder="AUDIO_GAMEDATA path (e.g. mysirens.dat151.rel)" />
            <input className="field text-xs" value={form.sounddataPath} onChange={set('sounddataPath')} placeholder="AUDIO_SOUNDDATA path (e.g. mysirens.dat54.rel)" />
            <input className="field text-xs" value={form.wavepackPath} onChange={set('wavepackPath')} placeholder="AUDIO_WAVEPACK path (e.g. mysirens.awc)" />
          </div>
        </details>
      </Card>
      <Card>
        <SectionTitle title="Audio bank files" description="A .zip of your built .awc and .rel files." />
        {input ? <SelectedFile input={input} onClear={() => setInput(null)} /> : <Dropzone modes={['zip']} accept={(item) => /\.zip$/i.test(item.name)} onSelect={([picked]) => setInput(picked)} title="Drop a .zip" compact />}
        <Button variant="primary" icon={Siren} className="mt-4 w-full" disabled={!ready} onClick={() => void start()}>
          Build siren resource
        </Button>
        {task && (
          <div className="mt-4">
            {task.phase === 'done' && task.outputPath ? (
              <Button className="w-full" icon={FolderOpen} onClick={() => pc.showInFolder(task.outputPath!)}>
                Show {task.title}.zip
              </Button>
            ) : task.phase === 'failed' ? (
              <p className="text-[13px] text-status-danger">{task.error}</p>
            ) : (
              <>
                <p className="mb-2 text-xs text-zinc-400">{task.label}</p>
                <ProgressBar percent={task.percent} />
              </>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

export function Tools({ tasks }: { tasks: Task[] }) {
  const { params } = useRouter();
  const [tool, setTool] = useState<Tool>((params.tool as Tool) || 'collisions');
  return (
    <div className="mx-auto max-w-[1180px]">
      <PageHeader title="Tools" description="Server-side checks and builders for problems conversion alone doesn't solve." />
      <Segmented
        className="mb-5"
        value={tool}
        onChange={setTool}
        options={[
          { value: 'collisions', label: 'Collision checker', icon: Search },
          { value: 'map', label: 'Map & MLO inspector', icon: FileSearch },
          { value: 'sirens', label: 'Siren builder', icon: Siren },
        ]}
      />
      {tool === 'collisions' && <Collisions />}
      {tool === 'map' && <MapInspector tasks={tasks} />}
      {tool === 'sirens' && <Sirens tasks={tasks} />}
    </div>
  );
}
