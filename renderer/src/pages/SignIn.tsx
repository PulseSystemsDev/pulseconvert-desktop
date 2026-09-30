import { useEffect, useState } from 'react';
import { CheckCircle2, Copy, ExternalLink, Loader2 } from 'lucide-react';
import mark from '../assets/mark.png';
import { pc, type AuthStatus } from '../lib/bridge';
import { Button } from '../components/ui';

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
    <div className="flex h-full items-center justify-center overflow-y-auto p-10">
      <div className="w-full max-w-[380px]">
        <div className="mb-6 flex items-center gap-2.5">
          <img src={mark} alt="" className="h-7 w-7" />
          <span className="text-[14px] font-semibold text-zinc-200">Pulse Convert</span>
        </div>
        <h1 className="text-[18px] font-semibold text-white">{awaiting ? 'Approve this device' : 'Sign in'}</h1>
        <p className="mt-1 text-[13px] leading-relaxed text-zinc-400">
          {awaiting
            ? 'Pulse Accounts is open in your browser. Check the code there matches this one, then approve.'
            : 'Use your Pulse account, the same one as the website. Your jobs and limits carry over.'}
        </p>

        {awaiting ? (
          <div className="mt-6 border-t border-border-subtle pt-5">
            <p className="eyebrow">Code</p>
            <div className="mt-1 flex items-center justify-between gap-3">
              <code className="font-mono text-[26px] font-medium tracking-[0.14em] text-white">{awaiting.userCode}</code>
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
            <p className="mt-3 flex items-center gap-2 text-[12px] text-zinc-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Waiting for approval, expires in <span className="font-mono text-zinc-300">{countdown}</span>
            </p>
            <div className="mt-5 flex gap-2">
              <Button variant="primary" size="lg" icon={ExternalLink} className="flex-1" onClick={() => pc.openExternal(awaiting.verificationUriComplete)}>
                Open sign-in page
              </Button>
              <Button size="lg" variant="ghost" onClick={() => pc.cancelSignIn()}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-6">
            {message && <p className="mb-4 rounded-[5px] border border-status-danger-border bg-status-danger-bg px-3 py-2 text-[13px] text-status-danger">{message}</p>}
            <Button variant="primary" size="lg" className="w-full" loading={status.state === 'starting'} onClick={() => pc.startSignIn()}>
              Sign in with Pulse
            </Button>
            <p className="mt-5 text-[12px] leading-relaxed text-zinc-500">
              Files you convert are uploaded to Pulse Convert and processed there. Deploy passwords stay on this computer.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
