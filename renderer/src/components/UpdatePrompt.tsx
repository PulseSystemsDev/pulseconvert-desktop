import { Download, Loader2, X } from 'lucide-react';
import mark from '../assets/mark.png';
import { pc, type Task, type UpdateState } from '../lib/bridge';
import { Button, ProgressBar } from './ui';
import { isActive } from './taskMeta';

type Offer = Extract<UpdateState, { state: 'available' | 'downloading' | 'ready' }>;

export function isUpdateOffer(state: UpdateState): state is Offer {
  return state.state === 'available' || state.state === 'downloading' || state.state === 'ready';
}

export function UpdatePrompt({ update, tasks, onLater }: { update: Offer; tasks: Task[]; onLater: () => void }) {
  const ready = update.state === 'ready';
  const requested = update.state !== 'ready' && update.installRequested;
  const percent = update.state === 'downloading' ? update.percent : update.state === 'ready' ? 100 : null;
  const uploading = tasks.filter((task) => isActive(task) && !task.jobId).length;

  return (
    <div className="fixed inset-0 top-11 z-[75] flex animate-fade-in items-center justify-center bg-bg-base/80 p-6 " role="dialog" aria-modal="true" aria-labelledby="update-title">
      <div className="w-full max-w-[480px] animate-rise overflow-hidden rounded-md border border-border bg-bg-surface shadow-panel">
        <div className="relative px-7 pb-5 pt-7">
          <button onClick={onLater} aria-label="Remind me later" className="absolute right-4 top-4 rounded-[5px] p-1.5 text-zinc-500 transition-colors hover:bg-white/[0.06] hover:text-white">
            <X className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-3">
            <img src={mark} alt="" className="h-8 w-8" />
            <div>
              <p className="text-[12px] text-zinc-500">Update available</p>
              <h2 id="update-title" className="text-[15px] font-semibold text-white">
                Pulse Convert {update.version}
              </h2>
            </div>
          </div>

          {update.notes ? (
            <div className="mt-5">
              <p className="eyebrow mb-2">What&apos;s new</p>
              <p className="selectable max-h-[200px] overflow-y-auto whitespace-pre-line rounded-[5px] border border-border-subtle bg-bg-base/60 p-3 text-[13px] leading-relaxed text-zinc-300">{update.notes}</p>
            </div>
          ) : (
            <p className="mt-5 text-[13px] leading-relaxed text-zinc-400">A new version of Pulse Convert is ready to install.</p>
          )}

          {!ready && (
            <div className="mt-5">
              <div className="mb-1.5 flex items-center justify-between text-xs text-zinc-500">
                <span className="flex items-center gap-1.5">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {requested ? 'Downloading - the app restarts as soon as it finishes' : 'Downloading in the background'}
                </span>
                {percent !== null && <span className="font-mono">{percent}%</span>}
              </div>
              <ProgressBar percent={percent} tone="teal" />
            </div>
          )}

          {uploading > 0 && (
            <p className="mt-4 rounded-[5px] border border-status-warning-border bg-status-warning-bg px-3 py-2 text-xs text-status-warning">
              {uploading} {uploading === 1 ? 'upload is' : 'uploads are'} still in progress and will need starting again after the restart. Jobs already on the server carry on.
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border-subtle bg-bg-base/40 px-7 py-4">
          <Button variant="ghost" onClick={onLater}>
            {requested ? 'Hide' : 'Remind me later'}
          </Button>
          <Button variant="primary" icon={requested ? Loader2 : Download} disabled={requested} className={requested ? '[&>svg]:animate-spin' : undefined} onClick={() => pc.installUpdate()}>
            {ready ? 'Update now' : requested ? 'Updating...' : 'Update now'}
          </Button>
        </div>
      </div>
    </div>
  );
}
