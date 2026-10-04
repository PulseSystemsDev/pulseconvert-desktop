import { useState } from 'react';
import { ArrowRight, Check, FolderOpen, HardDrive, Server } from 'lucide-react';
import mark from '../assets/mark.png';
import { pc, type DeployMode, type DesktopSettings } from '../lib/bridge';
import { useAccount } from '../lib/account';
import { cx } from '../lib/format';
import { useRouter } from '../lib/router';
import { useToast } from '../lib/toast';
import { Button, Toggle } from './ui';

const DESTINATIONS: Array<{ value: DeployMode; title: string; desc: string; icon: typeof Server }> = [
  { value: 'none', title: 'Just keep the ZIP', desc: "I'll install resources myself.", icon: FolderOpen },
  { value: 'local', title: 'A server on this computer', desc: 'Extract into a local resources folder.', icon: HardDrive },
  { value: 'sftp', title: 'A remote server', desc: 'Upload over SFTP. You can fill in the details next.', icon: Server },
];

export function Welcome({ settings, onDone }: { settings: DesktopSettings; onDone: (next: DesktopSettings) => void }) {
  const { data: account } = useAccount();
  const { navigate } = useRouter();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [outputFolder, setOutputFolder] = useState(settings.outputFolder);
  const [autoDownload, setAutoDownload] = useState(settings.autoDownload);
  const [notify, setNotify] = useState(settings.notifyOnComplete);
  const [deployMode, setDeployMode] = useState<DeployMode>(settings.deployMode);
  const [localFolder, setLocalFolder] = useState<string | null>(settings.localDeployFolder);
  const [saving, setSaving] = useState(false);

  const finish = async (skip = false) => {
    setSaving(true);
    const result = await pc.saveSettings(
      skip
        ? { onboarded: true }
        : {
            onboarded: true,
            outputFolder,
            autoDownload,
            notifyOnComplete: notify,
            deployMode: deployMode === 'local' && !localFolder ? 'none' : deployMode,
            localDeployFolder: localFolder,
          },
    );
    setSaving(false);
    if (!result.ok) return toast.error('Could not save', result.error);
    onDone(result.data);
    if (!skip && deployMode === 'sftp') navigate('deploy');
  };

  return (
    <div className="fixed inset-0 top-11 z-[60] flex animate-fade-in items-center justify-center bg-bg-base/85 p-6 backdrop-blur-sm">
      <div className="w-full max-w-[560px] animate-rise rounded-md border border-border bg-bg-surface shadow-panel">
        <div className="flex items-center gap-2 border-b border-border-subtle px-7 pt-6 pb-5">
          <img src={mark} alt="" className="h-9 w-9" />
          <div className="flex-1">
            <p className="text-[15px] font-bold text-white">Welcome{account?.username ? `, ${account.username}` : ''}</p>
            <p className="text-xs text-zinc-500">Step {step + 1} of 2</p>
          </div>
          <div className="flex gap-1.5">
            {[0, 1].map((index) => (
              <span key={index} className={cx('h-1.5 w-6 rounded-full transition-colors', index <= step ? 'bg-accent-orange' : 'bg-border')} />
            ))}
          </div>
        </div>

        <div className="px-7 py-6">
          {step === 0 ? (
            <>
              <h2 className="text-lg font-bold text-white">Where should finished resources go?</h2>
              <p className="mt-1 text-[13px] text-zinc-400">Every conversion, optimization and download is saved here as a ZIP.</p>
              <div className="mt-5 flex gap-2">
                <input className="field font-mono text-[13px]" readOnly value={outputFolder} />
                <Button
                  className="h-auto"
                  onClick={async () => {
                    const folder = await pc.chooseFolder();
                    if (folder) setOutputFolder(folder);
                  }}
                >
                  Change
                </Button>
              </div>
              <div className="mt-3 divide-y divide-border-subtle">
                <Toggle label="Download results automatically" description="Finished jobs land in this folder without you clicking anything." checked={autoDownload} onChange={setAutoDownload} />
                <Toggle label="Notify me when something finishes" description="A desktop notification while the app is in the background." checked={notify} onChange={setNotify} />
              </div>
            </>
          ) : (
            <>
              <h2 className="text-lg font-bold text-white">Send them straight to your server?</h2>
              <p className="mt-1 text-[13px] text-zinc-400">Pulse Convert can drop every finished resource where your server can load it.</p>
              <div className="mt-5 space-y-2">
                {DESTINATIONS.map(({ value, title, desc, icon: Icon }) => {
                  const active = deployMode === value;
                  return (
                    <button
                      key={value}
                      onClick={() => setDeployMode(value)}
                      className={cx('flex w-full items-center gap-3 rounded-md border p-3.5 text-left transition-colors', active ? 'border-accent-orange/50 bg-accent-orange/[0.05]' : 'border-border-subtle hover:border-border')}
                    >
                      <Icon className={cx('h-5 w-5 shrink-0', active ? 'text-accent-orange' : 'text-zinc-500')} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-white">{title}</span>
                        <span className="block text-xs text-zinc-500">{desc}</span>
                      </span>
                      <span className={cx('flex h-5 w-5 items-center justify-center rounded-full border', active ? 'border-accent-orange bg-accent-orange' : 'border-border')}>
                        {active && <Check className="h-3 w-3 text-bg-base" />}
                      </span>
                    </button>
                  );
                })}
              </div>
              {deployMode === 'local' && (
                <div className="mt-4 flex gap-2">
                  <input className="field font-mono text-[13px]" readOnly value={localFolder ?? ''} placeholder="Choose your server's resources folder" />
                  <Button
                    className="h-auto"
                    onClick={async () => {
                      const folder = await pc.chooseFolder();
                      if (folder) setLocalFolder(folder);
                    }}
                  >
                    Browse
                  </Button>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border-subtle px-7 py-4">
          <button className="text-xs font-semibold text-zinc-500 hover:text-white" onClick={() => void finish(true)}>
            Skip for now
          </button>
          <div className="flex gap-2">
            {step === 1 && (
              <Button variant="ghost" onClick={() => setStep(0)}>
                Back
              </Button>
            )}
            {step === 0 ? (
              <Button variant="primary" onClick={() => setStep(1)}>
                Next <ArrowRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button variant="primary" loading={saving} disabled={deployMode === 'local' && !localFolder} onClick={() => void finish()}>
                {deployMode === 'sftp' ? 'Continue to SFTP setup' : 'Finish'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
