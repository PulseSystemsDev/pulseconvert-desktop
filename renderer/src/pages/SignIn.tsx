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

interface ShowcaseVehicle {
  id: string;
  title: string;
  imageUrl: string;
}

function Showcase() {
  const [images, setImages] = useState<ShowcaseVehicle[]>([]);
  const [loaded, setLoaded] = useState<Set<string>>(new Set());
  useEffect(() => {
    void pc.api<{ vehicles: ShowcaseVehicle[] }>({ method: 'GET', path: '/api/catalog/showcase' }).then((result) => {
      if (result.ok) setImages(result.data.vehicles.slice(0, 12));
    });
  }, []);
  const columns = [0, 1, 2].map((column) => images.filter((_, index) => index % 3 === column));

  return (
    <div className="pointer-events-none absolute inset-0">
      <div className="absolute -left-40 -top-40 h-[520px] w-[520px] rounded-full bg-accent-orange/10 blur-[120px]" />
      {images.length >= 6 && (
        <div className="absolute -left-10 -right-10 -top-16 flex h-[72%] rotate-[-6deg] gap-3">
          {columns.map((column, index) => (
            <div key={index} className="flex flex-1 animate-[drift_60s_linear_infinite] flex-col gap-3" style={{ animationDirection: index === 1 ? 'reverse' : 'normal', marginTop: index === 1 ? -80 : 0 }}>
              {[...column, ...column].map((vehicle, position) => (
                <img
                  key={`${vehicle.id}-${position}`}
                  src={pc.resolveUrl(vehicle.imageUrl) ?? undefined}
                  alt=""
                  draggable={false}
                  onLoad={() => setLoaded((current) => new Set(current).add(vehicle.id))}
                  onError={(event) => (event.currentTarget.style.display = 'none')}
                  className="aspect-video w-full rounded-lg object-cover transition-opacity duration-700"
                  style={{ opacity: loaded.has(vehicle.id) ? 0.55 : 0 }}
                />
              ))}
            </div>
          ))}
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-bg-surface/40 via-bg-surface/70 to-bg-surface" />
      <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-bg-surface via-bg-surface/95 to-transparent" />
    </div>
  );
}

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
      <div className="relative hidden w-[46%] max-w-[640px] flex-col overflow-hidden border-r border-border-subtle bg-bg-surface lg:flex">
        <Showcase />
        <div className="relative mt-auto p-12 pt-0">
          <img src={mark} alt="" className="h-11 w-11" />
          <h1 className="mt-6 text-[34px] font-bold leading-[1.1] tracking-[-0.02em] text-white">
            GTA V mods to
            <br />
            FiveM-ready resources.
          </h1>
          <p className="mt-3 max-w-[42ch] text-[15px] leading-relaxed text-slate-400">Everything Pulse Convert does on the web, in an app that keeps working while you do other things.</p>
          <ul className="mt-8 grid grid-cols-2 gap-x-6 gap-y-4">
            {FEATURES.map(({ icon: Icon, title }) => (
              <li key={title} className="flex items-center gap-2.5 text-[13px] font-medium text-slate-300">
                <Icon className="h-4 w-4 shrink-0 text-accent-orange" />
                {title}
              </li>
            ))}
          </ul>
        </div>
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
