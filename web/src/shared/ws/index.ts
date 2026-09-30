import { useEffect, useState } from 'react';
import { useAuthStore } from '@/shared/store/auth';
import { refreshAccessToken } from '@/shared/api/client';
import { WsClient, type WsStatus } from './client';
import type { ServerEvents } from './events';

export * from './client';
export * from './events';

/** Instance unique partagée par toute l'application. */
export const ws = new WsClient(async () => {
  const s = useAuthStore.getState();
  if (s.accessToken) return s.accessToken;
  return refreshAccessToken();
});

/** Ouvre la connexion tant qu'un utilisateur est connecté. */
export function useWsConnection() {
  const token = useAuthStore((s) => s.accessToken);
  const refresh = useAuthStore((s) => s.refreshToken);
  useEffect(() => {
    if (!token && !refresh) {
      ws.close();
      return;
    }
    ws.connect();
    return () => ws.close();
  }, [token, refresh]);
}

export function useWsStatus(): WsStatus {
  const [status, setStatus] = useState<WsStatus>(ws.status);
  useEffect(() => ws.onStatus(setStatus), []);
  return status;
}

/** Abonnement typé à un événement serveur ; `handler` est lu via ref pour éviter les ré-abonnements. */
export function useWsEvent<K extends keyof ServerEvents>(event: K, handler: (data: ServerEvents[K]) => void) {
  const ref = useLatest(handler);
  useEffect(() => ws.on(event, (data) => ref.current(data)), [event, ref]);
}

function useLatest<T>(value: T) {
  const [ref] = useState(() => ({ current: value }));
  ref.current = value;
  return ref;
}
