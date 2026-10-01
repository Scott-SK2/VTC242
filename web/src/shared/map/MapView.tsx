import { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { Map as MlMap, Marker } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre ≥ 5 charge son worker par URL relative au module : on le fait empaqueter par Vite.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

maplibregl.setWorkerUrl(maplibreWorkerUrl);
import { mapStyle } from './style';
import type { MapMarker, MapViewProps, MarkerKind } from './types';
import { BRAZZAVILLE, boundsOf } from '@/shared/utils/geo';

const COLORS: Record<MarkerKind, string> = {
  pickup: '#1E9B45',
  dropoff: '#111318',
  driver: '#1E9B45',
  me: '#2563EB',
  available: '#1E9B45',
  busy: '#F2C21B',
  offline: '#9CA3AF',
  poi: '#24272C',
  vertex: '#C8202C',
};

function markerElement(m: MapMarker): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('role', m.onClick ? 'button' : 'img');
  el.setAttribute('aria-label', m.label ?? m.kind);
  if (m.onClick) el.tabIndex = 0;
  el.style.cursor = m.onClick ? 'pointer' : 'default';
  const color = COLORS[m.kind];
  if (m.kind === 'driver' || m.kind === 'available' || m.kind === 'busy' || m.kind === 'offline') {
    el.innerHTML = `<svg width="34" height="34" viewBox="0 0 34 34" style="transform:rotate(${m.heading ?? 0}deg);filter:drop-shadow(0 1px 2px rgba(0,0,0,.4))"><path d="M17 3 L27 29 L17 23 L7 29 Z" fill="${color}" stroke="white" stroke-width="2"/></svg>`;
  } else if (m.kind === 'me') {
    el.innerHTML = `<div style="width:18px;height:18px;border-radius:50%;background:${color};border:3px solid white;box-shadow:0 0 0 6px rgba(37,99,235,.25)"></div>`;
  } else if (m.kind === 'vertex') {
    el.innerHTML = `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid white"></div>`;
  } else {
    el.innerHTML = `<svg width="30" height="40" viewBox="0 0 30 40" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,.4))"><path d="M15 39 C15 39 2 22 2 14 A13 13 0 0 1 28 14 C28 22 15 39 15 39Z" fill="${color}" stroke="white" stroke-width="2"/><circle cx="15" cy="14" r="5" fill="white"/></svg>`;
  }
  if (m.label && (m.kind === 'poi' || m.kind === 'available' || m.kind === 'busy' || m.kind === 'offline')) {
    const lab = document.createElement('div');
    lab.textContent = m.label;
    lab.style.cssText =
      'position:absolute;left:50%;top:100%;transform:translateX(-50%);white-space:nowrap;font:600 11px Manrope,sans-serif;background:white;padding:1px 6px;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.3)';
    el.style.position = 'relative';
    el.appendChild(lab);
  }
  if (m.onClick) {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      m.onClick?.();
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') m.onClick?.();
    });
  }
  return el;
}

