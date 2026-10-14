import { create } from 'zustand';
import type { LatLng } from '@/shared/api/types';
import { BRAZZAVILLE } from '@/shared/utils/geo';

/**
 * Position simulée (mode test) : remplace le GPS par un point choisi, utile pour tester
 * l'application hors de la zone de service (ex. depuis l'étranger). Persistée par navigateur.
 */
const KEY = 'vtc242.geoSim';

interface Persisted {
  enabled: boolean;
  position: LatLng;
}

function load(): Persisted {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<Persisted>;
      if (v.position && Number.isFinite(v.position.lat) && Number.isFinite(v.position.lng))
        return { enabled: !!v.enabled, position: { lat: v.position.lat, lng: v.position.lng } };
    }
  } catch {
    /* stockage indisponible */
  }
  return { enabled: false, position: BRAZZAVILLE };
}

function save(v: Persisted) {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* stockage indisponible */
  }
}

interface GeoSimState extends Persisted {
  enable: (position?: LatLng) => void;
  disable: () => void;
  move: (position: LatLng) => void;
}

export const useGeoSimStore = create<GeoSimState>((set, get) => ({
  ...load(),
  enable: (position) => {
    const next = { enabled: true, position: position ?? get().position };
    save(next);
    set(next);
  },
  disable: () => {
    const next = { enabled: false, position: get().position };
    save(next);
    set(next);
  },
  move: (position) => {
    const next = { enabled: get().enabled, position };
    save(next);
    set(next);
  },
}));
