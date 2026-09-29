import { useEffect, useRef, useState, type ButtonHTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { Check, ChevronDown, Loader2, X, type LucideIcon } from 'lucide-react';
import { cx } from '../lib/format';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'teal';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent-orange text-bg-base hover:bg-[#ff8b4d] shadow-glow disabled:shadow-none',
  secondary: 'border border-border bg-bg-elevated text-slate-200 hover:border-border-strong hover:bg-bg-hover hover:text-white',
  ghost: 'text-slate-400 hover:bg-white/[0.05] hover:text-white',
  danger: 'border border-status-danger-border bg-status-danger-bg text-status-danger hover:bg-status-danger/20',
  teal: 'bg-accent-teal text-bg-base hover:bg-accent-teal/90',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  loading,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md' | 'lg'; icon?: LucideIcon; loading?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || loading}
      className={cx(
        'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg font-semibold transition-[background-color,border-color,color,transform,box-shadow] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] active:translate-y-px disabled:cursor-not-allowed disabled:opacity-45',
        size === 'sm' && 'h-8 px-3 text-xs',
        size === 'md' && 'h-10 px-4 text-sm',
        size === 'lg' && 'h-12 px-6 text-[15px]',
        BUTTON_VARIANTS[variant],
        className,
      )}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : Icon ? <Icon className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} /> : null}
      {children}
    </button>
  );
}

