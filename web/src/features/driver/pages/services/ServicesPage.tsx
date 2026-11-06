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

/** Hub chauffeur / prestataire : véhicules en location, trajets en covoiturage. */
export default function DriverServicesPage() {
  const { t } = useTranslation();
  useServicesLive();
  return (
    <MobilePage title={t('services.title')}>
      <h2 className="section-title">{t('services.sectionOffer')}</h2>
      <div className="grid gap-3">
        <Tile
          to="/d/rentals"
          icon="key"
          title={t('services.driverRentals')}
          subtitle={t('services.driverRentalsSubtitle')}
        />
        <Tile
          to="/d/carpool"
          icon="route"
          tone="blue"
          title={t('services.driverCarpool')}
          subtitle={t('services.driverCarpoolSubtitle')}
        />
      </div>
      <p className="text-xs text-gray-500 mt-4">{t('services.walletHint', { rate: COMMISSION_RATE_PCT })}</p>
    </MobilePage>
  );
}
