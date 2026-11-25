import { create } from 'zustand';
import type { Offer } from '@/shared/api/types';
import type { GeoFix } from '@/shared/utils/geolocation';

/**
 * État de la session chauffeur, tenu par <DriverSession /> (monté sur tous les écrans
 * chauffeur) et lu par l'accueil : position envoyée, file hors ligne, offre en cours.
 */
export interface DriverSessionState {
  fix: GeoFix | null;
  stale: boolean;
  queued: number;
  gpsError: string | null;
  simulated: boolean;
  offer: Offer | null;
  setSender: (s: Pick<DriverSessionState, 'fix' | 'stale' | 'queued' | 'gpsError' | 'simulated'>) => void;
  setOffer: (o: Offer | null) => void;
}

export const useDriverSessionStore = create<DriverSessionState>((set) => ({
  fix: null,
  stale: false,
  queued: 0,
  gpsError: null,
  simulated: false,
  offer: null,
  setSender: (s) => set(s),
  setOffer: (offer) => set({ offer }),
}));
