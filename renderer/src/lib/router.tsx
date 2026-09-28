import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export type Route =
  | 'home'
  | 'convert'
  | 'optimize'
  | 'fix'
  | 'catalog'
  | 'gallery'
  | 'jobs'
  | 'queue'
  | 'stats'
  | 'tools'
  | 'deploy'
  | 'settings';

export interface RouteState {
  route: Route;
  params: Record<string, string>;
}

interface RouterValue extends RouteState {
  navigate: (route: Route, params?: Record<string, string>) => void;
}

const RouterContext = createContext<RouterValue | null>(null);

export function RouterProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<RouteState>({ route: 'home', params: {} });
  const navigate = useCallback((route: Route, params: Record<string, string> = {}) => setState({ route, params }), []);
  const value = useMemo(() => ({ ...state, navigate }), [state, navigate]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterValue {
  const value = useContext(RouterContext);
  if (!value) throw new Error('useRouter outside RouterProvider');
  return value;
}
