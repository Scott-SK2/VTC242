import { useEffect, useRef, useState } from 'react';
import { ws } from '@/shared/ws';
import { toFix, type GeoFix } from '@/shared/utils/geolocation';
import { distanceM } from '@/shared/utils/geo';
import { enqueuePosition, flushQueue, queuedCount } from './offlineQueue';
import { useUiStore } from '@/shared/store/ui';

const MOVING_INTERVAL = 4000; // 3–5 s en mouvement
const STILL_INTERVAL = 10000; // 10 s à l'arrêt
const STALE_AFTER = 30000; // bandeau si aucune position depuis 30 s

/**
 * Envoi de position chauffeur (F-32, F-41) : watchPosition, trame `driver.location` en WebSocket,
 * file Dexie si la connexion est absente, Wake Lock pendant la mise en ligne.
 */
export function useLocationSender(enabled: boolean, rideId: string | null) {
  const [fix, setFix] = useState<GeoFix | null>(null);
  const [stale, setStale] = useState(false);
  const [queued, setQueued] = useState(0);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const lastSentRef = useRef<{ fix: GeoFix; at: number } | null>(null);
  const lastFixAtRef = useRef<number>(Date.now());
  const rideIdRef = useRef(rideId);
  rideIdRef.current = rideId;
  const online = useUiStore((s) => s.online);

  // Wake Lock
  useEffect(() => {
    if (!enabled) return;
    let lock: WakeLockSentinel | null = null;
    const acquire = async () => {
      try {
        if ('wakeLock' in navigator && document.visibilityState === 'visible')
          lock = await navigator.wakeLock.request('screen');
      } catch {
        /* refusé */
      }
    };
    void acquire();
    const onVis = () => void acquire();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      void lock?.release();
    };
  }, [enabled]);

  // Suivi GPS et envoi
  useEffect(() => {
    if (!enabled || !('geolocation' in navigator)) return;
    lastFixAtRef.current = Date.now();
    const send = (f: GeoFix) => {
      const payload = { ...f, ...(rideIdRef.current ? { ride_id: rideIdRef.current } : {}) };
      if (ws.status === 'open' && navigator.onLine) ws.send('driver.location', payload);
      else void enqueuePosition(payload).then(() => queuedCount().then(setQueued));
      lastSentRef.current = { fix: f, at: Date.now() };
    };
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const f = toFix(p);
        if (f.accuracy_m !== null && f.accuracy_m > 100) return; // ignoré côté serveur : on n'envoie pas
        setFix(f);
        setGpsError(null);
        lastFixAtRef.current = Date.now();
        setStale(false);
        const last = lastSentRef.current;
        if (!last) return send(f);
        const moved = distanceM(last.fix, f) > 8 || (f.speed_kmh ?? 0) > 3;
        const elapsed = Date.now() - last.at;
        if ((moved && elapsed >= MOVING_INTERVAL) || elapsed >= STILL_INTERVAL) send(f);
      },
      (e) => setGpsError(e.message),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 },
    );
    const staleTimer = setInterval(() => setStale(Date.now() - lastFixAtRef.current > STALE_AFTER), 5000);
    return () => {
      navigator.geolocation.clearWatch(id);
      clearInterval(staleTimer);
      lastSentRef.current = null;
    };
  }, [enabled]);

  // Rejeu de la file au retour du réseau / de la connexion WS
  useEffect(() => {
    void queuedCount().then(setQueued);
    const flush = () => void flushQueue().then(() => queuedCount().then(setQueued));
    if (online) flush();
    const off = ws.on('ws.open', flush);
    return off;
  }, [online]);

  return { fix, stale, queued, gpsError };
}
