import { isRouteErrorResponse, useRouteError } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { NotFoundPage } from './NotFoundPage';

/** Morceau de l'application introuvable après une mise à jour (ancien onglet ouvert). */
function isChunkError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? '');
  return /dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk/i.test(
    msg,
  );
}

/** Erreur de route : 404, nouvelle version à charger, ou plantage d'un écran (rechargement). */
export function RouteErrorPage() {
  const { t } = useTranslation();
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundPage />;
  const chunk = isChunkError(error);
  if (!chunk) console.error(error);
  return (
    <div className="min-h-full flex items-center justify-center px-4">
      <div className="max-w-sm text-center">
        <h1 className="text-2xl font-extrabold mb-2">
          {chunk ? t('pwa.newVersionTitle') : t('pwa.crashTitle')}
        </h1>
        <p className="text-gray-600 mb-6">{chunk ? t('pwa.newVersionBody') : t('pwa.crashBody')}</p>
        <button type="button" className="btn-primary w-full" onClick={() => window.location.reload()}>
          {t('pwa.reload')}
        </button>
      </div>
    </div>
  );
}
