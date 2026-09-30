import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ridesApi } from '@/shared/api/endpoints';
import { isApiError } from '@/shared/api/client';
import { MapView, type MapMarker } from '@/shared/map';
import { Badge, rideTone, FullPageSpinner, ErrorBox } from '@/shared/ui';
import { formatDuration } from '@/shared/utils/geo';

/** Page publique de partage de trajet (F-19) : position + ETA, sans données personnelles. */
export default function SharePage() {
  const { token } = useParams<{ token: string }>();
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ['share', token],
    queryFn: () => ridesApi.shared(token as string),
    enabled: !!token,
    refetchInterval: 5000,
    retry: false,
  });
  if (q.isPending) return <FullPageSpinner />;
  if (q.error) {
    const gone = isApiError(q.error) && (q.error.status === 404 || q.error.status === 410);
    return (
      <div className="p-6 text-center">
        {gone ? (
          <p className="font-semibold">{t('passenger.share.expired')}</p>
        ) : (
          <ErrorBox error={q.error} />
        )}
      </div>
    );
  }
  const d = q.data;
  const markers: MapMarker[] = [
    { id: 'dropoff', ...d.dropoff, kind: 'dropoff', label: t('passenger.home.dropoff') },
  ];
  if (d.driver_position)
    markers.push({ id: 'driver', ...d.driver_position, kind: 'driver', label: t('roles.driver') });
  return (
    <div className="absolute inset-0">
      <MapView
        markers={markers}
        fit={[d.dropoff, ...(d.driver_position ? [d.driver_position] : [])]}
        fitKey={`${!!d.driver_position}`}
        follow
      />
      <section className="sheet" aria-label={t('passenger.share.title')}>
        <div className="p-4">
          <h1 className="text-xl font-extrabold">{t('passenger.share.title')}</h1>
          <p className="text-sm text-gray-600 mb-2">{t('passenger.share.subtitle')}</p>
          <div className="flex items-center gap-3 flex-wrap">
            <Badge tone={rideTone(d.status)}>{t(`status.${d.status}`)}</Badge>
            {d.eta_s !== null && (
              <span className="font-semibold text-brand-dark">
                {t('passenger.share.eta', { eta: formatDuration(d.eta_s) })}
              </span>
            )}
          </div>
          {d.vehicle && (
            <p className="mt-2 text-sm">
              <span className="text-gray-600">{t('passenger.share.vehicle')} :</span> {d.vehicle.brand}{' '}
              {d.vehicle.model} · {d.vehicle.color} · <strong>{d.vehicle.license_plate}</strong>
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
