import type { StyleSpecification } from 'maplibre-gl';

const key = import.meta.env.VITE_MAPTILER_KEY as string | undefined;

/** Style vectoriel MapTiler si la clé existe, sinon repli sur les tuiles raster OSM. */
export function mapStyle(): string | StyleSpecification {
  if (key) return `https://api.maptiler.com/maps/streets-v2/style.json?key=${key}`;
  return {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        maxzoom: 19,
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      },
    },
    layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
  };
}
