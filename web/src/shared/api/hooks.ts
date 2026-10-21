import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { ridesApi, walletApi } from './endpoints';
import type { Message, Ride, Wallet } from './types';
import { useWsEvent } from '@/shared/ws';

export const qk = {
  ride: (id: string) => ['ride', id] as const,
  activeRide: ['rides', 'active'] as const,
  rides: (status?: string) => ['rides', 'list', status ?? ''] as const,
  wallet: ['wallet'] as const,
  transactions: ['wallet', 'transactions'] as const,
  messages: (id: string) => ['messages', id] as const,
  driverMe: ['driver', 'me'] as const,
  vehicles: ['driver', 'vehicles'] as const,
  documents: ['driver', 'documents'] as const,
};

/** Course suivie en temps réel : REST + `ride.status_updated`, rejoue GET /rides/{id} à la reconnexion. */
export function useRide(id: string | undefined) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: qk.ride(id ?? ''),
    queryFn: () => ridesApi.get(id as string),
    enabled: !!id,
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === 'dispatching' || s === 'requested' ? 5000 : false;
    },
  });
  useWsEvent('ride.status_updated', (ride) => {
    if (ride.id === id) {
      qc.setQueryData<Ride>(qk.ride(ride.id), (old) => ({ ...(old ?? ride), ...ride }));
      void qc.invalidateQueries({ queryKey: qk.activeRide });
    }
  });
  useWsEvent('ride.cancelled', (d) => {
    if (d.ride_id === id) void qc.invalidateQueries({ queryKey: qk.ride(d.ride_id) });
  });
  useWsEvent('ws.open', ({ reconnected }) => {
    if (reconnected && id) void qc.invalidateQueries({ queryKey: qk.ride(id) });
  });
  const patch = useCallback(
    (partial: Partial<Ride>) => {
      if (!id) return;
      qc.setQueryData<Ride>(qk.ride(id), (old) => (old ? { ...old, ...partial } : old));
    },
    [qc, id],
  );
  return { ...query, patch };
}

export function useActiveRide(enabled = true) {
  const qc = useQueryClient();
  // Une erreur (réseau, 5xx) ne doit jamais être interprétée comme « aucune course » : on
  // réessaie toutes les 10 s, et on revérifie régulièrement même sans course connue (course
  // acceptée depuis un autre appareil, session restaurée, panne passagère de l'API).
  const q = useQuery({
    queryKey: qk.activeRide,
    queryFn: ridesApi.active,
    enabled,
    staleTime: 5000,
    retry: 3,
    retryDelay: (n) => Math.min(1000 * 2 ** n, 8000),
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: (query) => (query.state.status === 'error' ? 10_000 : query.state.data ? false : 60_000),
  });
  useWsEvent('ride.status_updated', (ride) => {
    qc.setQueryData<Ride | null>(qk.activeRide, (old) => {
      const active = ['requested', 'dispatching', 'accepted', 'arrived', 'in_progress'].includes(ride.status);
      if (!active) return old?.id === ride.id ? null : (old ?? null);
      return ride;
    });
    qc.setQueryData<Ride>(qk.ride(ride.id), (old) => ({ ...(old ?? ride), ...ride }));
  });
  useWsEvent('ws.open', ({ reconnected }) => {
    if (reconnected) void qc.invalidateQueries({ queryKey: qk.activeRide });
  });
  return q;
}

export function useWallet(enabled = true) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: qk.wallet, queryFn: walletApi.get, enabled });
  useWsEvent('wallet.updated', (w) => {
    qc.setQueryData<Wallet>(qk.wallet, (old) => (old ? { ...old, ...w } : old));
    void qc.invalidateQueries({ queryKey: qk.transactions });
  });
  return q;
}

export function useMessages(rideId: string | undefined) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: qk.messages(rideId ?? ''),
    queryFn: async () => (await ridesApi.messages(rideId as string)).results,
    enabled: !!rideId,
  });
  useWsEvent('chat.message', (m) => {
    if (m.ride_id !== rideId) return;
    qc.setQueryData<Message[]>(qk.messages(m.ride_id), (old) => {
      const list = old ?? [];
      return list.some((x) => x.id === m.id) ? list : [...list, m];
    });
  });
  const append = (m: Message) =>
    qc.setQueryData<Message[]>(qk.messages(m.ride_id), (old) =>
      (old ?? []).some((x) => x.id === m.id) ? old : [...(old ?? []), m],
    );
  return { ...q, append };
}
