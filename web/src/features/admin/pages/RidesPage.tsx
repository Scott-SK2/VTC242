import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { adminApi } from '@/shared/api/endpoints';
import type { AdminRide, RideStatus } from '@/shared/api/types';
import { AdminPage, DataTable, Pager, useCursorQuery, type Column } from '../components';
import { Badge, rideTone, Money } from '@/shared/ui';
import { formatDateTime } from '@/shared/utils/date';

const STATUSES: RideStatus[] = [
  'requested',
  'dispatching',
  'accepted',
  'arrived',
  'in_progress',
  'completed',
  'cancelled_by_passenger',
  'cancelled_by_driver',
  'no_driver',
];

export default function AdminRidesPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [applied, setApplied] = useState('');
  const list = useCursorQuery(['admin', 'rides', status, applied], (cursor) =>
    adminApi.rides({ status: status || undefined, q: applied || undefined, cursor }),
  );
  const columns: Column<AdminRide>[] = [
    { key: 'at', header: t('common.date'), render: (r) => formatDateTime(r.requested_at) },
    {
      key: 'status',
      header: t('common.status'),
      render: (r) => <Badge tone={rideTone(r.status)}>{t(`status.${r.status}`)}</Badge>,
    },
    { key: 'cat', header: t('common.category'), render: (r) => t(`categories.${r.category}`) },
    { key: 'passenger', header: t('roles.passenger'), render: (r) => r.passenger?.first_name ?? '—' },
    { key: 'driver', header: t('roles.driver'), render: (r) => r.driver?.first_name ?? '—' },
    {
      key: 'pickup',
      header: t('passenger.home.pickup'),
      render: (r) => <span className="block max-w-[220px] truncate">{r.pickup.address}</span>,
    },
    {
      key: 'dropoff',
      header: t('passenger.home.dropoff'),
      render: (r) => <span className="block max-w-[220px] truncate">{r.dropoff.address}</span>,
    },
    {
      key: 'price',
      header: t('common.price'),
      render: (r) => <Money value={r.final_price ?? r.estimated_price_max} />,
      className: 'text-right',
    },
    { key: 'pay', header: t('payment.method'), render: (r) => t(`payment.${r.payment_method}`) },
  ];
  return (
    <AdminPage title={t('admin.rides.title')}>
      <form
        className="flex flex-wrap gap-2 mb-4"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(q);
          list.reset();
        }}
      >
        <input
          className="input max-w-xs"
          placeholder={t('admin.rides.searchPlaceholder')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label={t('common.search')}
        />
        <select
          className="input max-w-[240px]"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            list.reset();
          }}
          aria-label={t('common.status')}
        >
          <option value="">{t('common.all')}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`status.${s}`)}
            </option>
          ))}
        </select>
        <button type="submit" className="btn-dark">
          {t('common.search')}
        </button>
      </form>
      <DataTable
        columns={columns}
        rows={list.rows}
        rowKey={(r) => r.id}
        onRowClick={(r) => nav(`/admin/rides/${r.id}`)}
        loading={list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
      />
      <Pager hasNext={list.hasNext} hasPrev={list.hasPrev} onNext={list.next} onPrev={list.prev} />
    </AdminPage>
  );
}
