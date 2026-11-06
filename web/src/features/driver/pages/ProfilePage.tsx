import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { MobilePage, ProfileForm, Button, Badge, GeoSimCard, Icon } from '@/shared/ui';
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
        <section className="card mb-4">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h2 className="font-extrabold">{t('profile.driverActivity')}</h2>
            <Badge tone={p.status === 'approved' ? 'green' : p.status === 'pending' ? 'yellow' : 'red'}>
              {t(`admin.drivers.${p.status}`)}
            </Badge>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-xl bg-gray-50 p-3">
              <div className="text-gray-500 text-xs">{t('driver.profile.rating')}</div>
              <div className="font-extrabold text-lg">★ {p.rating_avg?.toFixed(1) ?? '—'}</div>
              <div className="text-xs text-gray-500">{p.rating_count} avis</div>
            </div>
            <div className="rounded-xl bg-gray-50 p-3">
              <div className="text-gray-500 text-xs">{t('common.zone')}</div>
              <div className="font-extrabold text-lg truncate">{p.zone?.name ?? '—'}</div>
            </div>
            <div className="rounded-xl bg-gray-50 p-3 col-span-2 flex items-center gap-3">
              <Icon name="car" size={22} className="text-brand" />
              <div className="min-w-0">
                <div className="text-gray-500 text-xs">{t('driver.profile.vehicle')}</div>
                <div className="font-bold truncate">
                  {activeVehicle
                    ? `${activeVehicle.brand} ${activeVehicle.model} · ${activeVehicle.license_plate}`
                    : '—'}
                </div>
              </div>
            </div>
          </div>
          <Button variant="secondary" block className="mt-3" onClick={() => nav('/d/onboarding')}>
            {t('driver.profile.onboarding')}
          </Button>
        </section>
      )}
      <ProfileForm photoRequired />
      <GeoSimCard />
    </MobilePage>
  );
}
