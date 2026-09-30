import { lazy, Suspense } from 'react';
import type { MapViewProps } from './types';

export * from './types';

const LazyMapView = lazy(() => import('./MapView'));

/** Carte chargée à la demande : MapLibre n'entre pas dans le bundle initial. */
export function MapView(props: MapViewProps) {
  return (
    <Suspense
      fallback={
        <div
          className={`h-full w-full bg-gray-100 ${props.className ?? ''}`}
          aria-busy="true"
          aria-label="Carte"
        />
      }
    >
      <LazyMapView {...props} />
    </Suspense>
  );
}
