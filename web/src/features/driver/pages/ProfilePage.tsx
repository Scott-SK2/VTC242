import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { MobilePage, ProfileForm, Button, Badge, GeoSimCard } from '@/shared/ui';
import { driversApi } from '@/shared/api/endpoints';
import { qk } from '@/shared/api/hooks';

export default function DriverProfilePage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const profile = useQuery({ queryKey: qk.driverMe, queryFn: driversApi.me });
  const vehicles = useQuery({ queryKey: qk.vehicles, queryFn: driversApi.vehicles });
  const activeVehicle = vehicles.data?.find((v) => v.is_active);
  const p = profile.data;
  return (
    <MobilePage title={t('driver.profile.title')}>
      {p && (
        <div className="card mb-4 space-y-1 text-sm">
          <div className="flex justify-between">
            <span>{t('common.status')}</span>
            <Badge tone={p.status === 'approved' ? 'green' : p.status === 'pending' ? 'yellow' : 'red'}>
              {t(`admin.drivers.${p.status}`)}
            </Badge>
          </div>
          <div className="flex justify-between">
            <span>{t('driver.profile.rating')}</span>
            <span className="font-semibold">
              ★ {p.rating_avg?.toFixed(1) ?? '—'} ({p.rating_count})
            </span>
          </div>
          <div className="flex justify-between">
            <span>{t('driver.profile.vehicle')}</span>
            <span className="font-semibold">
              {activeVehicle
                ? `${activeVehicle.brand} ${activeVehicle.model} · ${activeVehicle.license_plate}`
                : '—'}
            </span>
          </div>
          {p.zone && (
            <div className="flex justify-between">
              <span>{t('common.zone')}</span>
              <span className="font-semibold">{p.zone.name}</span>
            </div>
          )}
        </div>
      )}
      <Button variant="secondary" block className="mb-4" onClick={() => nav('/d/onboarding')}>
        {t('driver.profile.onboarding')}
      </Button>
      <ProfileForm photoRequired />
      <GeoSimCard />
    </MobilePage>
  );
}
