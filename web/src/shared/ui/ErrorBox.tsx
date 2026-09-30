import { useTranslation } from 'react-i18next';
import { isApiError } from '@/shared/api/client';

export function errorMessage(e: unknown, t: (k: string) => string): string {
  if (isApiError(e)) {
    if (e.status === 0) return t('common.networkError');
    return e.message || t('common.error');
  }
  if (e instanceof Error) return e.message;
  return t('common.error');
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useTranslation();
  if (!error) return null;
  return (
    <div
      className="rounded-xl bg-alert-light text-alert px-4 py-3 text-sm flex items-center justify-between gap-3"
      role="alert"
    >
      <span>{errorMessage(error, t)}</span>
      {onRetry && (
        <button type="button" className="font-semibold underline min-h-tap" onClick={onRetry}>
          {t('common.retry')}
        </button>
      )}
    </div>
  );
}
