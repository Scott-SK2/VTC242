import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { router } from './router';
import { Toasts } from '@/shared/ui/Toasts';
import { isApiError } from '@/shared/api/client';
import { useAuthStore } from '@/shared/store/auth';

/** Clé de session : utilisateur + mode actif. */
const sessionKey = (s: ReturnType<typeof useAuthStore.getState>) =>
  s.user ? `${s.user.id}:${s.user.role}` : null;

export function App() {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: (count, err) =>
              isApiError(err) && err.status >= 400 && err.status < 500 ? false : count < 2,
            staleTime: 10_000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );
  // Fin de session, changement de compte ou de mode : rien de l'ancienne session ne doit
  // rester (course active, solde en cache, positions GPS en attente d'envoi).
  useEffect(() => {
    let previous = sessionKey(useAuthStore.getState());
    return useAuthStore.subscribe((state) => {
      const next = sessionKey(state);
      if (next === previous) return;
      const hadSession = previous !== null;
      previous = next;
      if (!hadSession) return;
      client.clear();
      void import('@/features/driver/offlineQueue')
        .then((m) => m.db.positions.clear())
        .catch(() => undefined);
    });
  }, [client]);
  return (
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
      <Toasts />
    </QueryClientProvider>
  );
}
