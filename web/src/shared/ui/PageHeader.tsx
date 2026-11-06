import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Icon } from './Icon';

export function MobilePage({
  title,
  children,
  action,
  subtitle,
  back,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  subtitle?: string;
  /** Affiche une flèche de retour (page précédente). */
  back?: boolean;
}) {
  const nav = useNavigate();
  const { t } = useTranslation();
  return (
    <div className="h-full overflow-y-auto bg-gray-50">
      <header className="sticky top-0 z-10 bg-gray-50/90 backdrop-blur px-4 pt-4 pb-3 flex items-center gap-3">
        {back && (
          <button
            type="button"
            onClick={() => nav(-1)}
            className="h-10 w-10 -ml-1 rounded-full bg-white border border-gray-200 flex items-center justify-center shrink-0"
            aria-label={t('common.back')}
          >
            <Icon name="chevron" size={20} className="rotate-180" />
          </button>
        )}
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-extrabold leading-tight truncate">{title}</h1>
          {subtitle && <p className="text-sm text-gray-600 truncate">{subtitle}</p>}
        </div>
        {action}
      </header>
      <div className="px-4 pb-6">{children}</div>
    </div>
  );
}
