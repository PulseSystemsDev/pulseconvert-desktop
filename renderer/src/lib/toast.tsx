import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';
import { cx } from './format';

type ToastTone = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  body?: string;
  action?: { label: string; onClick: () => void };
}

interface ToastApi {
  success: (title: string, body?: string, action?: ToastItem['action']) => void;
  error: (title: string, body?: string) => void;
  info: (title: string, body?: string, action?: ToastItem['action']) => void;
}

const ToastContext = createContext<ToastApi | null>(null);
let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const dismiss = useCallback((id: number) => setItems((current) => current.filter((item) => item.id !== id)), []);
  const push = useCallback(
    (tone: ToastTone, title: string, body?: string, action?: ToastItem['action']) => {
      const id = nextId++;
      setItems((current) => [...current.slice(-3), { id, tone, title, body, action }]);
      setTimeout(() => dismiss(id), tone === 'error' ? 7000 : 4500);
    },
    [dismiss],
  );
  const api = useMemo<ToastApi>(
    () => ({
      success: (title, body, action) => push('success', title, body, action),
      error: (title, body) => push('error', title, body),
      info: (title, body, action) => push('info', title, body, action),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[80] flex w-[min(400px,calc(100%-2rem))] flex-col gap-2" aria-live="polite">
        {items.map((item) => {
          const Icon = item.tone === 'success' ? CheckCircle2 : item.tone === 'error' ? TriangleAlert : Info;
          return (
            <div key={item.id} className="pointer-events-auto flex animate-rise items-start gap-3 rounded-xl border border-border bg-bg-elevated px-4 py-3 shadow-panel">
              <Icon
                className={cx(
                  'mt-0.5 h-4 w-4 shrink-0',
                  item.tone === 'success' && 'text-status-success',
                  item.tone === 'error' && 'text-status-danger',
                  item.tone === 'info' && 'text-accent-orange',
                )}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white">{item.title}</p>
                {item.body && <p className="mt-0.5 break-words text-xs text-slate-400">{item.body}</p>}
                {item.action && (
                  <button
                    className="mt-1.5 text-xs font-semibold text-accent-orange hover:underline"
                    onClick={() => {
                      item.action?.onClick();
                      dismiss(item.id);
                    }}
                  >
                    {item.action.label}
                  </button>
                )}
              </div>
              <button className="text-slate-500 hover:text-white" onClick={() => dismiss(item.id)} aria-label="Dismiss">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast outside ToastProvider');
  return value;
}
