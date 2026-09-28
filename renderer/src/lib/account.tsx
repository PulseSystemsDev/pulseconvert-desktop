import { createContext, useContext, type ReactNode } from 'react';
import { useApi, type ApiState } from './hooks';

export interface AccountInfo {
  id: string;
  username: string | null;
  avatar: string | null;
  firstLogin: string | null;
  stats: { totalJobs: number; doneJobs: number; failedJobs: number; totalInputBytes: number; totalOutputBytes: number };
  usage: { jobs: number; bytes: number };
  limits: { maxJobsPerDay: number; maxBytesPerDay: number; conversionsEnabled: boolean };
  dmNotificationsEnabled: boolean;
  devices: Array<{ id: string; name: string; platform: string | null; lastSeenAt: string }>;
}

const AccountContext = createContext<ApiState<AccountInfo> | null>(null);

export function AccountProvider({ children }: { children: ReactNode }) {
  const state = useApi<AccountInfo>('/api/account', { poll: 60_000 });
  return <AccountContext.Provider value={state}>{children}</AccountContext.Provider>;
}

export function useAccount(): ApiState<AccountInfo> {
  const value = useContext(AccountContext);
  if (!value) throw new Error('useAccount outside AccountProvider');
  return value;
}
