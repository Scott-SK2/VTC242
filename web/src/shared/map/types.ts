import type { GeoJsonPolygon, LatLng, LngLatTuple } from '@/shared/api/types';

export type MarkerKind =
  'pickup' | 'dropoff' | 'driver' | 'me' | 'available' | 'busy' | 'offline' | 'poi' | 'vertex';

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  kind: MarkerKind;
  heading?: number | null;
  label?: string;
  onClick?: () => void;
}

export interface MapRoute {
  id: string;
  coords: LngLatTuple[];
  color?: string;
  dashed?: boolean;
}

export interface MapViewProps {
  center?: LatLng;
  zoom?: number;
  markers?: MapMarker[];
  routes?: MapRoute[];
  polygon?: GeoJsonPolygon | null;
  /** Points à cadrer ; recadre à chaque changement de la clé `fitKey`. */
  fit?: LatLng[];
  fitKey?: string;
  onClick?: (p: LatLng) => void;
  className?: string;
  interactive?: boolean;
  /** Boutons + / − (inutiles sur mobile : pincement) */
  showNavigation?: boolean;
  /** Suit le premier marqueur de type `driver` ou `me`. */
  follow?: boolean;
}
