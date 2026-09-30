import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <div className="min-h-full flex items-center justify-center px-4">
      <div className="max-w-sm text-center">
        <p className="text-6xl font-extrabold text-gray-300 mb-2">404</p>
        <h1 className="text-2xl font-extrabold mb-2">{t('pwa.notFoundTitle')}</h1>
        <p className="text-gray-600 mb-6">{t('pwa.notFoundBody')}</p>
        <Link to="/" className="btn-primary w-full">
          {t('pwa.goHome')}
        </Link>
      </div>
    </div>
  );
}