export function IconButton({ icon: Icon, label, className, active, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...props}
      className={cx(
        'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-white disabled:opacity-40',
        active && 'text-accent-orange',
        className,
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

type Tone = 'neutral' | 'orange' | 'teal' | 'success' | 'danger' | 'warning' | 'info';

const TONES: Record<Tone, string> = {
  neutral: 'border-border bg-white/[0.03] text-slate-400',
  orange: 'border-accent-orange/30 bg-accent-orange-dim text-accent-orange',
  teal: 'border-accent-teal/30 bg-accent-teal/10 text-accent-teal',
  success: 'border-status-success-border bg-status-success-bg text-status-success',
  danger: 'border-status-danger-border bg-status-danger-bg text-status-danger',
  warning: 'border-status-warning-border bg-status-warning-bg text-status-warning',
  info: 'border-status-info-border bg-status-info-bg text-status-info',
};

export function Badge({ tone = 'neutral', icon: Icon, children, className }: { tone?: Tone; icon?: LucideIcon; children: ReactNode; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-semibold', TONES[tone], className)}>
      {Icon && <Icon className="h-3 w-3" />}
      {children}
    </span>
  );
}

export function Card({ children, className, padded = true }: { children: ReactNode; className?: string; padded?: boolean }) {
  return <section className={cx('card', padded && 'p-5', className)}>{children}</section>;
}

export function SectionTitle({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-white">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] leading-relaxed text-slate-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, description, actions, eyebrow }: { title: string; description?: ReactNode; actions?: ReactNode; eyebrow?: string }) {
  return (
    <header className="mb-7 flex items-end justify-between gap-6">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
        <h1 className="text-[28px] font-bold leading-tight tracking-[-0.015em] text-white">{title}</h1>
        {description && <p className="mt-1.5 max-w-[68ch] text-sm leading-relaxed text-slate-400">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

export function ProgressBar({ percent, tone = 'orange', className }: { percent: number | null; tone?: 'orange' | 'teal' | 'danger' | 'success'; className?: string }) {
  const color = { orange: 'bg-accent-orange', teal: 'bg-accent-teal', danger: 'bg-status-danger', success: 'bg-status-success' }[tone];
  return (
    <div className={cx('relative h-1.5 overflow-hidden rounded-full bg-white/[0.06]', className)}>
      {percent == null ? (
        <div className={cx('absolute inset-y-0 w-1/3 animate-[indeterminate_1.4s_ease-in-out_infinite] rounded-full', color)} />
      ) : (
        <div className={cx('h-full rounded-full transition-[width] duration-500 ease-out', color)} style={{ width: `${Math.max(2, Math.min(100, percent))}%` }} />
      )}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('h-4 w-4 animate-spin text-slate-500', className)} />;
}

export function EmptyState({ icon: Icon, title, description, action }: { icon: LucideIcon; title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-bg-elevated">
        <Icon className="h-5 w-5 text-slate-400" />
      </div>
      <p className="text-sm font-semibold text-white">{title}</p>
      {description && <p className="mt-1 max-w-[44ch] text-[13px] leading-relaxed text-slate-500">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string; icon?: LucideIcon; count?: number }>;
  className?: string;
}) {
  return (
    <div className={cx('inline-flex rounded-lg border border-border-subtle bg-bg-base p-0.5', className)} role="tablist">
      {options.map((option) => {
        const Icon = option.icon;
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cx(
              'inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium transition-colors',
              active ? 'bg-bg-elevated text-white shadow-[inset_0_0_0_1px_#253248]' : 'text-slate-400 hover:text-white',
            )}
          >
            {Icon && <Icon className={cx('h-3.5 w-3.5', active && 'text-accent-orange')} />}
            {option.label}
            {option.count !== undefined && <span className="font-mono text-[11px] text-slate-500">{option.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  label,
  icon: Icon,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string }>;
  label: string;
  icon?: LucideIcon;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const current = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, options.findIndex((option) => option.value === value)));
    const onDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const pick = (next: T) => {
    onChange(next);
    setOpen(false);
  };

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === 'Escape') return setOpen(false);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) return setOpen(true);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((index) => (index + step + options.length) % options.length);
    }
    if ((event.key === 'Enter' || event.key === ' ') && open) {
      event.preventDefault();
      pick(options[active].value);
    }
  };

  return (
    <div ref={root} className={cx('relative', className)} onKeyDown={onKeyDown}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((value) => !value)}
        className={cx(
          'inline-flex h-9 w-full items-center gap-2 rounded-lg border bg-bg-base px-3 text-[13px] font-medium text-slate-200 transition-colors',
          open ? 'border-accent-orange/60' : 'border-border-subtle hover:border-border-strong',
        )}
      >
        {Icon && <Icon className="h-3.5 w-3.5 text-slate-500" />}
        <span className="flex-1 truncate text-left">{current?.label}</span>
        <ChevronDown className={cx('h-3.5 w-3.5 text-slate-500 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <ul role="listbox" aria-label={label} className="absolute right-0 z-30 mt-1.5 min-w-full overflow-hidden rounded-lg border border-border bg-bg-elevated p-1 shadow-xl shadow-black/40">
          {options.map((option, index) => {
            const selected = option.value === value;
            return (
              <li
                key={option.value}
                role="option"
                aria-selected={selected}
                onMouseEnter={() => setActive(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pick(option.value)}
                className={cx(
                  'flex cursor-pointer items-center gap-2 whitespace-nowrap rounded-md px-2.5 py-2 text-[13px]',
                  index === active ? 'bg-bg-hover text-white' : 'text-slate-300',
                )}
              >
                <span className="flex-1">{option.label}</span>
                {selected && <Check className="h-3.5 w-3.5 text-accent-orange" />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function Toggle({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (value: boolean) => void; label: string; description?: ReactNode; disabled?: boolean }) {
  return (
    <label className={cx('flex cursor-pointer items-start justify-between gap-6 py-3', disabled && 'cursor-not-allowed opacity-50')}>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-white">{label}</span>
        {description && <span className="mt-0.5 block text-[13px] leading-relaxed text-slate-500">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx('relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors', checked ? 'bg-accent-orange' : 'bg-border-strong')}
      >
        <span className={cx('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-[left]', checked ? 'left-[18px]' : 'left-0.5')} />
      </button>
    </label>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1.5 block text-[13px] font-medium text-slate-300">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs leading-relaxed text-slate-500">{hint}</span>}
    </label>
  );
}

export function Drawer({ open, onClose, title, subtitle, children, footer, width = 560 }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; width?: number }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 top-11 z-50 flex justify-end">
      <div className="absolute inset-0 animate-fade-in bg-black/50 backdrop-blur-[2px]" onClick={onClose} />
      <aside className="relative flex h-full animate-slide-in flex-col border-l border-border bg-bg-surface shadow-panel" style={{ width: `min(${width}px, 92vw)` }}>
        <header className="flex items-start justify-between gap-4 border-b border-border-subtle px-6 py-5">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold text-white">{title}</h2>
            {subtitle && <div className="mt-1 text-[13px] text-slate-500">{subtitle}</div>}
          </div>
          <IconButton icon={X} label="Close" onClick={onClose} />
        </header>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <footer className="flex flex-wrap items-center gap-2 border-t border-border-subtle px-6 py-4">{footer}</footer>}
      </aside>
    </div>
  );
}

export function StatTile({ label, value, sub, icon: Icon, accent }: { label: string; value: ReactNode; sub?: ReactNode; icon?: LucideIcon; accent?: boolean }) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between">
        <p className="eyebrow">{label}</p>
        {Icon && <Icon className={cx('h-4 w-4', accent ? 'text-accent-orange' : 'text-slate-600')} />}
      </div>
      <p className={cx('mt-2 font-mono text-2xl font-bold tracking-tight', accent ? 'text-accent-orange' : 'text-white')}>{value}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cx('relative overflow-hidden rounded-lg bg-white/[0.04]', className)}>
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/[0.04] to-transparent" />
    </div>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-status-danger-border bg-status-danger-bg px-4 py-3 text-sm text-status-danger">
      <span className="min-w-0 break-words">{message}</span>
      {onRetry && (
        <Button size="sm" variant="ghost" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-border bg-bg-base px-1.5 py-0.5 font-mono text-[10px] text-slate-400">{children}</kbd>;
}
