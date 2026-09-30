import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { adminApi, asList } from '@/shared/api/endpoints';
import type { AdminZone, GeoJsonPolygon, LatLng } from '@/shared/api/types';
import { MapView, type MapMarker, type MapRoute } from '@/shared/map';
import { AdminPage } from '../components';
import { Button, Checkbox, ErrorBox, TextField } from '@/shared/ui';
import { BRAZZAVILLE } from '@/shared/utils/geo';
import { toast } from '@/shared/store/ui';

const blank = (): Partial<AdminZone> => ({
  name: '',
  city: 'Brazzaville',
  emergency_police: '117',
  emergency_fire: '118',
  cash_enabled: true,
  deviation_threshold_m: 300,
  deviation_hits: 3,
  is_active: true,
  cash_debt_limit: '-5000.00',
  min_driver_rating: null,
  payout_min: '2000.00',
  payout_daily_cap: '200000.00',
  payout_manual_threshold: null,
  polygon: null,
});

function polygonCenter(p: GeoJsonPolygon | null | undefined): LatLng | null {
  if (!p) return null;
  const ring =
    (p.type === 'Polygon' ? (p.coordinates as number[][][])[0] : (p.coordinates as number[][][][])[0]?.[0]) ??
    [];
  if (!ring.length) return null;
  const sum = ring.reduce((a, c) => ({ lng: a.lng + (c[0] ?? 0), lat: a.lat + (c[1] ?? 0) }), {
    lng: 0,
    lat: 0,
  });
  return { lat: sum.lat / ring.length, lng: sum.lng / ring.length };
}

