import { useEffect, useState } from 'react';
import type { LatLng } from '@/shared/api/types';

export interface GeoFix extends LatLng {
  heading: number | null;
  speed_kmh: number | null;
  accuracy_m: number | null;
  recorded_at: string;
}

export function toFix(p: GeolocationPosition): GeoFix {
  return {
    lat: p.coords.latitude,
    lng: p.coords.longitude,
    heading: Number.isFinite(p.coords.heading ?? NaN) ? p.coords.heading : null,
    speed_kmh:
      p.coords.speed !== null && Number.isFinite(p.coords.speed) ? Math.round(p.coords.speed * 3.6) : null,
    accuracy_m: Number.isFinite(p.coords.accuracy) ? Math.round(p.coords.accuracy) : null,
    recorded_at: new Date(p.timestamp).toISOString(),
  };
}

export function getCurrentPosition(timeout = 10000): Promise<GeoFix> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('geolocation_unavailable'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve(toFix(p)),
      (e) => reject(e),
      {
        enableHighAccuracy: true,
        timeout,
        maximumAge: 5000,
      },
    );
  });
}

/** Position courante suivie en continu (watchPosition). */
export function useWatchPosition(enabled = true) {
  const [fix, setFix] = useState<GeoFix | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || !('geolocation' in navigator)) return;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setFix(toFix(p));
        setError(null);
      },
      (e) => setError(e.message),
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled]);
  return { fix, error };
}
