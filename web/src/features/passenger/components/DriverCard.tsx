import { useTranslation } from 'react-i18next';
import { Avatar } from '@/shared/ui';
import type { RideDriver } from '@/shared/api/types';

/** Fiche chauffeur (F-16) : photo, prénom, note, véhicule ; jamais de numéro de téléphone. */
export function DriverCard({ driver }: { driver: RideDriver }) {
  const { t } = useTranslation();
  const v = driver.vehicle;
  return (
    <div className="flex items-center gap-3">
      <Avatar src={driver.photo_url} name={driver.first_name} size={56} />
      <div className="min-w-0 flex-1">
        <div className="font-extrabold text-lg truncate">{driver.first_name}</div>
        <div className="text-sm text-gray-600">
          ★{' '}
          {driver.rating !== null
            ? t('passenger.found.rating', { rating: driver.rating.toFixed(1), count: driver.rating_count })
            : '—'}
        </div>
        {v && (
          <div className="text-sm">
            <span className="font-semibold">
              {v.brand} {v.model}
            </span>{' '}
            · {v.color}
          </div>
        )}
      </div>
      {v && (
        <div className="text-right shrink-0">
          <div className="rounded-lg border-2 border-ink px-2 py-1 font-extrabold tabular-nums">
            {v.license_plate}
          </div>
          {v.taxi_number && (
            <div className="text-xs text-gray-600 mt-1">
              {t('passenger.found.taxiNumber')} {v.taxi_number}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
