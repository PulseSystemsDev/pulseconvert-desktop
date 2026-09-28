import { FolderOpen, Rocket, X } from 'lucide-react';
import { pc, type Task } from '../lib/bridge';
import { cx, formatBytes, formatDuration, timeAgo } from '../lib/format';
import { Badge, IconButton, ProgressBar } from './ui';
import { KIND_ICON, PHASE_LABEL, isActive, phaseIcon, phaseTone } from './taskMeta';

export function TaskRow({ task, compact, onOpen }: { task: Task; compact?: boolean; onOpen?: (task: Task) => void }) {
  const KindIcon = KIND_ICON[task.kind];
  const PhaseIcon = phaseIcon(task.phase);
  const active = isActive(task);
  const tone = phaseTone(task.phase);

  return (
    <div
      className={cx('group rounded-xl border border-border-subtle bg-bg-base/60 transition-colors hover:border-border', compact ? 'p-3' : 'p-4', onOpen && 'cursor-pointer')}
      onClick={() => onOpen?.(task)}
    >
      <div className="flex items-start gap-3">
        <div className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border', active ? 'border-accent-orange/30 bg-accent-orange-dim text-accent-orange' : 'border-border bg-bg-elevated text-slate-400')}>
          <KindIcon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-sm font-semibold text-white" title={task.title}>
              {task.title}
            </p>
            <Badge tone={tone} icon={PhaseIcon} className={active ? '[&>svg]:animate-spin' : undefined}>
              {PHASE_LABEL[task.phase]}
            </Badge>
          </div>
          <p className={cx('mt-0.5 truncate text-xs', task.phase === 'failed' ? 'text-status-danger' : 'text-slate-500')} title={task.label}>
            {task.subtitle && !active && task.phase !== 'failed' ? `${task.subtitle} · ` : ''}
            {task.label}
            {task.etaMs && task.phase === 'queued' ? ` · about ${formatDuration(task.etaMs)}` : ''}
          </p>
          {active && <ProgressBar percent={task.percent} className="mt-2.5" />}
          {!active && !compact && (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
              {task.outputSizeBytes ? <span className="font-mono">{formatBytes(task.outputSizeBytes)}</span> : null}
              {task.fixLog.length > 0 && <span>{task.fixLog.length} fixes applied</span>}
              {task.deploy?.deployed && <span className="text-accent-teal">Deployed to {task.deploy.destination}</span>}
              {task.deploy && !task.deploy.deployed && task.deploy.mode !== 'none' && <span className="text-status-warning">Deploy failed: {task.deploy.error}</span>}
              {task.origin === 'dashboard' && <span>From the dashboard</span>}
              <span>{timeAgo(task.finishedAt ?? task.createdAt)}</span>
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center" onClick={(event) => event.stopPropagation()}>
          {task.outputPath && task.phase === 'done' && (
            <>
              <IconButton icon={FolderOpen} label="Show in folder" onClick={() => pc.showInFolder(task.outputPath!)} />
              {task.kind !== 'deploy' && !compact && <IconButton icon={Rocket} label="Deploy" onClick={() => pc.deployOutput(task.outputPath!)} />}
            </>
          )}
          {active ? (
            <IconButton icon={X} label={task.jobId ? 'Stop tracking (the server keeps going)' : 'Cancel'} onClick={() => pc.cancelTask(task.id)} />
          ) : (
            <IconButton icon={X} label="Dismiss" className="opacity-0 group-hover:opacity-100" onClick={() => pc.dismissTask(task.id)} />
          )}
        </div>
      </div>
    </div>
  );
}
