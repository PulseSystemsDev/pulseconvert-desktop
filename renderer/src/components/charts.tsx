import { useEffect, useRef, useState, type ReactNode } from 'react';

// Validated with the dataviz palette checker against the card surface (#161618): both inside the
// lightness band, CVD separation 10.9, normal-vision 26.1. Keep these two as a pair.
export const CHART_COLORS = { done: '#11a090', failed: '#e0654f', line: '#f07b3f' };
const SURFACE = '#161618';
const GRID = '#232326';

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

function niceMax(value: number): number {
  if (value <= 4) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (step * magnitude >= value) return step * magnitude;
  }
  return 10 * magnitude;
}

function Tooltip({ x, y, children, width }: { x: number; y: number; children: ReactNode; width: number }) {
  const left = Math.min(Math.max(x, 70), width - 70);
  return (
    <div
      className="pointer-events-none absolute z-10 min-w-[128px] -translate-x-1/2 -translate-y-full rounded-[5px] border border-border bg-bg-elevated px-3 py-2 text-xs shadow-panel"
      style={{ left, top: y - 10 }}
    >
      {children}
    </div>
  );
}

function Swatch({ color, line }: { color: string; line?: boolean }) {
  return line ? <span className="inline-block h-0.5 w-3 rounded-full" style={{ background: color }} /> : <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color }} />;
}

export function Legend({ items }: { items: Array<{ label: string; color: string; line?: boolean }> }) {
  return (
    <div className="flex items-center gap-4 text-xs text-zinc-400">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5">
          <Swatch color={item.color} line={item.line} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

function topRoundedRect(x: number, y: number, w: number, h: number, r: number): string {
  const radius = Math.min(r, w / 2, h);
  return `M${x},${y + h} V${y + radius} Q${x},${y} ${x + radius},${y} H${x + w - radius} Q${x + w},${y} ${x + w},${y + radius} V${y + h} Z`;
}

export interface DayPoint {
  day: string;
  done: number;
  failed: number;
}

const dayLabel = (day: string, style: 'short' | 'long' = 'short') =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, style === 'short' ? { month: 'short', day: 'numeric', timeZone: 'UTC' } : { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

export function DailyBars({ days, height = 220 }: { days: DayPoint[]; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const padLeft = 40;
  const padBottom = 24;
  const padTop = 8;
  const plotW = Math.max(0, width - padLeft);
  const plotH = height - padBottom - padTop;
  const max = niceMax(Math.max(1, ...days.map((day) => day.done + day.failed)));
  const slot = days.length ? plotW / days.length : 0;
  const barW = Math.max(2, Math.min(24, slot - 2));
  const y = (value: number) => padTop + plotH - (value / max) * plotH;
  const ticks = [0, max / 4, max / 2, (max * 3) / 4, max];

  return (
    <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={`Jobs finished and failed per day over the last ${days.length} days`}>
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={padLeft} x2={width} y1={y(tick)} y2={y(tick)} stroke={GRID} strokeWidth={1} />
              <text x={padLeft - 8} y={y(tick)} dy="0.32em" textAnchor="end" className="fill-zinc-500 font-mono text-[10px]">
                {Math.round(tick).toLocaleString()}
              </text>
            </g>
          ))}
          {days.map((day, index) => {
            const x = padLeft + index * slot + (slot - barW) / 2;
            const doneTop = y(day.done);
            const failedTop = y(day.done + day.failed);
            const baseline = y(0);
            const faded = hover !== null && hover !== index;
            return (
              <g key={day.day} opacity={faded ? 0.45 : 1}>
                {day.done > 0 && <path d={day.failed > 0 ? `M${x},${baseline} V${doneTop} H${x + barW} V${baseline} Z` : topRoundedRect(x, doneTop, barW, baseline - doneTop, 4)} fill={CHART_COLORS.done} />}
                {day.failed > 0 && <path d={topRoundedRect(x, failedTop, barW, Math.max(0, doneTop - failedTop - (day.done > 0 ? 2 : 0)), 4)} fill={CHART_COLORS.failed} />}
                {index % 5 === (days.length - 1) % 5 && (
                  <text x={index === days.length - 1 ? x + barW : x + barW / 2} y={height - 6} textAnchor={index === days.length - 1 ? 'end' : 'middle'} className="fill-zinc-500 text-[10px]">
                    {dayLabel(day.day)}
                  </text>
                )}
                <rect x={padLeft + index * slot} y={padTop} width={slot} height={plotH} fill="transparent" onMouseEnter={() => setHover(index)} />
              </g>
            );
          })}
        </svg>
      )}
      {hover !== null && days[hover] && (
        <Tooltip x={padLeft + hover * slot + slot / 2} y={y(days[hover].done + days[hover].failed)} width={width}>
          <p className="mb-1 font-semibold text-white">{dayLabel(days[hover].day, 'long')}</p>
          <p className="flex items-center justify-between gap-4 text-zinc-300">
            <span className="flex items-center gap-1.5">
              <Swatch color={CHART_COLORS.done} /> Finished
            </span>
            <span className="font-mono text-white">{days[hover].done.toLocaleString()}</span>
          </p>
          <p className="flex items-center justify-between gap-4 text-zinc-300">
            <span className="flex items-center gap-1.5">
              <Swatch color={CHART_COLORS.failed} /> Failed
            </span>
            <span className="font-mono text-white">{days[hover].failed.toLocaleString()}</span>
          </p>
        </Tooltip>
      )}
    </div>
  );
}