/** Zones (F-56) : polygone édité sur la carte MapLibre ou par GeoJSON, numéros d'urgence, seuils, espèces. */
export default function ZonesPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const zones = useQuery({ queryKey: ['admin', 'zones'], queryFn: adminApi.zones, select: asList });
  const [selectedId, setSelectedId] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState<Partial<AdminZone>>(blank());
  const [geojson, setGeojson] = useState('');
  const [geoError, setGeoError] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [vertices, setVertices] = useState<LatLng[]>([]);

  useEffect(() => {
    if (selectedId === 'new') {
      setForm(blank());
      setGeojson('');
    } else if (selectedId) {
      const z = zones.data?.find((x) => x.id === selectedId);
      if (z) {
        setForm(z);
        setGeojson(z.polygon ? JSON.stringify(z.polygon, null, 2) : '');
      }
    }
    setVertices([]);
    setDrawing(false);
    setGeoError(null);
  }, [selectedId, zones.data]);

  const save = useMutation({
    mutationFn: () => {
      const { id, ...body } = form as AdminZone;
      return selectedId === 'new' || !id ? adminApi.createZone(body) : adminApi.patchZone(id, body);
    },
    onSuccess: (z) => {
      void qc.invalidateQueries({ queryKey: ['admin', 'zones'] });
      setSelectedId(z.id);
      toast(t('admin.zones.saved'), 'success');
    },
  });

  function applyGeojson(text: string): boolean {
    setGeojson(text);
    if (!text.trim()) {
      setForm((f) => ({ ...f, polygon: null }));
      setGeoError(null);
      return true;
    }
    try {
      const parsed = JSON.parse(text) as { type?: string; coordinates?: unknown; geometry?: GeoJsonPolygon };
      const geom =
        parsed.type === 'Feature' && parsed.geometry ? parsed.geometry : (parsed as GeoJsonPolygon);
      if ((geom.type !== 'Polygon' && geom.type !== 'MultiPolygon') || !Array.isArray(geom.coordinates))
        throw new Error('type');
      setForm((f) => ({ ...f, polygon: geom }));
      setGeoError(null);
      return true;
    } catch {
      setGeoError(t('admin.zones.invalidGeoJson'));
      return false;
    }
  }

  function finishDrawing() {
    if (vertices.length < 3) return;
    const ring = [...vertices, vertices[0] as LatLng].map((v) => [v.lng, v.lat]);
    const poly: GeoJsonPolygon = { type: 'Polygon', coordinates: [ring] };
    setForm((f) => ({ ...f, polygon: poly }));
    setGeojson(JSON.stringify(poly, null, 2));
    setVertices([]);
    setDrawing(false);
    setGeoError(null);
  }

  const markers = useMemo<MapMarker[]>(
    () => vertices.map((v, i) => ({ id: `v${i}`, ...v, kind: 'vertex', label: String(i + 1) })),
    [vertices],
  );
  const routes = useMemo<MapRoute[]>(
    () =>
      vertices.length > 1
        ? [
            {
              id: 'draft',
              coords: vertices.map((v) => [v.lng, v.lat] as [number, number]),
              color: '#C8202C',
              dashed: true,
            },
          ]
        : [],
    [vertices],
  );
  const center = polygonCenter(form.polygon) ?? BRAZZAVILLE;
  const set = <K extends keyof AdminZone>(k: K, v: AdminZone[K]) => setForm((f) => ({ ...f, [k]: v }));
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!applyGeojson(geojson)) return;
    save.mutate();
  }

  return (
    <AdminPage
      title={t('admin.zones.title')}
      actions={<Button onClick={() => setSelectedId('new')}>{t('admin.zones.newZone')}</Button>}
    >
      <ErrorBox error={zones.error} onRetry={() => void zones.refetch()} />
      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <ul className="card p-0 divide-y divide-gray-100 h-fit">
          {(zones.data ?? []).map((z) => (
            <li key={z.id}>
              <button
                type="button"
                className={`w-full text-left px-4 py-3 min-h-tap ${selectedId === z.id ? 'bg-brand-light font-semibold' : ''}`}
                onClick={() => setSelectedId(z.id)}
              >
                {z.name}{' '}
                <span className="text-xs text-gray-500">
                  · {z.city}
                  {z.is_active ? '' : ' · inactive'}
                </span>
              </button>
            </li>
          ))}
          {zones.data?.length === 0 && <li className="p-4 text-gray-500">{t('common.none')}</li>}
        </ul>
        {selectedId ? (
          <form onSubmit={submit} className="space-y-4" noValidate>
            <div className="h-[45vh] min-h-[320px] rounded-2xl overflow-hidden border border-gray-200 relative">
              <MapView
                center={center}
                zoom={11}
                polygon={drawing ? null : (form.polygon ?? null)}
                markers={markers}
                routes={routes}
                onClick={drawing ? (p) => setVertices((v) => [...v, p]) : undefined}
              />
              <div className="absolute top-2 left-2 flex flex-wrap gap-2">
                {!drawing ? (
                  <Button
                    variant="dark"
                    className="min-h-[40px] text-sm"
                    onClick={() => {
                      setDrawing(true);
                      setVertices([]);
                    }}
                  >
                    {t('admin.zones.drawStart')}
                  </Button>
                ) : (
                  <>
                    <Button
                      className="min-h-[40px] text-sm"
                      disabled={vertices.length < 3}
                      onClick={finishDrawing}
                    >
                      {t('admin.zones.drawFinish')} ({vertices.length})
                    </Button>
                    <Button
                      variant="secondary"
                      className="min-h-[40px] text-sm"
                      onClick={() => {
                        setVertices([]);
                        setDrawing(false);
                      }}
                    >
                      {t('admin.zones.drawClear')}
                    </Button>
                  </>
                )}
              </div>
              {drawing && (
                <p className="absolute bottom-2 left-2 right-2 bg-white/90 rounded-lg px-3 py-1 text-xs">
                  {t('admin.zones.polygonHint')}
                </p>
              )}
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-3">
              <TextField
                label={t('common.name')}
                value={form.name ?? ''}
                onChange={(e) => set('name', e.target.value)}
                required
              />
              <TextField
                label={t('admin.zones.city')}
                value={form.city ?? ''}
                onChange={(e) => set('city', e.target.value)}
              />
              <TextField
                label={t('admin.zones.emergency_police')}
                value={form.emergency_police ?? ''}
                onChange={(e) => set('emergency_police', e.target.value)}
              />
              <TextField
                label={t('admin.zones.emergency_fire')}
                value={form.emergency_fire ?? ''}
                onChange={(e) => set('emergency_fire', e.target.value)}
              />
              <TextField
                label={t('admin.zones.deviation_threshold_m')}
                type="number"
                value={form.deviation_threshold_m ?? 300}
                onChange={(e) => set('deviation_threshold_m', Number(e.target.value))}
              />
              <TextField
                label={t('admin.zones.deviation_hits')}
                type="number"
                value={form.deviation_hits ?? 3}
                onChange={(e) => set('deviation_hits', Number(e.target.value))}
              />
              <TextField
                label={t('admin.zones.cash_debt_limit')}
                inputMode="decimal"
                value={form.cash_debt_limit ?? ''}
                onChange={(e) => set('cash_debt_limit', e.target.value)}
              />
              <TextField
                label={t('admin.zones.min_driver_rating')}
                inputMode="decimal"
                value={form.min_driver_rating ?? ''}
                onChange={(e) => set('min_driver_rating', e.target.value ? Number(e.target.value) : null)}
              />
              <TextField
                label={t('admin.zones.payout_min')}
                inputMode="decimal"
                value={form.payout_min ?? ''}
                onChange={(e) => set('payout_min', e.target.value)}
              />
              <TextField
                label={t('admin.zones.payout_daily_cap')}
                inputMode="decimal"
                value={form.payout_daily_cap ?? ''}
                onChange={(e) => set('payout_daily_cap', e.target.value)}
              />
              <TextField
                label={t('admin.zones.payout_manual_threshold')}
                inputMode="decimal"
                value={form.payout_manual_threshold ?? ''}
                onChange={(e) => set('payout_manual_threshold', e.target.value || null)}
              />
            </div>
            <div className="flex flex-wrap gap-6">
              <Checkbox
                label={t('admin.zones.cash_enabled')}
                checked={!!form.cash_enabled}
                onChange={(e) => set('cash_enabled', e.target.checked)}
              />
              <Checkbox
                label={t('admin.zones.is_active')}
                checked={!!form.is_active}
                onChange={(e) => set('is_active', e.target.checked)}
              />
            </div>
            <div>
              <label className="label" htmlFor="geojson">
                {t('admin.zones.polygon')}
              </label>
              <textarea
                id="geojson"
                className="input font-mono text-xs min-h-[140px] py-2"
                value={geojson}
                onChange={(e) => applyGeojson(e.target.value)}
                spellCheck={false}
              />
              {geoError && (
                <p className="text-sm text-alert mt-1" role="alert">
                  {geoError}
                </p>
              )}
            </div>
            <ErrorBox error={save.error} />
            <div className="flex gap-2 justify-end">
              <Button variant="secondary" onClick={() => setSelectedId(null)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" loading={save.isPending} disabled={!form.name}>
                {t('common.save')}
              </Button>
            </div>
          </form>
        ) : (
          <div className="card text-gray-500">{t('admin.drivers.noSelection')}</div>
        )}
      </div>
    </AdminPage>
  );
}
