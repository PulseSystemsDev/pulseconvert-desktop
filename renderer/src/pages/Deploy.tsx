import { useEffect, useState } from 'react';
import { Check, FolderOpen, HardDrive, KeyRound, Plug, Save, Server, ShieldCheck, XCircle } from 'lucide-react';
import { pc, type DeployMode, type DesktopSettings } from '../lib/bridge';
import { cx } from '../lib/format';
import { useSettings } from '../lib/hooks';
import { useToast } from '../lib/toast';
import { Button, Card, Field, PageHeader, SectionTitle, Skeleton } from '../components/ui';

const MODES: Array<{ value: DeployMode; title: string; desc: string; icon: typeof Server }> = [
  { value: 'none', title: 'Keep the ZIP', desc: 'Results stay in your output folder. You install them yourself.', icon: FolderOpen },
  { value: 'local', title: 'Local resources folder', desc: 'Extracted straight into a server on this computer.', icon: HardDrive },
  { value: 'sftp', title: 'Remote server (SFTP)', desc: 'Uploaded to your server as soon as it finishes.', icon: Server },
];

export function Deploy() {
  const toast = useToast();
  const [settings, setSettings] = useSettings();
  const [draft, setDraft] = useState<DesktopSettings | null>(null);
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (settings && !draft) setDraft(settings);
  }, [settings, draft]);

  if (!draft) return <Skeleton className="mx-auto h-96 max-w-[900px]" />;
  const update = (patch: Partial<DesktopSettings>) => setDraft({ ...draft, ...patch });
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings) || password.length > 0;

  const save = async (): Promise<boolean> => {
    setSaving(true);
    const result = await pc.saveSettings({
      deployMode: draft.deployMode,
      localDeployFolder: draft.localDeployFolder,
      sftpHost: draft.sftpHost,
      sftpPort: draft.sftpPort,
      sftpUsername: draft.sftpUsername,
      sftpRemotePath: draft.sftpRemotePath,
      ...(password ? { sftpPassword: password } : {}),
    });
    setSaving(false);
    if (!result.ok) {
      toast.error('Could not save', result.error);
      return false;
    }
    setSettings(result.data);
    setDraft(result.data);
    setPassword('');
    toast.success('Deploy settings saved');
    return true;
  };

  const test = async () => {
    if (dirty && !(await save())) return;
    setTesting(true);
    setTestResult(null);
    const result = await pc.testSftp();
    setTesting(false);
    setTestResult(result.ok ? { ok: true, text: `Connected. Host key ${result.data.fingerprint}` } : { ok: false, text: result.error });
  };

  return (
    <div className="mx-auto max-w-[900px]">
      <PageHeader
        title="Deploy"
        description="What happens after a job finishes. These settings and passwords stay on this computer."
        actions={
          <Button variant="primary" icon={Save} disabled={!dirty} loading={saving} onClick={() => void save()}>
            Save
          </Button>
        }
      />

      <div className="card divide-y divide-border-subtle" role="radiogroup" aria-label="After a job finishes">
        {MODES.map(({ value, title, desc }) => {
          const active = draft.deployMode === value;
          return (
            <label key={value} className="flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-white/[0.02]">
              <input type="radio" name="deployMode" checked={active} onChange={() => update({ deployMode: value })} className="mt-0.5 accent-[#f07b3f]" />
              <span>
                <span className="block text-[13px] text-zinc-100">{title}</span>
                <span className="block text-[12px] text-zinc-500">{desc}</span>
              </span>
            </label>
          );
        })}
      </div>

      {draft.deployMode === 'local' && (
        <Card className="mt-5">
          <SectionTitle title="Resources folder" description="Usually your server's resources folder, or a subfolder like resources/[converted]." />
          <div className="flex gap-2">
            <input className="field font-mono text-[13px]" readOnly value={draft.localDeployFolder ?? ''} placeholder="No folder chosen" />
            <Button
              icon={FolderOpen}
              className="h-auto"
              onClick={async () => {
                const folder = await pc.chooseFolder();
                if (folder) update({ localDeployFolder: folder });
              }}
            >
              Browse
            </Button>
          </div>
          <p className="mt-3 text-xs text-zinc-500">This folder is also what the dashboard's "optimize my server" command works on.</p>
        </Card>
      )}

      {draft.deployMode === 'sftp' && (
        <Card className="mt-5">
          <SectionTitle title="SFTP connection" description="The first successful connection remembers the server's host key, and any later change is refused until you confirm it." />
          <div className="grid grid-cols-6 gap-4">
            <Field label="Host" className="col-span-5">
              <input className="field" value={draft.sftpHost ?? ''} onChange={(event) => update({ sftpHost: event.target.value })} placeholder="play.myserver.com" spellCheck={false} />
            </Field>
            <Field label="Port" className="col-span-1">
              <input className="field font-mono" type="number" min={1} max={65535} value={draft.sftpPort} onChange={(event) => update({ sftpPort: Number(event.target.value) || 22 })} />
            </Field>
            <Field label="Username" className="col-span-3">
              <input className="field" value={draft.sftpUsername ?? ''} onChange={(event) => update({ sftpUsername: event.target.value })} autoComplete="off" spellCheck={false} />
            </Field>
            <Field label="Password" className="col-span-3" hint={settings?.hasSftpPassword ? 'Saved. Leave blank to keep it.' : undefined}>
              <input className="field" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" placeholder={settings?.hasSftpPassword ? '••••••••' : ''} />
            </Field>
            <Field label="Remote resources path" className="col-span-6">
              <input className="field font-mono text-[13px]" value={draft.sftpRemotePath ?? ''} onChange={(event) => update({ sftpRemotePath: event.target.value })} placeholder="/home/fivem/server-data/resources/[converted]" spellCheck={false} />
            </Field>
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Button icon={Plug} loading={testing} onClick={() => void test()}>
              Test connection
            </Button>
            {settings?.hasSftpPassword && (
              <Button
                variant="ghost"
                icon={KeyRound}
                onClick={async () => {
                  const result = await pc.saveSettings({ sftpPassword: '' });
                  if (result.ok) {
                    setSettings(result.data);
                    toast.success('Saved password removed');
                  }
                }}
              >
                Forget password
              </Button>
            )}
            <Button
              variant="ghost"
              icon={ShieldCheck}
              onClick={async () => {
                if (!window.confirm('Only do this if you know the server was reinstalled or its key changed. Forget the saved host key?')) return;
                await pc.forgetSftpHostKey();
                toast.success('Host key forgotten', 'The next connection will remember the new one.');
              }}
            >
              Forget host key
            </Button>
          </div>
          {testResult && (
            <p className={cx('mt-4 flex items-start gap-2 rounded-[5px] border px-3 py-2.5 text-[13px]', testResult.ok ? 'border-status-success-border bg-status-success-bg text-status-success' : 'border-status-danger-border bg-status-danger-bg text-status-danger')}>
              {testResult.ok ? <Check className="mt-0.5 h-4 w-4 shrink-0" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0" />}
              <span className="selectable break-all">{testResult.text}</span>
            </p>
          )}
        </Card>
      )}

      <ul className="mt-5 list-disc space-y-1 pl-4 text-[12px] text-zinc-500 marker:text-zinc-600">
        <li>The finished ZIP always stays in your output folder, even when a deploy fails.</li>
        <li>Passwords are encrypted with your system keychain (on Linux without one, they&apos;re kept in a file only your user can read).</li>
        <li>You can deploy any earlier result again from Jobs.</li>
      </ul>

    </div>
  );
}
