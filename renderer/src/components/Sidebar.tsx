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
        'group flex h-[30px] w-full items-center gap-2.5 rounded-[5px] px-2 text-[13px] transition-colors',
        active ? 'bg-white/[0.08] text-white' : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100',
      )}
    >
      <Icon className={cx('h-[15px] w-[15px] shrink-0', active ? 'text-zinc-200' : 'text-zinc-500 group-hover:text-zinc-300')} />
      <span className="flex-1 text-left">{item.label}</span>
      {item.badge ? <span className="font-mono text-[11px] text-accent-orange">{item.badge}</span> : null}
    </button>
  );
}

function Group({ label, items }: { label?: string; items: NavItem[] }) {
  return (
    <div className="space-y-px">
      {label && <p className="px-2 pb-1 pt-4 text-[11px] text-zinc-600">{label}</p>}
      {items.map((item) => (
        <NavButton key={item.route} item={item} />
      ))}
    </div>
  );
}

function UsageMeter() {
  const { data } = useAccount();
  if (!data) return null;
  const nearJobs = !!data.limits.maxJobsPerDay && data.usage.jobs / data.limits.maxJobsPerDay > 0.85;
  const nearBytes = !!data.limits.maxBytesPerDay && data.usage.bytes / data.limits.maxBytesPerDay > 0.85;
  return (
    <div className="space-y-0.5 px-2 pb-2 font-mono text-[11px] text-zinc-500">
      <p className={cx(nearJobs && 'text-status-warning')}>
        {data.usage.jobs}/{data.limits.maxJobsPerDay} jobs today
      </p>
      <p className={cx(nearBytes && 'text-status-warning')}>
        {formatBytes(data.usage.bytes)} of {formatBytes(data.limits.maxBytesPerDay)}
      </p>
    </div>
  );
}

function AccountCard() {
  const { data } = useAccount();
  const { navigate } = useRouter();
  const name = data?.username ?? 'Your account';
  return (
    <button onClick={() => navigate('settings')} className="flex w-full items-center gap-2.5 rounded-[5px] px-2 py-1.5 text-left transition-colors hover:bg-white/[0.04]">
      {data?.avatar ? (
        <img src={data.avatar} alt="" className="h-6 w-6 rounded-full" />
      ) : (
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-bg-hover text-[11px] font-semibold text-zinc-300">{name.slice(0, 1).toUpperCase()}</div>
      )}
      <p className="min-w-0 flex-1 truncate text-[13px] text-zinc-200">{name}</p>
    </button>
  );
}

export function Sidebar({ activeCount }: { activeCount: number }) {
  return (
    <nav className="flex w-[200px] shrink-0 flex-col border-r border-border-subtle bg-[#0d0d0e] px-2 pb-2 pt-2" aria-label="Primary">
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
