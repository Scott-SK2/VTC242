import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { rentalsApi } from '@/shared/api/endpoints';
import type { RentalBooking } from '@/shared/api/types';
import { Button, Empty, ErrorBox, MobilePage, Modal, Spinner } from '@/shared/ui';
import { formatMoney } from '@/shared/utils/money';
import { toast } from '@/shared/store/ui';
import { RentalBookingCard, useServicesLive } from '@/features/services/components';

/** Locations du client : suivi et annulation (frais si tardive après acceptation). */
export default function RentalBookingsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  useServicesLive();
  const [toCancel, setToCancel] = useState<RentalBooking | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const q = useInfiniteQuery({
    queryKey: ['rentals', 'bookings', 'renter'],
    queryFn: ({ pageParam }) => rentalsApi.bookings({ cursor: pageParam || undefined }),
    initialPageParam: '',
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const cancel = useMutation({
    mutationFn: (b: RentalBooking) => rentalsApi.act(b.id, 'cancel'),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['rentals'] });
      void qc.invalidateQueries({ queryKey: ['wallet'] });
      setToCancel(null);
      toast(t('common.ok'), 'success');
    },
  });
  async function askCancel(b: RentalBooking) {
    setToCancel(b);
    setPreview(null);
    try {
      const d = await rentalsApi.booking(b.id);
      setPreview(d.cancellation_fee_preview ?? '0');
    } catch {
      setPreview('0');
    }
  }
  const items = q.data?.pages.flatMap((p) => p.results) ?? [];
  return (
    <MobilePage title={t('rentals.bookings')}>
      {q.isPending ? (
        <div className="py-6 text-center text-brand">
          <Spinner />
        </div>
      ) : q.error ? (
        <ErrorBox error={q.error} onRetry={() => void q.refetch()} />
      ) : items.length === 0 ? (
        <Empty text={t('rentals.noBookings')} />
      ) : (
        <div className="grid gap-3">
          {items.map((b) => (
            <RentalBookingCard key={b.id} booking={b} role="renter" onAct={() => void askCancel(b)} />
          ))}
          {q.hasNextPage && (
            <Button
              variant="secondary"
              block
              loading={q.isFetchingNextPage}
              onClick={() => void q.fetchNextPage()}
            >
              {t('common.loadMore')}
            </Button>
          )}
        </div>
      )}
      <Modal
        open={!!toCancel}
        onClose={() => setToCancel(null)}
        title={t('rentals.cancel')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setToCancel(null)}>
              {t('common.back')}
            </Button>
            <Button
              variant="danger"
              loading={cancel.isPending}
              onClick={() => toCancel && cancel.mutate(toCancel)}
            >
              {t('common.confirm')}
            </Button>
          </>
        }
      >
        <p>
          {preview === null
            ? t('common.loading')
            : Number(preview) > 0
              ? t('rentals.cancelFee', { fee: formatMoney(preview) })
              : t('rentals.cancelFree')}
        </p>
        <ErrorBox error={cancel.error} />
      </Modal>
    </MobilePage>
  );
}
