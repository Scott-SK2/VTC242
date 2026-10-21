import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type {
  CarpoolBooking,
  CarpoolTrip,
  RentalBooking,
  RentalListing,
  RentalMode,
} from '@/shared/api/types';
import { Badge, Button, type BadgeTone } from '@/shared/ui';
import { formatMoney } from '@/shared/utils/money';
import { formatDate, formatDateTime } from '@/shared/utils/date';
import { useWsEvent } from '@/shared/ws';
import { toast } from '@/shared/store/ui';

export const COMMISSION_RATE_PCT = 10;

export function rentalTone(status: string): BadgeTone {
  if (status === 'accepted' || status === 'completed' || status === 'approved') return 'green';
  if (status === 'in_progress') return 'blue';
  if (status === 'requested' || status === 'pending') return 'yellow';
  if (status.startsWith('cancelled') || status === 'declined' || status === 'suspended') return 'red';
  return 'neutral';
}

export function carpoolTone(status: string): BadgeTone {
  if (status === 'published' || status === 'confirmed' || status === 'completed') return 'green';
  if (status === 'in_progress') return 'blue';
  if (status.startsWith('cancelled')) return 'red';
  return 'neutral';
}

/** Rafraîchit les listes et prévient l'utilisateur quand une réservation ou un trajet change. */
export function useServicesLive() {
  const qc = useQueryClient();
  const { t } = useTranslation();
  useWsEvent('rental.booking_updated', (b) => {
    void qc.invalidateQueries({ queryKey: ['rentals'] });
    toast(`${b.listing.title} · ${t(`rentals.status.${b.status}`)}`, 'info');
  });
  useWsEvent('carpool.trip_updated', (trip) => {
    void qc.invalidateQueries({ queryKey: ['carpool'] });
    qc.setQueryData(['carpool', 'trip', trip.id], (old: CarpoolTrip | undefined) =>
      old ? { ...old, ...trip, bookings: old.bookings, my_booking: old.my_booking } : old,
    );
  });
}

export function modeLabel(mode: RentalMode, t: (k: string) => string) {
  return mode === 'with_driver' ? t('rentals.withDriver') : t('rentals.withoutDriver');
}

export function RentalListingCard({ listing, onOpen }: { listing: RentalListing; onOpen?: () => void }) {
  const { t } = useTranslation();
  const v = listing.vehicle;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full text-left rounded-2xl border border-gray-200 bg-white overflow-hidden shadow-sm active:scale-[0.99] transition-transform"
    >
      {listing.photo_url && (
        <img src={listing.photo_url} alt="" className="w-full h-36 object-cover bg-gray-100" loading="lazy" />
      )}
      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-extrabold truncate">{listing.title}</div>
            <div className="text-sm text-gray-600 truncate">
              {v.brand} {v.model} · {v.color} · {t(`categories.${v.category}`)} · {v.seats} pl.
            </div>
          </div>
          <Badge tone="neutral">{listing.city}</Badge>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {listing.price_per_day_with_driver && (
            <span>
              <strong>{formatMoney(listing.price_per_day_with_driver)}</strong>/j {t('rentals.withDriver')}
            </span>
          )}
          {listing.price_per_day_without_driver && (
            <span>
              <strong>{formatMoney(listing.price_per_day_without_driver)}</strong>/j{' '}
              {t('rentals.withoutDriver')}
            </span>
          )}
        </div>
        {Number(listing.deposit_amount) > 0 && listing.price_per_day_without_driver && (
          <div className="text-xs text-gray-500 mt-1">
            {t('rentals.deposit', { amount: formatMoney(listing.deposit_amount) })}
          </div>
        )}
      </div>
    </button>
  );
}

export type RentalAction = 'accept' | 'decline' | 'start' | 'complete' | 'cancel';

