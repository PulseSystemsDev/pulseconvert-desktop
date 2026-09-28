import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { UpdateState } from './bridge';
import { useTasks, useUpdateState } from './hooks';
import { useToast } from './toast';
import { UpdatePrompt, isUpdateOffer } from '../components/UpdatePrompt';

const SESSION_START = Date.now();
// Found right after launch -> the popup. Found hours into a session (the 4-hourly check) -> a
// quiet toast plus the title bar button, instead of a dialog interrupting whatever they're doing.
const LAUNCH_WINDOW_MS = 3 * 60 * 1000;

interface UpdateContextValue {
  update: UpdateState;
  showPrompt: () => void;
}

const UpdateContext = createContext<UpdateContextValue>({ update: { state: 'idle' }, showPrompt: () => {} });

export function UpdateProvider({ children }: { children: ReactNode }) {
  const update = useUpdateState();
  const tasks = useTasks();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const announced = useRef<string | null>(null);

  useEffect(() => {
    if (!isUpdateOffer(update) || announced.current === update.version) return;
    announced.current = update.version;
    if (Date.now() - SESSION_START < LAUNCH_WINDOW_MS) setOpen(true);
    else toast.info(`Pulse Convert ${update.version} is available`, 'It downloads in the background.', { label: 'See what’s new', onClick: () => setOpen(true) });
  }, [update, toast]);

  return (
    <UpdateContext.Provider value={{ update, showPrompt: () => setOpen(true) }}>
      {children}
      {open && isUpdateOffer(update) && <UpdatePrompt update={update} tasks={tasks} onLater={() => setOpen(false)} />}
    </UpdateContext.Provider>
  );
}

export function useUpdates(): UpdateContextValue {
  return useContext(UpdateContext);
}
