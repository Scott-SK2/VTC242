import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui';

export function OfflinePage() {
  const { t } = useTranslation();
  return (
    <div className="min-h-full flex items-center justify-center px-4">
      <div className="max-w-sm text-center">
        <div className="text-6xl mb-4" aria-hidden="true">
          📡
        </div>
        <h1 className="text-2xl font-extrabold mb-2">{t('pwa.offlineTitle')}</h1>
        <p className="text-gray-600 mb-6">{t('pwa.offlineBody')}</p>
        <Button block onClick={() => window.location.replace('/')}>
          {t('common.retry')}
        </Button>
      </div>
    </div>
  );
}