/** Carte MapLibre. Ce module est chargé à la demande (import dynamique). */
export default function MapView({
  center,
  zoom = 13,
  markers = [],
  routes = [],
  polygon = null,
  fit,
  fitKey,
  onClick,
  className = '',
  interactive = true,
  follow = false,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const loadedRef = useRef(false);
  const markersRef = useRef(new Map<string, { marker: Marker; sig: string }>());
  const onClickRef = useRef(onClick);
  onClickRef.current = onClick;

  // Initialisation
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: mapStyle(),
      center: [center?.lng ?? BRAZZAVILLE.lng, center?.lat ?? BRAZZAVILLE.lat],
      zoom,
      interactive,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.on('load', () => {
      loadedRef.current = true;
      syncRoutes(map, routes);
      syncPolygon(map, polygon);
    });
    map.on('click', (e: maplibregl.MapMouseEvent) =>
      onClickRef.current?.({ lat: e.lngLat.lat, lng: e.lngLat.lng }),
    );
    mapRef.current = map;
    const markerStore = markersRef.current;
    return () => {
      map.remove();
      mapRef.current = null;
      loadedRef.current = false;
      markerStore.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Centre
  useEffect(() => {
    if (!mapRef.current || !center || fit?.length) return;
    mapRef.current.easeTo({ center: [center.lng, center.lat], duration: 400 });
  }, [center?.lat, center?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  // Marqueurs
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const seen = new Set<string>();
    for (const m of markers) {
      seen.add(m.id);
      const sig = `${m.kind}|${m.heading ?? ''}|${m.label ?? ''}|${!!m.onClick}`;
      const existing = markersRef.current.get(m.id);
      if (existing && existing.sig === sig) {
        existing.marker.setLngLat([m.lng, m.lat]);
        continue;
      }
      existing?.marker.remove();
      const marker = new maplibregl.Marker({
        element: markerElement(m),
        anchor: m.kind === 'pickup' || m.kind === 'dropoff' || m.kind === 'poi' ? 'bottom' : 'center',
      })
        .setLngLat([m.lng, m.lat])
        .addTo(map);
      markersRef.current.set(m.id, { marker, sig });
    }
    for (const [id, v] of markersRef.current) {
      if (!seen.has(id)) {
        v.marker.remove();
        markersRef.current.delete(id);
      }
    }
    if (follow) {
      const target = markers.find((m) => m.kind === 'driver') ?? markers.find((m) => m.kind === 'me');
      if (target) map.easeTo({ center: [target.lng, target.lat], duration: 800 });
    }
  }, [markers, follow]);

  // Itinéraires et polygone
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      syncRoutes(map, routes);
      syncPolygon(map, polygon);
    };
    if (loadedRef.current) apply();
    else map.once('load', apply);
  }, [routes, polygon]);

  // Cadrage
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !fit?.length) return;
    const b = boundsOf(fit);
    if (!b) return;
    if (fit.length === 1) map.easeTo({ center: b[0], zoom: 15 });
    else
      map.fitBounds(b, {
        padding: { top: 60, bottom: 260, left: 40, right: 40 },
        maxZoom: 16,
        duration: 500,
      });
  }, [fitKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={containerRef} className={`h-full w-full ${className}`} aria-label="Carte" />;
}

function syncRoutes(map: MlMap, routes: MapViewProps['routes']) {
  const wanted = new Set((routes ?? []).map((r) => r.id));
  const style = map.getStyle();
  for (const layer of style?.layers ?? []) {
    if (layer.id.startsWith('route-') && !wanted.has(layer.id.slice(6))) {
      map.removeLayer(layer.id);
      if (map.getSource(layer.id)) map.removeSource(layer.id);
    }
  }
  for (const r of routes ?? []) {
    const id = `route-${r.id}`;
    const data = {
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'LineString' as const, coordinates: r.coords },
    };
    const src = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
    if (src) {
      src.setData(data);
    } else {
      map.addSource(id, { type: 'geojson', data });
      map.addLayer({
        id,
        type: 'line',
        source: id,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': r.color ?? '#1E9B45',
          'line-width': 5,
          'line-opacity': 0.85,
          ...(r.dashed ? { 'line-dasharray': [1.5, 1.5] } : {}),
        },
      });
    }
  }
}

function syncPolygon(map: MlMap, polygon: MapViewProps['polygon']) {
  const id = 'zone-polygon';
  const src = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
  if (!polygon) {
    if (src) {
      map.removeLayer(`${id}-fill`);
      map.removeLayer(`${id}-line`);
      map.removeSource(id);
    }
    return;
  }
  const data = { type: 'Feature' as const, properties: {}, geometry: polygon as GeoJSON.Geometry };
  if (src) src.setData(data);
  else {
    map.addSource(id, { type: 'geojson', data });
    map.addLayer({
      id: `${id}-fill`,
      type: 'fill',
      source: id,
      paint: { 'fill-color': '#1E9B45', 'fill-opacity': 0.12 },
    });
    map.addLayer({
      id: `${id}-line`,
      type: 'line',
      source: id,
      paint: { 'line-color': '#1E9B45', 'line-width': 2 },
    });
  }
}
