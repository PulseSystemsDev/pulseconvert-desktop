import { useCallback, useEffect, useRef, useState } from 'react';
import { pc, type AuthStatus, type DesktopSettings, type Task, type UpdateState } from './bridge';

export interface ApiState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/** GET a Pulse Convert endpoint through the main process, optionally polling. Keeps the last
 *  good data on screen while a refresh is in flight so lists don't flash empty. */
export function useApi<T>(path: string | null, options: { poll?: number } = {}): ApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(path !== null);
  const [nonce, setNonce] = useState(0);
  const pathRef = useRef(path);
  pathRef.current = path;

  useEffect(() => {
    if (!path) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = async (initial: boolean) => {
      if (initial) setLoading(true);
      const result = await pc.api<T>({ method: 'GET', path });
      if (cancelled || pathRef.current !== path) return;
      if (result.ok) {
        setData(result.data);
        setError(null);
      } else {
        setError(result.error);
      }
      setLoading(false);
      if (options.poll) timer = setTimeout(() => void load(false), options.poll);
    };
    void load(true);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [path, nonce, options.poll]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);
  return { data, error, loading, reload };
}

export function useTasks(): Task[] {
  const [tasks, setTasks] = useState<Task[]>([]);
  useEffect(() => {
    let alive = true;
    void pc.getTasks().then((initial) => alive && setTasks(initial));
    const stop = pc.onTasks(setTasks);
    return () => {
      alive = false;
      stop();
    };
  }, []);
  return tasks;
}

export function useAuth(): AuthStatus | null {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  useEffect(() => {
    let alive = true;
    void pc.getAuthStatus().then((initial) => alive && setStatus(initial));
    const stop = pc.onAuthStatus(setStatus);
    return () => {
      alive = false;
      stop();
    };
  }, []);
  return status;
}

export function useSettings(): [DesktopSettings | null, (next: DesktopSettings) => void, () => void] {
  const [settings, setSettings] = useState<DesktopSettings | null>(null);
  const reload = useCallback(() => void pc.getSettings().then(setSettings), []);
  useEffect(reload, [reload]);
  return [settings, setSettings, reload];
}

export function useUpdateState(): UpdateState {
  const [state, setState] = useState<UpdateState>({ state: 'idle' });
  useEffect(() => {
    void pc.getUpdateState().then(setState);
    return pc.onUpdateState(setState);
  }, []);
  return state;
}

export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** Re-renders on an interval so relative times ("3m ago") stay honest. */
export function useNow(interval = 30_000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(timer);
  }, [interval]);
  return now;
}