export function RentalBookingCard({
  booking,
  role,
  onAct,
  busy,
}: {
  booking: RentalBooking;
  role: 'renter' | 'owner';
  onAct?: (action: RentalAction) => void;
  busy?: boolean;
}) {
  const { t } = useTranslation();
  const actions: RentalAction[] = [];
  if (role === 'owner') {
    if (booking.status === 'requested') actions.push('accept', 'decline');
    if (booking.status === 'accepted') actions.push('start', 'cancel');
    if (booking.status === 'in_progress') actions.push('complete');
  } else if (booking.status === 'requested' || booking.status === 'accepted') {
    actions.push('cancel');
  }
  const labels: Record<RentalAction, string> = {
    accept: t('rentals.accept'),
    decline: t('rentals.decline'),
    start: t('rentals.start'),
    complete: t('rentals.complete'),
    cancel: t('rentals.cancel'),
  };
  const other = role === 'owner' ? booking.renter : booking.owner;
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-extrabold truncate">{booking.listing.title}</div>
          <div className="text-sm text-gray-600">
            {t('rentals.period', {
              start: formatDate(booking.start_date),
              end: formatDate(booking.end_date),
            })}{' '}
            · {t('rentals.days', { n: booking.days })} · {modeLabel(booking.mode, t)}
          </div>
          <div className="text-sm text-gray-600">
            {role === 'owner' ? t('rentals.renter') : t('rentals.owner')} : {other.first_name || '—'}
          </div>
        </div>
        <Badge tone={rentalTone(booking.status)}>{t(`rentals.status.${booking.status}`)}</Badge>
      </div>
      <div className="mt-2 flex justify-between text-sm">
        <span className="text-gray-500">{t('rentals.total')}</span>
        <span className="font-extrabold">{formatMoney(booking.total_price)}</span>
      </div>
      {Number(booking.deposit_amount) > 0 && (
        <div className="text-xs text-gray-500">
          {t('rentals.deposit', { amount: formatMoney(booking.deposit_amount) })}
        </div>
      )}
      {Number(booking.cancellation_fee) > 0 && (
        <div className="text-xs text-alert">
          {t('rentals.cancelFee', { fee: formatMoney(booking.cancellation_fee) })}
        </div>
      )}
      {booking.note && role === 'owner' && (
        <p className="text-sm mt-2 italic text-gray-700">« {booking.note} »</p>
      )}
      {booking.status_reason && <p className="text-xs text-gray-500 mt-1">{booking.status_reason}</p>}
      {actions.length > 0 && onAct && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {actions.map((a) => (
            <Button
              key={a}
              variant={a === 'decline' || a === 'cancel' ? 'secondary' : 'primary'}
              className={a === 'decline' || a === 'cancel' ? 'text-alert' : ''}
              block
              loading={busy}
              onClick={() => onAct(a)}
            >
              {labels[a]}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

export function CarpoolTripCard({ trip, onOpen }: { trip: CarpoolTrip; onOpen?: () => void }) {
  const { t } = useTranslation();
  const full = trip.seats_available === 0;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full text-left rounded-2xl border border-gray-200 bg-white p-3 shadow-sm active:scale-[0.99] transition-transform"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs text-gray-500">{formatDateTime(trip.departure_at)}</div>
          <div className="font-extrabold truncate">{trip.origin.address}</div>
          <div className="text-sm text-gray-600 truncate">→ {trip.destination.address}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-extrabold">{formatMoney(trip.price_per_seat)}</div>
          <div className="text-xs text-gray-500">/ place</div>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between text-sm">
        <span className="text-gray-600">
          {t('carpool.driver')} : {trip.driver.first_name || '—'}
          {trip.driver.rating_avg ? ` · ★ ${trip.driver.rating_avg.toFixed(1)}` : ''}
        </span>
        {trip.status === 'published' ? (
          <Badge tone={full ? 'red' : 'green'}>
            {full ? t('carpool.full') : t('carpool.seatsAvailable', { n: trip.seats_available })}
          </Badge>
        ) : (
          <Badge tone={carpoolTone(trip.status)}>{t(`carpool.status.${trip.status}`)}</Badge>
        )}
      </div>
    </button>
  );
}

export function CarpoolBookingCard({
  booking,
  onOpen,
  onCancel,
  busy,
}: {
  booking: CarpoolBooking;
  onOpen?: () => void;
  onCancel?: () => void;
  busy?: boolean;
}) {
  const { t } = useTranslation();
  const trip = booking.trip;
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-3">
      <button type="button" className="w-full text-left" onClick={onOpen}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            {trip && (
              <>
                <div className="text-xs text-gray-500">{formatDateTime(trip.departure_at)}</div>
                <div className="font-extrabold truncate">{trip.origin.address}</div>
                <div className="text-sm text-gray-600 truncate">→ {trip.destination.address}</div>
              </>
            )}
            <div className="text-sm text-gray-600">
              {t('carpool.seats', { n: booking.seats })} · {formatMoney(booking.price_total)}
            </div>
          </div>
          <Badge tone={carpoolTone(booking.status)}>{t(`carpool.bookingStatus.${booking.status}`)}</Badge>
        </div>
      </button>
      {Number(booking.cancellation_fee) > 0 && (
        <div className="text-xs text-alert mt-1">
          {t('rentals.cancelFee', { fee: formatMoney(booking.cancellation_fee) })}
        </div>
      )}
      {onCancel && booking.status === 'confirmed' && trip?.status === 'published' && (
        <Button variant="secondary" block className="mt-3 text-alert" loading={busy} onClick={onCancel}>
          {t('carpool.cancel')}
        </Button>
      )}
    </div>
  );
}
