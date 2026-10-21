import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { adminServicesApi } from '@/shared/api/endpoints';
import type { CarpoolTrip } from '@/shared/api/types';
import { AdminPage, DataTable, Pager, ReasonModal, useCursorQuery, type Column } from '../components';
import { Badge, Button, Tabs, TextField } from '@/shared/ui';
import { formatMoney } from '@/shared/utils/money';
import { formatDateTime } from '@/shared/utils/date';
import { toast } from '@/shared/store/ui';
import { carpoolTone } from '@/features/services/components';

/** Back-office : trajets de covoiturage, annulation par le support (passagers remboursés). */
export default function CarpoolAdminPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [upcoming, setUpcoming] = useState(true);
  const [q, setQ] = useState('');
  const [toCancel, setToCancel] = useState<CarpoolTrip | null>(null);
  const trips = useCursorQuery(['admin', 'carpool', 'trips', upcoming, q], (cursor) =>
    adminServicesApi.carpoolTrips({
      status: upcoming ? 'published,in_progress' : undefined,
      q: q || undefined,
      cursor,
    }),
  );
  const cancel = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => adminServicesApi.cancelTrip(id, reason),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'carpool'] });
      setToCancel(null);
      toast(t('common.ok'), 'success');
    },
  });
  const columns: Column<CarpoolTrip>[] = [
    { key: 'at', header: t('carpool.departure'), render: (tr) => formatDateTime(tr.departure_at) },
    {
      key: 'trip',
      header: t('admin.carpool.trip'),
      render: (tr) => (
        <span>
          <span className="font-semibold">{tr.origin.address}</span> → {tr.destination.address}
        </span>
      ),
    },
    { key: 'driver', header: t('admin.carpool.driver'), render: (tr) => tr.driver.first_name || '—' },
    {
      key: 'seats',
      header: t('admin.carpool.seats'),
      render: (tr) => `${tr.seats_booked}/${tr.seats_total}`,
    },
    { key: 'price', header: t('common.amount'), render: (tr) => formatMoney(tr.price_per_seat) },
    {
      key: 'status',
      header: t('common.status'),
      render: (tr) => <Badge tone={carpoolTone(tr.status)}>{t(`carpool.status.${tr.status}`)}</Badge>,
    },
    {
      key: 'actions',
      header: t('common.actions'),
      render: (tr) =>
        tr.status === 'published' || tr.status === 'in_progress' ? (
          <Button variant="danger" className="min-h-[36px] px-3 text-xs" onClick={() => setToCancel(tr)}>
            {t('admin.carpool.cancel')}
          </Button>
        ) : null,
    },
  ];
  return (
    <AdminPage title={t('admin.carpool.title')}>
      <div className="flex flex-wrap items-end gap-3 mb-3">
        <Tabs
          value={upcoming ? 'upcoming' : 'all'}
          onChange={(v) => setUpcoming(v === 'upcoming')}
          className="w-60"
          items={[
            { value: 'upcoming', label: t('admin.carpool.upcoming') },
            { value: 'all', label: t('admin.carpool.all') },
          ]}
        />
        <div className="w-72">
          <TextField label={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <DataTable
        columns={columns}
        rows={trips.rows}
        rowKey={(tr) => tr.id}
        loading={trips.isPending}
        error={trips.error}
        onRetry={() => void trips.refetch()}
      />
      <Pager hasNext={trips.hasNext} hasPrev={trips.hasPrev} onNext={trips.next} onPrev={trips.prev} />
      <ReasonModal
        open={!!toCancel}
        title={t('admin.carpool.cancelTitle')}
        danger
        loading={cancel.isPending}
        error={cancel.error}
        onClose={() => setToCancel(null)}
        onConfirm={(reason) => toCancel && cancel.mutate({ id: toCancel.id, reason })}
      />
    </AdminPage>
  );
}
