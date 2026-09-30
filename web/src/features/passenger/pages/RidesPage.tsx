import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { MobilePage, RideList } from '@/shared/ui';

export default function RidesPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  return (
    <MobilePage title={t('passenger.rides.title')}>
      <RideList role="passenger" onOpen={(r) => nav(`/p/ride/${r.id}`)} />
    </MobilePage>
  );
}
