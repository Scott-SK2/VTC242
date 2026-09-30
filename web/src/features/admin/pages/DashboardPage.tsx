import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { adminApi } from '@/shared/api/endpoints';
import { useWsEvent } from '@/shared/ws';
import type { Alert, Dashboard } from '@/shared/api/types';
import { AdminPage, KpiCard } from '../components';
import { formatMoney } from '@/shared/utils/money';
import { formatTime } from '@/shared/utils/date';
import { Badge, ErrorBox } from '@/shared/ui';

/** Tableau de bord (F-50) : KPI REST puis rafraîchis par `admin.dashboard` toutes les 5 s. */
export default function DashboardPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const kpis = useQuery({
    queryKey: ['admin', 'dashboard'],
    queryFn: adminApi.dashboard,
    refetchInterval: 30_000,
  });
  const openAlerts = useQuery({
    queryKey: ['admin', 'alerts', 'open', ''],
    queryFn: () => adminApi.alerts('open'),
  });
  useWsEvent('admin.dashboard', (d) => {
    qc.setQueryData<Dashboard>(['admin', 'dashboard'], d.kpis);
    setAlerts(d.alerts ?? []);
    setUpdatedAt(new Date().toISOString());
  });
  useWsEvent('admin.alert', (a) =>
    setAlerts((list) => [a, ...list.filter((x) => x.id !== a.id)].slice(0, 20)),
  );
  const d = kpis.data;
  const list = alerts.length ? alerts : (openAlerts.data?.results ?? []);
  return (
    <AdminPage
      title={t('admin.dashboard.title')}
      actions={
        updatedAt && (
          <span className="text-sm text-gray-500">
            {t('admin.dashboard.lastUpdate', { time: formatTime(updatedAt) })}
          </span>
        )
      }
    >
      <ErrorBox error={kpis.error} onRetry={() => void kpis.refetch()} />
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))] mb-6">
        <KpiCard
          label={t('admin.dashboard.ridesInProgress')}
          value={d?.rides_in_progress ?? '—'}
          tone="green"
        />
        <KpiCard label={t('admin.dashboard.driversOnline')} value={d?.drivers_online ?? '—'} />
        <KpiCard label={t('admin.dashboard.driversAvailable')} value={d?.drivers_available ?? '—'} />
        <KpiCard
          label={t('admin.dashboard.ridesWaiting')}
          value={d?.rides_waiting ?? '—'}
          tone={d && d.rides_waiting > 0 ? 'yellow' : 'neutral'}
        />
        <KpiCard label={t('admin.dashboard.ridesToday')} value={d?.rides_today ?? '—'} />
        <KpiCard label={t('admin.dashboard.revenueToday')} value={d ? formatMoney(d.revenue_today) : '—'} />
        <KpiCard
          label={t('admin.dashboard.commissionToday')}
          value={d ? formatMoney(d.commission_today) : '—'}
          tone="green"
        />
        <KpiCard
          label={t('admin.dashboard.cancellationRate')}
          value={d ? `${(d.cancellation_rate * (d.cancellation_rate <= 1 ? 100 : 1)).toFixed(1)} %` : '—'}
        />
        <KpiCard
          label={t('admin.dashboard.alertsOpen')}
          value={d?.alerts_open ?? '—'}
          tone={d && d.alerts_open > 0 ? 'red' : 'neutral'}
        />
      </div>
      <h2 className="font-extrabold text-lg mb-2">{t('admin.dashboard.recentAlerts')}</h2>
      <ul className="card divide-y divide-gray-100 p-0">
        {list.length === 0 && <li className="p-4 text-gray-500">{t('common.empty')}</li>}
        {list.slice(0, 10).map((a) => (
          <li key={a.id} className="p-3 flex flex-wrap items-center gap-3">
            <Badge tone={a.type === 'emergency' || a.type === 'deviation' ? 'red' : 'yellow'}>
              {t(`admin.alerts.types.${a.type}`)}
            </Badge>
            <span className="text-sm">
              {a.driver?.first_name ?? '—'} / {a.passenger?.first_name ?? '—'}
            </span>
            <span className="text-xs text-gray-500">{formatTime(a.created_at)}</span>
            {a.ride_id && (
              <Link to={`/admin/rides/${a.ride_id}`} className="ml-auto text-sm text-brand-dark underline">
                {t('admin.alerts.ride')}
              </Link>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-sm">
        <Link to="/admin/alerts" className="underline">
          {t('nav.alerts')} →
        </Link>
      </p>
    </AdminPage>
  );
}
