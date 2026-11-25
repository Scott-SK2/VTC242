import { Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUiStore } from '@/shared/store/ui';
import { useWsConnection, useWsStatus } from '@/shared/ws';

export function RootLayout() {
  useWsConnection();
  const online = useUiStore((s) => s.online);
  const updateReady = useUiStore((s) => s.updateReady);
  const setUpdateReady = useUiStore((s) => s.setUpdateReady);
  const wsStatus = useWsStatus();
  const { t } = useTranslation();
  const [showReconnect, setShowReconnect] = useState(false);
  useEffect(() => {
    document.documentElement.lang = 'fr';
  }, []);
  // Évite le clignotement lors d'une rotation de jeton : bandeau après 3 s de reconnexion seulement
  useEffect(() => {
    if (wsStatus !== 'reconnecting') {
      setShowReconnect(false);
      return;
    }
    const timer = setTimeout(() => setShowReconnect(true), 3000);
    return () => clearTimeout(timer);
  }, [wsStatus]);
  return (
    <div className="h-full flex flex-col">
      {!online && (
        <div className="bg-slate text-white text-sm text-center py-2 px-4 font-semibold" role="status">
          {t('common.offline')}
        </div>
      )}
      {online && showReconnect && (
        <div className="bg-gray-100 text-gray-700 text-xs text-center py-1 px-4" role="status">
          {t('common.wsReconnecting')}
        </div>
      )}
      {updateReady && (
        <div
          className="bg-brand-light text-brand-dark text-sm py-2 px-4 flex items-center justify-between gap-3"
          role="status"
        >
          <span className="font-semibold">{t('pwa.updateReady')}</span>
          <span className="flex gap-2 shrink-0">
            <button type="button" className="underline min-h-tap px-1" onClick={() => setUpdateReady(null)}>
              {t('pwa.later')}
            </button>
            <button type="button" className="font-extrabold underline min-h-tap px-1" onClick={updateReady}>
              {t('pwa.update')}
            </button>
          </span>
        </div>
      )}
      <div className="flex-1 min-h-0 relative">
        <Outlet />
      </div>
    </div>
  );
}
