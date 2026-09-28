import {
  BarChart3,
  Gauge,
  Home,
  Images,
  LayoutGrid,
  ListOrdered,
  ListTodo,
  RefreshCw,
  Rocket,
  Settings,
  ShieldCheck,
  Wrench,
  Hammer,
  type LucideIcon,
} from 'lucide-react';
import { useAccount } from '../lib/account';
import { cx, formatBytes } from '../lib/format';
import { useRouter, type Route } from '../lib/router';

interface NavItem {
  route: Route;
  label: string;
  icon: LucideIcon;
  badge?: number;
}

function NavButton({ item }: { item: NavItem }) {
  const { route, navigate } = useRouter();
  const active = route === item.route;
  const Icon = item.icon;
  return (
    <button
      onClick={() => navigate(item.route)}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'group relative flex h-9 w-full items-center gap-3 rounded-lg px-3 text-[13px] font-medium transition-colors',
        active ? 'bg-white/[0.06] text-white' : 'text-slate-400 hover:bg-white/[0.03] hover:text-white',
      )}
    >
      {active && <span className="absolute left-0 top-2 h-5 w-[3px] rounded-r-full bg-accent-orange" />}
      <Icon className={cx('h-4 w-4 shrink-0', active ? 'text-accent-orange' : 'text-slate-500 group-hover:text-slate-300')} />
      <span className="flex-1 text-left">{item.label}</span>
      {item.badge ? <span className="rounded-full bg-accent-orange px-1.5 font-mono text-[10px] font-bold leading-4 text-bg-base">{item.badge}</span> : null}
    </button>
  );
}

function Group({ label, items }: { label?: string; items: NavItem[] }) {
  return (
    <div className="space-y-0.5">
      {label && <p className="eyebrow px-3 pb-1.5 pt-4">{label}</p>}
      {items.map((item) => (
        <NavButton key={item.route} item={item} />
      ))}
    </div>
  );
}

function UsageMeter() {
  const { data } = useAccount();
  if (!data) return null;
  const jobsPct = data.limits.maxJobsPerDay ? Math.min(100, (data.usage.jobs / data.limits.maxJobsPerDay) * 100) : 0;
  const bytesPct = data.limits.maxBytesPerDay ? Math.min(100, (data.usage.bytes / data.limits.maxBytesPerDay) * 100) : 0;
  return (
    <div className="mx-1 mb-3 rounded-lg border border-border-subtle bg-bg-base/60 p-3">
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-semibold text-slate-400">Today</span>
        <span className="font-mono text-slate-500">
          {data.usage.jobs}/{data.limits.maxJobsPerDay} jobs
        </span>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.06]">
        <div className={cx('h-full rounded-full', jobsPct > 85 ? 'bg-status-warning' : 'bg-accent-orange')} style={{ width: `${jobsPct}%` }} />
      </div>
      <div className="mt-2.5 flex items-center justify-between text-[11px]">
        <span className="text-slate-500">Data</span>
        <span className="font-mono text-slate-500">
          {formatBytes(data.usage.bytes)} / {formatBytes(data.limits.maxBytesPerDay)}
        </span>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.06]">
        <div className={cx('h-full rounded-full', bytesPct > 85 ? 'bg-status-warning' : 'bg-accent-teal')} style={{ width: `${bytesPct}%` }} />
      </div>
    </div>
  );
}

function AccountCard() {
  const { data } = useAccount();
  const { navigate } = useRouter();
  const name = data?.username ?? 'Your account';
  return (
    <button onClick={() => navigate('settings')} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-white/[0.04]">
      {data?.avatar ? (
        <img src={data.avatar} alt="" className="h-8 w-8 rounded-full" />
      ) : (
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-orange-dim text-xs font-bold text-accent-orange">{name.slice(0, 1).toUpperCase()}</div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-white">{name}</p>
        <p className="flex items-center gap-1 text-[11px] text-slate-500">
          <ShieldCheck className="h-3 w-3 text-status-success" /> Signed in
        </p>
      </div>
    </button>
  );
}

export function Sidebar({ activeCount }: { activeCount: number }) {
  return (
    <nav className="flex w-[232px] shrink-0 flex-col border-r border-border-subtle bg-bg-base px-3 pb-3 pt-3" aria-label="Primary">
      <div className="flex-1 overflow-y-auto">
        <Group items={[{ route: 'home', label: 'Home', icon: Home }]} />
        <Group
          label="Create"
          items={[
            { route: 'convert', label: 'Convert', icon: RefreshCw },
            { route: 'optimize', label: 'Optimize', icon: Gauge },
            { route: 'fix', label: 'Fix resource', icon: Hammer },
          ]}
        />
        <Group
          label="Browse"
          items={[
            { route: 'catalog', label: 'Catalog', icon: LayoutGrid },
            { route: 'gallery', label: 'Gallery', icon: Images },
          ]}
        />
        <Group
          label="Track"
          items={[
            { route: 'jobs', label: 'Jobs', icon: ListTodo, badge: activeCount },
            { route: 'queue', label: 'Server queue', icon: ListOrdered },
            { route: 'stats', label: 'Live stats', icon: BarChart3 },
          ]}
        />
        <Group
          label="Server"
          items={[
            { route: 'tools', label: 'Tools', icon: Wrench },
            { route: 'deploy', label: 'Deploy', icon: Rocket },
            { route: 'settings', label: 'Settings', icon: Settings },
          ]}
        />
      </div>
      <UsageMeter />
      <div className="border-t border-border-subtle pt-2">
        <AccountCard />
      </div>
    </nav>
  );
}
