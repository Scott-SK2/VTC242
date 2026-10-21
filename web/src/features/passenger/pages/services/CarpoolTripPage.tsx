import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { carpoolApi } from '@/shared/api/endpoints';
import { Badge, Button, ErrorBox, FullPageSpinner, MobilePage, Modal, SelectField } from '@/shared/ui';
import { formatMoney } from '@/shared/utils/money';
import { formatDateTime } from '@/shared/utils/date';
import { toast } from '@/shared/store/ui';
import { carpoolTone, useServicesLive } from '@/features/services/components';

const FREE_CANCEL_HOURS = 2;

/** Détail d'un trajet : réservation de places, annulation (frais si tardive). */
export default function CarpoolTripPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  useServicesLive();
  const [seats, setSeats] = useState(1);
  const [cancelOpen, setCancelOpen] = useState(false);
  const trip = useQuery({
    queryKey: ['carpool', 'trip', id],
    queryFn: () => carpoolApi.trip(id as string),
    enabled: !!id,
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['carpool'] });
    void qc.invalidateQueries({ queryKey: ['wallet'] });
  };
  const book = useMutation({
    mutationFn: () => carpoolApi.book(id as string, seats),
    onSuccess: () => {
      refresh();
      toast(t('carpool.booked'), 'success');
    },
  });
  const cancel = useMutation({
    mutationFn: (bookingId: string) => carpoolApi.cancelBooking(bookingId),
    onSuccess: () => {
      refresh();
      setCancelOpen(false);
      toast(t('common.ok'), 'success');
    },
  });
  if (trip.isPending) return <FullPageSpinner />;
  if (trip.error || !trip.data)
    return (
      <MobilePage title={t('carpool.title')}>
        <ErrorBox error={trip.error ?? new Error('not found')} onRetry={() => void trip.refetch()} />
      </MobilePage>
    );
  const tr = trip.data;
  const mine = tr.my_booking ?? null;
  const canBook =
    tr.status === 'published' && tr.seats_available > 0 && (!mine || mine.status !== 'confirmed');
  const fee = Number(mine?.cancellation_fee_preview ?? 0);
  return (
    <MobilePage
      title={t('carpool.title')}
      action={
        <Button variant="ghost" onClick={() => nav(-1)}>
          {t('common.back')}
        </Button>
      }
    >
      <div className="rounded-2xl border border-gray-200 p-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-xs text-gray-500">
              {t('carpool.departure')} · {formatDateTime(tr.departure_at)}
            </div>
            <div className="font-extrabold">{tr.origin.address}</div>
            <div className="text-gray-700">→ {tr.destination.address}</div>
          </div>
          <Badge tone={carpoolTone(tr.status)}>{t(`carpool.status.${tr.status}`)}</Badge>
        </div>
        <p className="text-sm text-gray-600 mt-2">
          {t('carpool.driver')} : {tr.driver.first_name || '—'}
          {tr.driver.rating_avg ? ` · ★ ${tr.driver.rating_avg.toFixed(1)}` : ''}
          {tr.vehicle ? ` · ${tr.vehicle.brand} ${tr.vehicle.model} ${tr.vehicle.color}` : ''}
        </p>
        {tr.description && <p className="text-sm mt-2 whitespace-pre-line">{tr.description}</p>}
        <div className="mt-3 flex items-center justify-between">
          <span className="font-extrabold">
            {t('carpool.perSeat', { price: formatMoney(tr.price_per_seat) })}
          </span>
          <Badge tone={tr.seats_available > 0 ? 'green' : 'red'}>
            {tr.seats_available > 0
              ? t('carpool.seatsAvailable', { n: tr.seats_available })
              : t('carpool.full')}
          </Badge>
        </div>
      </div>

      {mine && mine.status === 'confirmed' && (
        <div className="mt-4 rounded-2xl border-2 border-brand p-3">
          <div className="font-extrabold">
            {t('carpool.seats', { n: mine.seats })} · {formatMoney(mine.price_total)}
          </div>
          <div className="text-sm text-gray-600">{t(`carpool.bookingStatus.${mine.status}`)}</div>
          {tr.status === 'published' && (
            <Button variant="secondary" block className="mt-3 text-alert" onClick={() => setCancelOpen(true)}>
              {t('carpool.cancel')}
            </Button>
          )}
        </div>
      )}

      {canBook && (
        <div className="mt-4 rounded-2xl border border-gray-200 p-3">
          <SelectField
            label={t('carpool.seatsLabel')}
            value={seats}
            onChange={(e) => setSeats(Number(e.target.value))}
          >
            {Array.from({ length: tr.seats_available }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </SelectField>
          <div className="flex justify-between text-sm mb-3">
            <span>{t('carpool.total')}</span>
            <span className="font-extrabold">{formatMoney(Number(tr.price_per_seat) * seats)}</span>
          </div>
          <Button block loading={book.isPending} onClick={() => book.mutate()}>
            {t('carpool.book')}
          </Button>
          <ErrorBox error={book.error} />
        </div>
      )}

      <Modal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title={t('carpool.cancel')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCancelOpen(false)}>
              {t('common.back')}
            </Button>
            <Button
              variant="danger"
              loading={cancel.isPending}
              onClick={() => mine && cancel.mutate(mine.id)}
            >
              {t('common.confirm')}
            </Button>
          </>
        }
      >
        <p>
          {fee > 0
            ? t('carpool.cancelFee', { hours: FREE_CANCEL_HOURS, fee: formatMoney(fee) })
            : t('carpool.cancelFree')}
        </p>
        <ErrorBox error={cancel.error} />
      </Modal>
    </MobilePage>
  );
}
