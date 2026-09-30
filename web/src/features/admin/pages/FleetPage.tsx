import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { adminApi } from '@/shared/api/endpoints';
import { useWsEvent } from '@/shared/ws';
import type { Fleet, FleetDriver } from '@/shared/api/types';
import { MapView, type MapMarker } from '@/shared/map';
import { AdminPage } from '../components';
import { Badge, Button, ErrorBox } from '@/shared/ui';
import { BRAZZAVILLE } from '@/shared/utils/geo';
import { formatTime } from '@/shared/utils/date';

/** Carte de la flotte (F-51) : couleur par état, clic = fiche course. */
export default function FleetPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const fleet = useQuery({ queryKey: ['admin', 'fleet'], queryFn: adminApi.fleet, refetchInterval: 15_000 });
  const [selected, setSelected] = useState<FleetDriver | null>(null);
  useWsEvent('admin.fleet', (f) => qc.setQueryData<Fleet>(['admin', 'fleet'], f));
  const drivers = useMemo(() => fleet.data?.drivers ?? [], [fleet.data]);
  const rides = useMemo(() => fleet.data?.rides ?? [], [fleet.data]);
  const markers = useMemo<MapMarker[]>(() => {
    const list: MapMarker[] = [];
    for (const d of drivers) {
      if (!d.location) continue;
      list.push({
        id: `d-${d.id}`,
        lat: d.location.lat,
        lng: d.location.lng,
        heading: d.location.heading,
        kind: d.status,
        label: `${d.first_name} ${d.last_initial}.`,
        onClick: () => setSelected(d),
      });
    }
    for (const r of rides) {
      list.push({ id: `p-${r.id}`, ...r.pickup, kind: 'pickup', label: r.id });
      list.push({ id: `q-${r.id}`, ...r.dropoff, kind: 'dropoff', label: r.id });
    }
    return list;
  }, [drivers, rides]);
  const counts = {
    available: drivers.filter((d) => d.status === 'available').length,
    busy: drivers.filter((d) => d.status === 'busy').length,
    offline: drivers.filter((d) => d.status === 'offline').length,
  };
  return (
    <AdminPage
      title={t('admin.fleet.title')}
      actions={
        <div className="flex gap-2 flex-wrap text-sm">
          <Badge tone="green">
            {t('admin.fleet.available')} {counts.available}
          </Badge>
          <Badge tone="yellow">
            {t('admin.fleet.busy')} {counts.busy}
          </Badge>
          <Badge tone="neutral">
            {t('admin.fleet.offline')} {counts.offline}
          </Badge>
          <Badge tone="blue">{t('admin.fleet.rides', { count: rides.length })}</Badge>
        </div>
      }
    >
      <ErrorBox error={fleet.error} onRetry={() => void fleet.refetch()} />
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="h-[60vh] min-h-[360px] rounded-2xl overflow-hidden border border-gray-200 relative">
          <MapView center={BRAZZAVILLE} zoom={12} markers={markers} />
        </div>
        <aside className="card h-fit">
          {selected ? (
            <div>
              <div className="flex items-center justify-between">
                <h2 className="font-extrabold">
                  {selected.first_name} {selected.last_initial}.
                </h2>
                <Badge
                  tone={
                    selected.status === 'available'
                      ? 'green'
                      : selected.status === 'busy'
                        ? 'yellow'
                        : 'neutral'
                  }
                >
                  {t(`admin.fleet.${selected.status}`)}
                </Badge>
              </div>
              <p className="text-sm text-gray-600">
                {t(`categories.${selected.category}`)} ·{' '}
                {selected.last_location_at
                  ? formatTime(selected.last_location_at)
                  : t('admin.fleet.noLocation')}
              </p>
              {selected.ride_id ? (
                <Link to={`/admin/rides/${selected.ride_id}`} className="btn-primary w-full mt-3">
                  {t('admin.fleet.openRide')}
                </Link>
              ) : (
                <p className="text-sm mt-3 text-gray-500">{t('common.none')}</p>
              )}
              <Button variant="ghost" block className="mt-2" onClick={() => setSelected(null)}>
                {t('common.close')}
              </Button>
            </div>
          ) : (
            <div>
              <h2 className="font-extrabold mb-2">{t('admin.fleet.drivers', { count: drivers.length })}</h2>
              <ul className="max-h-[50vh] overflow-y-auto divide-y divide-gray-100">
                {drivers.map((d) => (
                  <li key={d.id}>
                    <button
                      type="button"
                      className="w-full text-left py-2 flex items-center gap-2 min-h-[44px]"
                      onClick={() => setSelected(d)}
                    >
                      <span
                        className={`h-2.5 w-2.5 rounded-full ${d.status === 'available' ? 'bg-brand' : d.status === 'busy' ? 'bg-code' : 'bg-gray-400'}`}
                        aria-hidden="true"
                      />
                      <span className="flex-1 truncate text-sm">
                        {d.first_name} {d.last_initial}.
                      </span>
                      <span className="text-xs text-gray-500">{t(`categories.${d.category}`)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </AdminPage>
  );
}
