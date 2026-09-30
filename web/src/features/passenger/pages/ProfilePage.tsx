import { useTranslation } from 'react-i18next';
import { MobilePage, ProfileForm } from '@/shared/ui';

export default function ProfilePage() {
  const { t } = useTranslation();
  return (
    <MobilePage title={t('passenger.profile.title')}>
      <ProfileForm />
    </MobilePage>
  );
}
