import { useEffect, useRef, useState } from 'react';
import { Activity, Download, Search } from 'lucide-react';
import mark from '../assets/mark.png';
import { pc, type Task } from '../lib/bridge';
import { cx } from '../lib/format';
import { useUpdates } from '../lib/updates';
import { isUpdateOffer } from './UpdatePrompt';
import { useRouter } from '../lib/router';
import { Kbd } from './ui';
import { TaskRow } from './TaskRow';
import { isActive } from './taskMeta';

export function TitleBar({ tasks, signedIn }: { tasks: Task[]; signedIn: boolean }) {
  const { navigate } = useRouter();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const active = tasks.filter(isActive);
  const recent = tasks.slice(0, 5);
  const mac = pc.platform === 'darwin';
  const { update, showPrompt } = useUpdates();
  const offer = isUpdateOffer(update) ? update : null;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <header
      className="drag relative z-40 flex h-10 shrink-0 items-center gap-4 border-b border-border-subtle bg-[#0d0d0e]"
      style={{ paddingLeft: mac ? 84 : 14, paddingRight: mac ? 14 : 'calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw) + 12px)' }}
    >
      <div className="flex w-[172px] shrink-0 items-center gap-2">
        <img src={mark} alt="" className="h-5 w-5" draggable={false} />
        <span className="text-[13px] font-semibold text-zinc-200">Pulse Convert</span>
      </div>

      {signedIn && (
        <form
          className="no-drag relative mx-auto w-full max-w-[440px]"
          onSubmit={(event) => {
            event.preventDefault();
            navigate('catalog', { q: query.trim() });
            inputRef.current?.blur();
          }}
        >
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search the catalog"
            className="h-7 w-full rounded-[5px] border border-border-subtle bg-bg-surface pl-8 pr-14 text-[12px] text-white placeholder:text-zinc-500 focus:border-accent-orange/60 focus:outline-none"
          />
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">
            <Kbd>{mac ? '⌘' : 'Ctrl'} K</Kbd>
          </span>
        </form>
      )}

      {offer && (
        <button
          onClick={showPrompt}
          className={cx(
            'no-drag flex h-8 items-center gap-2 rounded-[5px] px-2.5 text-xs font-bold transition-colors',
            offer.state === 'ready' ? 'bg-accent-teal text-bg-base hover:bg-accent-teal/90' : 'border border-accent-teal/40 text-accent-teal hover:bg-accent-teal/10',
            !signedIn && 'ml-auto',
          )}
        >
          <Download className="h-3.5 w-3.5" />
          {offer.state === 'ready' ? `Update to ${offer.version}` : `${offer.version} available`}
        </button>
      )}

      {signedIn && (
        <div className={cx('no-drag relative', !offer && 'ml-auto')} ref={popRef}>
          <button
            onClick={() => setOpen((value) => !value)}
            className={cx(
              'flex h-7 items-center gap-2 rounded-[5px] px-2 text-[12px] transition-colors hover:bg-white/[0.06]',
              active.length ? 'text-zinc-100' : 'text-zinc-400 hover:text-white',
            )}
          >
            {active.length ? <span className="h-1.5 w-1.5 rounded-full bg-accent-orange" /> : <Activity className="h-3.5 w-3.5" />}
            {active.length ? `${active.length} running` : 'Activity'}
          </button>
          {open && (
            <div className="absolute right-0 top-10 w-[420px] animate-rise rounded-md border border-border bg-bg-surface p-3 shadow-panel">
              <div className="mb-2 flex items-center justify-between px-1">
                <p className="eyebrow">On this device</p>
                <button
                  className="text-[12px] text-zinc-400 hover:text-white hover:underline"
                  onClick={() => {
                    setOpen(false);
                    navigate('jobs');
                  }}
                >
                  Open Jobs
                </button>
              </div>
              {recent.length === 0 ? (
                <p className="px-1 py-6 text-center text-xs text-zinc-500">Nothing yet. Conversions you start will show up here live.</p>
              ) : (
                <div className="max-h-[420px] space-y-2 overflow-y-auto">
                  {recent.map((task) => (
                    <TaskRow key={task.id} task={task} compact />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </header>
  );
}
