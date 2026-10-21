import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { adminServicesApi } from '@/shared/api/endpoints';
import type { RentalBooking, RentalListing } from '@/shared/api/types';
import { AdminPage, DataTable, Pager, ReasonModal, useCursorQuery, type Column } from '../components';
import { Badge, Button, Tabs, TextField } from '@/shared/ui';
import { formatMoney } from '@/shared/utils/money';
import { formatDate, formatDateTime } from '@/shared/utils/date';
import { toast } from '@/shared/store/ui';
import { rentalTone } from '@/features/services/components';

type Tab = 'listings' | 'bookings';

/** Back-office : validation des annonces de location et suivi des réservations. */
export default function RentalsAdminPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('listings');
  const [pendingOnly, setPendingOnly] = useState(true);
  const [q, setQ] = useState('');
  const [toSuspend, setToSuspend] = useState<RentalListing | null>(null);
  const listings = useCursorQuery(
    ['admin', 'rentals', 'listings', pendingOnly, q],
    (cursor) =>
      adminServicesApi.rentalListings({
        status: pendingOnly ? 'pending' : undefined,
        q: q || undefined,
        cursor,
      }),
    tab === 'listings',
  );
  const bookings = useCursorQuery(
    ['admin', 'rentals', 'bookings', q],
    (cursor) => adminServicesApi.rentalBookings({ q: q || undefined, cursor }),
    tab === 'bookings',
  );
  const review = useMutation({
    mutationFn: ({
      id,
      action,
      reason,
    }: {
      id: string;
      action: 'approve' | 'suspend' | 'reinstate';
      reason?: string;
    }) => adminServicesApi.reviewListing(id, action, reason ?? ''),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'rentals'] });
      setToSuspend(null);
      toast(t('common.ok'), 'success');
    },
  });
  const listingColumns: Column<RentalListing>[] = [
    {
      key: 'title',
      header: t('rentals.form.title'),
      render: (l) => <span className="font-semibold">{l.title}</span>,
    },
    {
      key: 'vehicle',
      header: t('rentals.vehicle'),
      render: (l) => `${l.vehicle.brand} ${l.vehicle.model} · ${l.vehicle.license_plate}`,
    },
    { key: 'owner', header: t('admin.rentals.owner'), render: (l) => l.owner.first_name || '—' },
    {
      key: 'prices',
      header: t('admin.rentals.prices'),
      render: (l) => (
        <span className="text-sm">
          {l.price_per_day_with_driver
            ? `${formatMoney(l.price_per_day_with_driver)}/j ${t('rentals.withDriver')}`
            : ''}
          {l.price_per_day_with_driver && l.price_per_day_without_driver ? ' · ' : ''}
          {l.price_per_day_without_driver
            ? `${formatMoney(l.price_per_day_without_driver)}/j ${t('rentals.withoutDriver')}`
            : ''}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('common.status'),
      render: (l) => <Badge tone={rentalTone(l.status)}>{t(`rentals.listingStatus.${l.status}`)}</Badge>,
    },
    { key: 'at', header: t('common.date'), render: (l) => formatDateTime(l.created_at) },
    {
      key: 'actions',
      header: t('common.actions'),
      render: (l) => (
        <div className="flex gap-2 flex-wrap">
          {l.status !== 'approved' && (
            <Button
              className="min-h-[36px] px-3 text-xs"
              loading={review.isPending}
              onClick={() =>
                review.mutate({ id: l.id, action: l.status === 'suspended' ? 'reinstate' : 'approve' })
              }
            >
              {l.status === 'suspended' ? t('admin.rentals.reinstate') : t('admin.rentals.approve')}
            </Button>
          )}
          {l.status === 'approved' && (
            <Button variant="danger" className="min-h-[36px] px-3 text-xs" onClick={() => setToSuspend(l)}>
              {t('admin.rentals.suspend')}
            </Button>
          )}
        </div>
      ),
    },
  ];
  const bookingColumns: Column<RentalBooking>[] = [
    {
      key: 'title',
      header: t('rentals.form.title'),
      render: (b) => <span className="font-semibold">{b.listing.title}</span>,
    },
    {
      key: 'period',
      header: t('common.date'),
      render: (b) => `${formatDate(b.start_date)} → ${formatDate(b.end_date)} (${b.days} j)`,
    },
    { key: 'mode', header: t('rentals.mode.all'), render: (b) => t(`rentals.mode.${b.mode}`) },
    { key: 'renter', header: t('rentals.renter'), render: (b) => b.renter.first_name || '—' },
    { key: 'owner', header: t('rentals.owner'), render: (b) => b.owner.first_name || '—' },
    { key: 'total', header: t('common.amount'), render: (b) => formatMoney(b.total_price) },
    {
      key: 'status',
      header: t('common.status'),
      render: (b) => <Badge tone={rentalTone(b.status)}>{t(`rentals.status.${b.status}`)}</Badge>,
    },
  ];
  return (
    <AdminPage title={t('admin.rentals.title')}>
      <div className="flex flex-wrap items-end gap-3 mb-3">
        <Tabs
          value={tab}
          onChange={setTab}
          className="w-72"
          items={[
            { value: 'listings', label: t('admin.rentals.listings') },
            { value: 'bookings', label: t('admin.rentals.bookings') },
          ]}
        />
        {tab === 'listings' && (
          <Tabs
            value={pendingOnly ? 'pending' : 'all'}
            onChange={(v) => setPendingOnly(v === 'pending')}
            className="w-60"
            items={[
              { value: 'pending', label: t('admin.rentals.pendingOnly') },
              { value: 'all', label: t('admin.rentals.all') },
            ]}
          />
        )}
        <div className="w-72">
          <TextField label={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      {tab === 'listings' ? (
        <>
          <DataTable
            columns={listingColumns}
            rows={listings.rows}
            rowKey={(l) => l.id}
            loading={listings.isPending}
            error={listings.error}
            onRetry={() => void listings.refetch()}
          />
          <Pager
            hasNext={listings.hasNext}
            hasPrev={listings.hasPrev}
            onNext={listings.next}
            onPrev={listings.prev}
          />
        </>
      ) : (
        <>
          <DataTable
            columns={bookingColumns}
            rows={bookings.rows}
            rowKey={(b) => b.id}
            loading={bookings.isPending}
            error={bookings.error}
            onRetry={() => void bookings.refetch()}
          />
          <Pager
            hasNext={bookings.hasNext}
            hasPrev={bookings.hasPrev}
            onNext={bookings.next}
            onPrev={bookings.prev}
          />
        </>
      )}
      <ReasonModal
        open={!!toSuspend}
        title={t('admin.rentals.suspendTitle')}
        danger
        loading={review.isPending}
        error={review.error}
        onClose={() => setToSuspend(null)}
        onConfirm={(reason) => toSuspend && review.mutate({ id: toSuspend.id, action: 'suspend', reason })}
      />
    </AdminPage>
  );
}
