import { useEffect, useState } from 'react';
import { BookOpen, Download, ExternalLink, FolderOpen, Heart, Laptop, LogOut, MessageCircle, RefreshCw, Trash2 } from 'lucide-react';
import mark from '../assets/mark.png';
import { pc, type AppInfo, type DesktopSettings } from '../lib/bridge';
import { useAccount } from '../lib/account';
import { formatBytes, timeAgo } from '../lib/format';
import { useSettings, useUpdateState } from '../lib/hooks';
import { useToast } from '../lib/toast';
import { Badge, Button, Card, PageHeader, ProgressBar, Segmented, SectionTitle, Skeleton, Toggle } from '../components/ui';

function AccountSection() {
  const { data, reload } = useAccount();
  const toast = useToast();
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => void pc.getAppInfo().then(setInfo), []);
  if (!data) return <Skeleton className="h-48" />;

  return (
    <Card>
      <div className="flex items-center gap-4">
        {data.avatar ? (
          <img src={data.avatar} alt="" className="h-14 w-14 rounded-full" />
        ) : (
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-orange-dim text-xl font-bold text-accent-orange">{(data.username ?? 'P').slice(0, 1).toUpperCase()}</div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-bold text-white">{data.username ?? 'Pulse account'}</p>
          <p className="text-[13px] text-slate-500">{data.firstLogin ? `Member since ${new Date(data.firstLogin).toLocaleDateString()}` : 'Signed in with Pulse Accounts'}</p>
        </div>
        <Button variant="danger" icon={LogOut} onClick={() => window.confirm('Sign out of Pulse Convert on this computer?') && pc.signOut()}>
          Sign out
        </Button>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ['Jobs today', `${data.usage.jobs} / ${data.limits.maxJobsPerDay}`],
          ['Data today', `${formatBytes(data.usage.bytes)} / ${formatBytes(data.limits.maxBytesPerDay)}`],
          ['Finished', data.stats.doneJobs.toLocaleString()],
          ['Delivered', formatBytes(data.stats.totalOutputBytes)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-border-subtle bg-bg-base/60 p-3">
            <p className="eyebrow">{label}</p>
            <p className="mt-1 truncate font-mono text-[15px] font-bold text-white">{value}</p>
          </div>
        ))}
      </div>
      {!data.limits.conversionsEnabled && <p className="mt-4 rounded-lg border border-status-warning-border bg-status-warning-bg px-3 py-2 text-[13px] text-status-warning">Conversions are paused site-wide right now.</p>}

      <div className="mt-2 divide-y divide-border-subtle">
        <Toggle
          label="Discord DMs when a job finishes"
          description="The Pulse Convert bot messages you on Discord. Handy when you're away from this computer."
          checked={data.dmNotificationsEnabled}
          onChange={async (enabled) => {
            const result = await pc.api({ method: 'POST', path: '/api/account/notifications', body: { enabled } });
            if (result.ok) reload();
            else toast.error('Could not update', result.error);
          }}
        />
      </div>

      <div className="mt-4">
        <p className="eyebrow mb-2">Linked desktop devices</p>
        <ul className="space-y-1.5">
          {data.devices.map((device) => {
            const current = device.id === info?.deviceId;
            return (
              <li key={device.id} className="flex items-center gap-3 rounded-lg border border-border-subtle bg-bg-base/60 px-3 py-2">
                <Laptop className="h-4 w-4 text-slate-500" />
                <span className="min-w-0 flex-1 truncate text-[13px] text-white">
                  {device.name} <span className="text-slate-500">· {device.platform ?? 'unknown'}</span>
                </span>
                {current ? <Badge tone="teal">This computer</Badge> : <span className="text-[11px] text-slate-500">seen {timeAgo(device.lastSeenAt)}</span>}
                {!current && (
                  <button
                    className="text-slate-500 hover:text-status-danger"
                    aria-label="Unlink device"
                    onClick={async () => {
                      if (!window.confirm(`Unlink ${device.name}? It will stop receiving jobs from the dashboard.`)) return;
                      const result = await pc.api({ method: 'DELETE', path: `/api/desktop/devices/${device.id}` });
                      if (result.ok) reload();
                      else toast.error('Could not unlink', result.error);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </Card>
  );
}

function UpdatesSection({ info }: { info: AppInfo | null }) {
  const state = useUpdateState();
  const text =
    state.state === 'checking'
      ? 'Checking for updates...'
      : state.state === 'available'
        ? `Version ${state.version} found, downloading.`
        : state.state === 'downloading'
          ? `Downloading ${state.version ?? 'update'} (${state.percent}%)`
          : state.state === 'ready'
            ? `Version ${state.version} is ready. Restart to finish updating.`
            : state.state === 'up-to-date'
              ? "You're on the latest version."
              : state.state === 'unsupported'
                ? state.reason
                : state.state === 'error'
                  ? `Update check failed: ${state.message}`
                  : 'Updates install automatically in the background.';
  return (
    <Card>
      <SectionTitle title="Updates" description={text} />
      {state.state === 'downloading' && <ProgressBar percent={state.percent} className="mb-4" />}
      <div className="flex flex-wrap items-center gap-2">
        {state.state === 'ready' ? (
          <Button variant="primary" icon={Download} onClick={() => pc.installUpdate()}>
            Restart and update
          </Button>
        ) : (
          <Button icon={RefreshCw} disabled={state.state === 'unsupported' || state.state === 'checking' || state.state === 'downloading'} onClick={() => pc.checkForUpdates()}>
            Check now
          </Button>
        )}
        <span className="ml-auto font-mono text-xs text-slate-500">
          v{info?.version} · {info?.platform} {info?.arch}
        </span>
      </div>
    </Card>
  );
}

export function Settings() {
  const toast = useToast();
  const [settings, setSettings] = useSettings();
  const [info, setInfo] = useState<AppInfo | null>(null);
  useEffect(() => void pc.getAppInfo().then(setInfo), []);

  const save = async (patch: Partial<DesktopSettings>) => {
    if (!settings) return;
    setSettings({ ...settings, ...patch });
    const result = await pc.saveSettings(patch);
    if (result.ok) setSettings(result.data);
    else {
      toast.error('Could not save', result.error);
      setSettings(settings);
    }
  };

  return (
    <div className="mx-auto max-w-[900px] space-y-5">
      <PageHeader title="Settings" />
      <AccountSection />

      {settings ? (
        <>
          <Card>
            <SectionTitle title="Output" description="Where finished resources are saved." />
            <div className="flex gap-2">
              <input className="field font-mono text-[13px]" readOnly value={settings.outputFolder} />
              <Button
                className="h-auto"
                onClick={async () => {
                  const folder = await pc.chooseFolder();
                  if (folder) void save({ outputFolder: folder });
                }}
              >
                Change
              </Button>
              <Button className="h-auto" variant="ghost" icon={FolderOpen} onClick={() => pc.openOutputFolder()}>
                Open
              </Button>
            </div>
            <div className="mt-3 divide-y divide-border-subtle">
              <Toggle
                label="Download results automatically"
                description="Pull every finished job into the output folder (and deploy it, if deploy is set up). Turn off to download from Jobs yourself."
                checked={settings.autoDownload}
                onChange={(value) => void save({ autoDownload: value })}
              />
              <Toggle label="Show the file when it's done" description="Opens the output folder with the new file selected." checked={settings.revealOnComplete} onChange={(value) => void save({ revealOnComplete: value })} />
              <Toggle label="Desktop notifications" description="A system notification when something finishes or fails while the app is in the background." checked={settings.notifyOnComplete} onChange={(value) => void save({ notifyOnComplete: value })} />
            </div>
          </Card>

          <Card>
            <SectionTitle title="Conversions" />
            <div className="flex items-center justify-between gap-6">
              <div>
                <p className="text-sm font-medium text-white">Default install type</p>
                <p className="mt-0.5 text-[13px] text-slate-500">Used for quick converts and catalog conversions. You can still change it per conversion.</p>
              </div>
              <Segmented
                value={settings.defaultTarget}
                onChange={(value) => void save({ defaultTarget: value })}
                options={[
                  { value: 'addon', label: 'Add-on' },
                  { value: 'replace', label: 'Replacement' },
                ]}
              />
            </div>
            <div className="mt-2 divide-y divide-border-subtle">
              <Toggle
                label="Accept jobs from the website dashboard"
                description="Lets you send a conversion or an optimize run to this computer from convert.pulsesystems.dev."
                checked={settings.acceptDashboardCommands}
                onChange={(value) => void save({ acceptDashboardCommands: value })}
              />
              <Toggle label="Start in the background" description="Open without stealing focus. Handy when this computer handles dashboard jobs." checked={settings.launchMinimized} onChange={(value) => void save({ launchMinimized: value })} />
            </div>
          </Card>
        </>
      ) : (
        <Skeleton className="h-64" />
      )}

      <UpdatesSection info={info} />

      <Card>
        <div className="flex items-center gap-4">
          <img src={mark} alt="" className="h-12 w-12" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-white">Pulse Convert Desktop</p>
            <p className="text-[13px] text-slate-500">
              by Pulse Systems · connected to <span className="font-mono">{info?.apiBaseUrl.replace(/^https?:\/\//, '')}</span>
            </p>
            <p className="mt-0.5 text-xs text-slate-600">Credentials stored in {info?.credentialStorage === 'os-keychain' ? 'your system keychain' : 'a user-only file (no system keychain found)'}</p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" icon={BookOpen} onClick={() => pc.openExternal('https://docs.pulsesystems.dev/pulseconvert')}>
            Docs
          </Button>
          <Button size="sm" variant="ghost" icon={Heart} onClick={() => pc.openExternal(`${info?.apiBaseUrl ?? 'https://convert.pulsesystems.dev'}/support`)}>
            Support Pulse Convert
          </Button>
          <Button size="sm" variant="ghost" icon={MessageCircle} onClick={() => pc.openExternal(`${info?.apiBaseUrl ?? 'https://convert.pulsesystems.dev'}/about`)}>
            About
          </Button>
          <Button size="sm" variant="ghost" icon={ExternalLink} onClick={() => pc.openExternal(info?.apiBaseUrl ?? 'https://convert.pulsesystems.dev')}>
            Open the website
          </Button>
        </div>
      </Card>
    </div>
  );
}
