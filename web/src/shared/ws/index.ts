import { useEffect, useState } from 'react';
import { useAuthStore } from '@/shared/store/auth';
import { refreshAccessToken } from '@/shared/api/client';
import { WsClient, type WsStatus } from './client';
import type { ServerEvents } from './events';

export * from './client';
export * from './events';

/** Secondes restantes avant l'expiration d'un JWT (exp), null si illisible. */
export function jwtSecondsLeft(token: string, now = Date.now()): number | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    const exp = (JSON.parse(json) as { exp?: number }).exp;
    return typeof exp === 'number' ? exp - now / 1000 : null;
  } catch {
    return null;
  }
}

/** Instance unique partagée par toute l'application. Le token est renouvelé s'il expire
 * dans moins de 30 s ou s'il vient d'être refusé (sinon la reconnexion après une mise en
 * veille de plus de 15 min réessayait sans fin avec un token périmé). */
export const ws = new WsClient(async ({ force }) => {
  const s = useAuthStore.getState();
  if (s.accessToken && !force) {
    const left = jwtSecondsLeft(s.accessToken);
    if (left === null || left > 30) return s.accessToken;
  }
  if (!s.refreshToken) return s.accessToken;
  return refreshAccessToken();
});

/** Ouvre la connexion tant qu'un utilisateur est connecté. Le simple renouvellement de
 * l'access token ne rouvre pas la socket (le serveur n'authentifie qu'à la connexion) ;
 * un changement d'utilisateur ou de mode, si. */
export function useWsConnection() {
  const signedIn = useAuthStore((s) => Boolean(s.accessToken || s.refreshToken));
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const role = useAuthStore((s) => s.user?.role ?? null);
  useEffect(() => {
    if (!signedIn) {
      ws.close();
      return;
    }
    ws.restart();
  }, [signedIn, userId, role]);
  useEffect(() => () => ws.close(), []);
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
