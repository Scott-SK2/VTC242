import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { useState } from 'react';
import { router } from './router';
import { Toasts } from '@/shared/ui/Toasts';
import { isApiError } from '@/shared/api/client';

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
  return (
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
      <Toasts />
    </QueryClientProvider>
  );
}
