import { Outlet } from 'react-router-dom';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useUiStore } from '@/shared/store/ui';
import { useWsConnection, useWsStatus } from '@/shared/ws';

export function RootLayout() {
  useWsConnection();
  const online = useUiStore((s) => s.online);
  const wsStatus = useWsStatus();
  const { t } = useTranslation();
  useEffect(() => {
    document.documentElement.lang = 'fr';
  }, []);
  return (
    <div className="h-full flex flex-col">
      {!online && (
        <div className="bg-slate text-white text-sm text-center py-2 px-4 font-semibold" role="status">
          {t('common.offline')}
        </div>
      )}
      {online && wsStatus === 'reconnecting' && (
        <div className="bg-gray-100 text-gray-700 text-xs text-center py-1 px-4" role="status">
          {t('common.wsReconnecting')}
        </div>
      )}
      <div className="flex-1 min-h-0 relative">
        <Outlet />
      </div>
    </div>
  );
}
