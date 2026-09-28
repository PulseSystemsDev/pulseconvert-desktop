import crypto from 'crypto';
import log from 'electron-log';
import config from './configStore';
import { CancelledError } from './transfer';
import type { Task, TaskKind, TaskOrigin, TaskPhase } from './types';

const FINISHED: ReadonlySet<TaskPhase> = new Set(['done', 'failed', 'cancelled']);
const MAX_KEPT_TASKS = 60;
const BROADCAST_INTERVAL_MS = 120;

export interface TaskContext {
  task: Task;
  signal: AbortSignal;
  update: (patch: Partial<Task>) => void;
  progress: (phase: TaskPhase, label: string, percent?: number | null) => void;
}

type Runner = (ctx: TaskContext) => Promise<void>;
type Listener = (tasks: Task[]) => void;
type FinishListener = (task: Task) => void;

export function isFinished(task: Task): boolean {
  return FINISHED.has(task.phase);
}

class Semaphore {
  private active = 0;
  private waiting: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async acquire(signal?: AbortSignal): Promise<() => void> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve, reject) => {
        const entry = () => {
          signal?.removeEventListener('abort', onAbort);
          resolve();
        };
        const onAbort = () => {
          this.waiting = this.waiting.filter((item) => item !== entry);
          reject(new CancelledError());
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        this.waiting.push(entry);
      });
    }
    this.active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
      this.waiting.shift()?.();
    };
  }
}

export const uploadSlots = new Semaphore(2);

export class TaskManager {
  private tasks = new Map<string, Task>();
  private controllers = new Map<string, AbortController>();
  private listeners = new Set<Listener>();
  private finishListeners = new Set<FinishListener>();
  private broadcastTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    for (const saved of config.get('taskHistory') ?? []) {
      if (saved && typeof saved.id === 'string') this.tasks.set(saved.id, saved);
    }
  }

  interruptedTasks(): Task[] {
    return this.list().filter((task) => !isFinished(task));
  }

  list(): Task[] {
    return [...this.tasks.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  get(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onFinish(listener: FinishListener): () => void {
    this.finishListeners.add(listener);
    return () => this.finishListeners.delete(listener);
  }

  create(kind: TaskKind, title: string, origin: TaskOrigin = 'app', subtitle: string | null = null): Task {
    const task: Task = {
      id: crypto.randomUUID(),
      kind,
      origin,
      title,
      subtitle,
      phase: 'waiting',
      label: 'Waiting to start',
      percent: null,
      jobId: null,
      queuePosition: null,
      etaMs: null,
      outputPath: null,
      outputSizeBytes: null,
      fixLog: [],
      deploy: null,
      error: null,
      result: null,
      createdAt: Date.now(),
      finishedAt: null,
    };
    this.tasks.set(task.id, task);
    this.prune();
    this.changed(true);
    return task;
  }

  run(task: Task, runner: Runner): Promise<Task> {
    const controller = new AbortController();
    this.controllers.set(task.id, controller);
    const ctx: TaskContext = {
      task,
      signal: controller.signal,
      update: (patch) => this.patch(task.id, patch),
      progress: (phase, label, percent = null) => this.patch(task.id, { phase, label, percent }),
    };

    return (async () => {
      try {
        await runner(ctx);
        const current = this.tasks.get(task.id);
        if (current && !isFinished(current)) this.patch(task.id, { phase: 'done', label: 'Finished', percent: 100 });
      } catch (err) {
        if (err instanceof CancelledError || controller.signal.aborted) {
          this.patch(task.id, { phase: 'cancelled', label: 'Cancelled', error: null });
        } else {
          log.warn(`[tasks] ${task.kind} ${task.id} failed`, err);
          const message = (err as Error)?.message || 'Something went wrong.';
          this.patch(task.id, { phase: 'failed', label: message, error: message });
        }
      } finally {
        this.controllers.delete(task.id);
      }
      return this.tasks.get(task.id) ?? task;
    })();
  }

  cancel(id: string): void {
    const controller = this.controllers.get(id);
    if (controller) controller.abort();
    else {
      const task = this.tasks.get(id);
      if (task && !isFinished(task)) this.patch(id, { phase: 'cancelled', label: 'Cancelled' });
    }
  }

  dismiss(id: string): void {
    const task = this.tasks.get(id);
    if (!task || !isFinished(task)) return;
    this.tasks.delete(id);
    this.changed(true);
  }

  clearFinished(): void {
    for (const task of this.tasks.values()) if (isFinished(task)) this.tasks.delete(task.id);
    this.changed(true);
  }

  cancelAll(): void {
    for (const controller of this.controllers.values()) controller.abort();
  }

  private patch(id: string, patch: Partial<Task>): void {
    const task = this.tasks.get(id);
    if (!task) return;
    const wasFinished = isFinished(task);
    Object.assign(task, patch);
    const nowFinished = isFinished(task);
    if (nowFinished && !wasFinished) {
      task.finishedAt = Date.now();
      for (const listener of this.finishListeners) {
        try {
          listener(task);
        } catch (err) {
          log.warn('[tasks] finish listener failed', err);
        }
      }
    }
    this.changed(nowFinished !== wasFinished);
  }

  private prune(): void {
    const finished = this.list().filter(isFinished);
    for (const task of finished.slice(MAX_KEPT_TASKS)) this.tasks.delete(task.id);
  }

  private changed(persist: boolean): void {
    if (persist) this.persist();
    if (this.broadcastTimer) return;
    this.broadcastTimer = setTimeout(() => {
      this.broadcastTimer = null;
      const snapshot = this.list();
      for (const listener of this.listeners) listener(snapshot);
    }, BROADCAST_INTERVAL_MS);
  }

  persist(): void {
    try {
      config.set('taskHistory', this.list().slice(0, MAX_KEPT_TASKS));
    } catch (err) {
      log.warn('[tasks] could not persist task history', err);
    }
  }
}

export const taskManager = new TaskManager();
