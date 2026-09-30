import { useTranslation } from 'react-i18next';
import { MobilePage, RideList } from '@/shared/ui';

export default function DriverRidesPage() {
  const { t } = useTranslation();
  return (
    <MobilePage title={t('driver.rides.title')}>
      <RideList role="driver" />
    </MobilePage>
  );
}
