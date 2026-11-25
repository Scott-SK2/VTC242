import { useTranslation } from 'react-i18next';
import { isApiError } from '@/shared/api/client';

/** Premier message lisible d'un détail de validation ({champ: [messages]}, imbriqué ou non). */
export function firstDetailMessage(details: unknown): string | null {
  if (typeof details === 'string') return details;
  if (Array.isArray(details)) {
    for (const d of details) {
      const m = firstDetailMessage(d);
      if (m) return m;
    }
    return null;
  }
  if (details && typeof details === 'object') {
    const obj = details as Record<string, unknown>;
    // erreurs globales d'abord
    for (const key of ['non_field_errors', 'detail']) {
      const m = key in obj ? firstDetailMessage(obj[key]) : null;
      if (m) return m;
    }
    for (const v of Object.values(obj)) {
      const m = firstDetailMessage(v);
      if (m) return m;
    }
  }
  return null;
}

export function errorMessage(e: unknown, t: (k: string) => string): string {
  if (isApiError(e)) {
    if (e.status === 0) return t('common.networkError');
    const base = e.message || t('common.error');
    if (e.code === 'validation_error') {
      // « Données invalides. » seul ne dit pas quoi corriger : on ajoute la raison
      const detail = firstDetailMessage(e.details);
      if (detail && detail !== base) return `${base.replace(/\.?$/, ' :')} ${detail}`;
    }
    return base;
  }
  // erreurs techniques (« Failed to fetch »…) : message générique
  if (e instanceof TypeError) return t('common.networkError');
  if (e instanceof Error && e.message) return e.message;
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
