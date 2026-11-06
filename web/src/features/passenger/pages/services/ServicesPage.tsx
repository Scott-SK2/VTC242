import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Icon, IconBadge, MobilePage, type IconName } from '@/shared/ui';
import { COMMISSION_RATE_PCT, useServicesLive } from '@/features/services/components';

function Tile({
  to,
  title,
  subtitle,
  icon,
  tone = 'brand',
}: {
  to: string;
  title: string;
  subtitle: string;
  icon: IconName;
  tone?: 'brand' | 'amber' | 'blue' | 'gray';
}) {
  return (
    <Link
      to={to}
      className="card flex items-center gap-4 active:scale-[0.99] transition-transform hover:border-gray-200"
    >
      <IconBadge name={icon} tone={tone} />
      <span className="min-w-0 flex-1">
        <span className="block font-extrabold">{title}</span>
        <span className="block text-sm text-gray-600">{subtitle}</span>
      </span>
      <Icon name="chevron" size={18} className="text-gray-400 shrink-0" />
    </Link>
  );
}

/** Hub des services complémentaires : location de véhicules et covoiturage. */
export default function ServicesPage() {
  const { t } = useTranslation();
  useServicesLive();
  return (
    <MobilePage title={t('services.title')}>
      <h2 className="section-title">{t('services.sectionBook')}</h2>
      <div className="grid gap-3">
        <Tile
          to="/p/rentals"
          icon="car"
          title={t('services.rentalsTitle')}
          subtitle={t('services.rentalsSubtitle')}
        />
        <Tile
          to="/p/carpool"
          icon="users"
          tone="blue"
          title={t('services.carpoolTitle')}
          subtitle={t('services.carpoolSubtitle')}
        />
      </div>
      <h2 className="section-title mt-6">{t('services.sectionMine')}</h2>
      <div className="grid gap-3">
        <Tile
          to="/p/rentals/bookings"
          icon="calendar"
          tone="amber"
          title={t('services.myRentalBookings')}
          subtitle={t('services.myRentalBookingsHint')}
        />
        <Tile
          to="/p/carpool/bookings"
          icon="ticket"
          tone="gray"
          title={t('services.myCarpoolBookings')}
          subtitle={t('services.myCarpoolBookingsHint')}
        />
      </div>
      <p className="text-xs text-gray-500 mt-4">{t('services.walletHint', { rate: COMMISSION_RATE_PCT })}</p>
    </MobilePage>
  );
}