export interface SamplePoint {
  at: number;
  value: number;
}

export function Sparkline({ points, height = 120, unit }: { points: SamplePoint[]; height?: number; unit: (value: number) => string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const padY = 10;
  const padRight = 10;
  const plotW = Math.max(0, width - padRight);
  const max = niceMax(Math.max(1, ...points.map((point) => point.value)));
  const x = (index: number) => (points.length <= 1 ? plotW : (index / (points.length - 1)) * plotW);
  const y = (value: number) => padY + (height - padY * 2) * (1 - value / max);
  const line = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index)},${y(point.value)}`).join(' ');
  const area = points.length ? `${line} L${x(points.length - 1)},${height - padY} L${x(0)},${height - padY} Z` : '';
  const last = points[points.length - 1];

  return (
    <div
      ref={ref}
      className="relative"
      onMouseMove={(event) => {
        if (points.length < 2) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const index = Math.round(((event.clientX - rect.left) / plotW) * (points.length - 1));
        setHover(Math.max(0, Math.min(points.length - 1, index)));
      }}
      onMouseLeave={() => setHover(null)}
    >
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="Jobs active or queued, sampled while this page is open">
          <line x1={0} x2={plotW} y1={height - padY} y2={height - padY} stroke={GRID} strokeWidth={1} />
          {points.length > 1 && (
            <>
              <defs>
                <linearGradient id="spark-wash" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor={CHART_COLORS.line} stopOpacity={0.12} />
                  <stop offset="1" stopColor={CHART_COLORS.line} stopOpacity={0} />
                </linearGradient>
              </defs>
              <path d={area} fill="url(#spark-wash)" />
              <path d={line} fill="none" stroke={CHART_COLORS.line} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            </>
          )}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={padY} y2={height - padY} stroke="#3b3b41" strokeWidth={1} />}
          {last && (
            <circle cx={x(hover ?? points.length - 1)} cy={y(points[hover ?? points.length - 1].value)} r={4} fill={CHART_COLORS.line} stroke={SURFACE} strokeWidth={2} />
          )}
        </svg>
      )}
      {hover !== null && points[hover] && (
        <Tooltip x={x(hover)} y={y(points[hover].value)} width={width}>
          <p className="text-zinc-400">{new Date(points[hover].at).toLocaleTimeString()}</p>
          <p className="font-mono font-semibold text-white">{unit(points[hover].value)}</p>
        </Tooltip>
      )}
    </div>
  );
}

export function RankedBars({ rows, color = CHART_COLORS.done }: { rows: Array<{ label: string; value: number }>; color?: string }) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={row.label} className="grid grid-cols-[110px_minmax(0,1fr)_56px] items-center gap-3 text-[13px]">
          <span className="truncate text-zinc-400">{row.label}</span>
          <span className="h-3 overflow-hidden">
            <span className="block h-full rounded-r" style={{ width: `${Math.max(1, (row.value / max) * 100)}%`, background: color }} />
          </span>
          <span className="text-right font-mono text-white">{row.value.toLocaleString()}</span>
        </li>
      ))}
    </ul>
  );
}
