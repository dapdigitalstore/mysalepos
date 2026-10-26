'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createContext, useContext, useState } from 'react';
import { can, type Access } from '@/lib/can';
import { ToastProvider } from './ui/toast';

export interface SessionUser extends Access {
  id: number;
  businessId: number;
  username: string;
  firstName: string;
  lastName: string;
}

const SessionContext = createContext<SessionUser | null>(null);

export function useSession(): SessionUser {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession must be used inside <Providers>');
  return s;
}

/** `const canCreate = useCan()('unit.create')` - true when the signed-in user holds any of the permissions. */
export function useCan() {
  const s = useSession();
  return (...permissions: string[]) => permissions.some((p) => can(s, p));
}

export function Providers({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: false, retry: false } } }),
  );
  return (
    <SessionContext.Provider value={user}>
      <QueryClientProvider client={client}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    </SessionContext.Provider>
  );
}
