import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { MobilePage } from '@/shared/ui';
import { COMMISSION_RATE_PCT, useServicesLive } from '@/features/services/components';

function Tile({ to, title, subtitle, icon }: { to: string; title: string; subtitle: string; icon: string }) {
  return (
    <Link
      to={to}
      className="flex items-center gap-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm active:scale-[0.99] transition-transform"
    >
      <span className="text-3xl" aria-hidden="true">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block font-extrabold">{title}</span>
        <span className="block text-sm text-gray-600">{subtitle}</span>
      </span>
    </Link>
  );
}

/** Hub des services complémentaires : location de véhicules et covoiturage. */
export default function ServicesPage() {
  const { t } = useTranslation();
  useServicesLive();
  return (
    <MobilePage title={t('services.title')}>
      <div className="grid gap-3">
        <Tile
          to="/p/rentals"
          icon="🚙"
          title={t('services.rentalsTitle')}
          subtitle={t('services.rentalsSubtitle')}
        />
        <Tile
          to="/p/carpool"
          icon="🧑‍🤝‍🧑"
          title={t('services.carpoolTitle')}
          subtitle={t('services.carpoolSubtitle')}
        />
        <Tile
          to="/p/rentals/bookings"
          icon="🗂️"
          title={t('services.myRentalBookings')}
          subtitle={t('rentals.bookings')}
        />
        <Tile
          to="/p/carpool/bookings"
          icon="🎟️"
          title={t('services.myCarpoolBookings')}
          subtitle={t('carpool.myBookings')}
        />
      </div>
      <p className="text-xs text-gray-500 mt-4">{t('services.walletHint', { rate: COMMISSION_RATE_PCT })}</p>
    </MobilePage>
  );
}
