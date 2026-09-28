import { useEffect, useState } from 'react';
import { CheckCircle2, Copy, ExternalLink, Gauge, LayoutGrid, Loader2, LogIn, RefreshCw, Rocket } from 'lucide-react';
import mark from '../assets/mark.png';
import { pc, type AuthStatus } from '../lib/bridge';
import { Button } from '../components/ui';

const FEATURES = [
  { icon: RefreshCw, title: 'Convert anything', desc: 'Vehicles, props, maps, EUP, weapons, peds and animation packs from a link or a file.' },
  { icon: Gauge, title: 'Optimize and fix', desc: 'Slim down heavy resources and repair broken meta without leaving the app.' },
  { icon: LayoutGrid, title: 'The whole catalog', desc: 'Search thousands of prebuilt vehicles and grab instant downloads.' },
  { icon: Rocket, title: 'Deploy straight to your server', desc: 'Drop results into a local resources folder or push them over SFTP.' },
];

function useCountdown(expiresAt: number | null): string {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);
  if (!expiresAt) return '';
  const left = Math.max(0, Math.round((expiresAt - now) / 1000));
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
}

export function SignIn({ status }: { status: AuthStatus }) {
  const awaiting = status.state === 'awaiting-approval' ? status : null;
  const countdown = useCountdown(awaiting?.expiresAt ?? null);
  const [copied, setCopied] = useState(false);

  const message =
    status.state === 'denied'
      ? 'Sign-in was declined in the browser. You can try again.'
      : status.state === 'expired'
        ? 'That code expired before it was approved. Start again for a fresh one.'
        : status.state === 'error'
          ? status.message
          : null;

  return (
    <div className="flex h-full overflow-y-auto">
      <div className="relative hidden w-[46%] max-w-[620px] flex-col justify-center gap-16 overflow-hidden border-r border-border-subtle bg-bg-surface p-12 lg:flex">
        <div className="pointer-events-none absolute -left-40 -top-40 h-[520px] w-[520px] rounded-full bg-accent-orange/10 blur-[120px]" />
        <div className="relative">
          <img src={mark} alt="" className="h-12 w-12" />
          <h1 className="mt-8 text-[34px] font-bold leading-[1.1] tracking-[-0.02em] text-white">
            GTA V mods to
            <br />
            FiveM-ready resources.
          </h1>
          <p className="mt-4 max-w-[42ch] text-[15px] leading-relaxed text-slate-400">Everything Pulse Convert does on the web, in an app that keeps working while you do other things.</p>
        </div>
        <ul className="relative space-y-5">
          {FEATURES.map(({ icon: Icon, title, desc }) => (
            <li key={title} className="flex gap-4">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-bg-elevated">
                <Icon className="h-4 w-4 text-accent-orange" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">{title}</p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-slate-500">{desc}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-1 items-center justify-center p-10">
        <div className="w-full max-w-[420px]">
          <img src={mark} alt="" className="mb-6 h-10 w-10 lg:hidden" />
          <h2 className="text-2xl font-bold tracking-tight text-white">{awaiting ? 'Approve this device' : 'Sign in to Pulse Convert'}</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">
            {awaiting
              ? 'We opened Pulse Accounts in your browser. Check that the code there matches this one, then approve.'
              : 'Use the same Discord-linked Pulse account as the website. Your jobs, history and limits carry over.'}
          </p>

          {awaiting ? (
            <div className="mt-8 rounded-xl border border-border bg-bg-surface p-6">
              <p className="eyebrow">Your code</p>
              <div className="mt-3 flex items-center justify-between gap-3">
                <code className="font-mono text-[32px] font-bold tracking-[0.18em] text-white">{awaiting.userCode}</code>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={copied ? CheckCircle2 : Copy}
                  onClick={() => {
                    void navigator.clipboard.writeText(awaiting.userCode);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                >
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
              <div className="mt-5 flex items-center gap-2 text-xs text-slate-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-accent-orange" />
                Waiting for approval · expires in <span className="font-mono text-slate-300">{countdown}</span>
              </div>
              <div className="mt-6 flex gap-2">
                <Button variant="primary" icon={ExternalLink} className="flex-1" onClick={() => pc.openExternal(awaiting.verificationUriComplete)}>
                  Open sign-in page
                </Button>
                <Button variant="ghost" onClick={() => pc.cancelSignIn()}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-8">
              {message && <p className="mb-4 rounded-lg border border-status-danger-border bg-status-danger-bg px-3 py-2.5 text-[13px] text-status-danger">{message}</p>}
              <Button variant="primary" size="lg" icon={LogIn} className="w-full" loading={status.state === 'starting'} onClick={() => pc.startSignIn()}>
                Sign in with Pulse
              </Button>
              <p className="mt-6 text-xs leading-relaxed text-slate-500">
                Files you convert are uploaded securely to Pulse Convert and processed there. Deploy passwords never leave this computer.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
