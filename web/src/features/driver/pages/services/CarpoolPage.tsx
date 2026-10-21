import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { carpoolApi } from '@/shared/api/endpoints';
import type { CarpoolTrip, Place } from '@/shared/api/types';
import {
  Badge,
  Button,
  Empty,
  ErrorBox,
  MobilePage,
  Modal,
  Spinner,
  TextAreaField,
  TextField,
} from '@/shared/ui';
import { formatMoney } from '@/shared/utils/money';
import { formatDateTime } from '@/shared/utils/date';
import { toast } from '@/shared/store/ui';
import { AddressSearch } from '@/features/passenger/components/AddressSearch';
import { CarpoolTripCard, carpoolTone, useServicesLive } from '@/features/services/components';

function defaultDeparture(): string {
  const d = new Date(Date.now() + 2 * 3600_000);
  d.setMinutes(0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Conducteur : publication d'un trajet, suivi des réservations, démarrage et clôture. */
export default function DriverCarpoolPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  useServicesLive();
  const [publishOpen, setPublishOpen] = useState(false);
  const [origin, setOrigin] = useState<Place | null>(null);
  const [destination, setDestination] = useState<Place | null>(null);
  const [departure, setDeparture] = useState(defaultDeparture);
  const [seats, setSeats] = useState(3);
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const trips = useInfiniteQuery({
    queryKey: ['carpool', 'my', 'trips'],
    queryFn: ({ pageParam }) => carpoolApi.myTrips({ cursor: pageParam || undefined }),
    initialPageParam: '',
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const detail = useQuery({
    queryKey: ['carpool', 'trip', openId],
    queryFn: () => carpoolApi.trip(openId as string),
    enabled: !!openId,
  });
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['carpool'] });
    void qc.invalidateQueries({ queryKey: ['wallet'] });
  };
  const publish = useMutation({
    mutationFn: () =>
      carpoolApi.publish({
        origin: origin as Place,
        destination: destination as Place,
        departure_at: new Date(departure).toISOString(),
        seats_total: seats,
        price_per_seat: price || '0',
        description: description || undefined,
      }),
    onSuccess: () => {
      invalidate();
      setPublishOpen(false);
      setOrigin(null);
      setDestination(null);
      setPrice('');
      setDescription('');
      toast(t('carpool.published'), 'success');
    },
  });
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'start' | 'complete' | 'cancel' }) =>
      carpoolApi.act(id, action),
    onSuccess: () => {
      invalidate();
      setCancelOpen(false);
      toast(t('common.ok'), 'success');
    },
  });
  const items = trips.data?.pages.flatMap((p) => p.results) ?? [];
  const tr: CarpoolTrip | undefined = detail.data;
  const canPublish = !!origin && !!destination && !!departure && seats > 0;
  return (
    <MobilePage
      title={t('services.driverCarpool')}
      action={<Button onClick={() => setPublishOpen(true)}>{t('carpool.publish')}</Button>}
    >
      {trips.isPending ? (
        <div className="py-6 text-center text-brand">
          <Spinner />
        </div>
      ) : trips.error ? (
        <ErrorBox error={trips.error} onRetry={() => void trips.refetch()} />
      ) : items.length === 0 ? (
        <Empty text={t('carpool.noTrips')} />
      ) : (
        <div className="grid gap-3">
          {items.map((trip) => (
            <CarpoolTripCard key={trip.id} trip={trip} onOpen={() => setOpenId(trip.id)} />
          ))}
          {trips.hasNextPage && (
            <Button
              variant="secondary"
              block
              loading={trips.isFetchingNextPage}
              onClick={() => void trips.fetchNextPage()}
            >
              {t('common.loadMore')}
            </Button>
          )}
        </div>
      )}

      <Modal
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        title={t('carpool.publish')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPublishOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button loading={publish.isPending} disabled={!canPublish} onClick={() => publish.mutate()}>
              {t('carpool.form.submit')}
            </Button>
          </>
        }
      >
        <AddressSearch
          label={t('carpool.form.origin')}
          onSelect={(p) => setOrigin(p.lat !== undefined ? (p as Place) : null)}
        />
        {origin && <p className="text-xs text-brand-dark -mt-2 mb-2">✓ {origin.address}</p>}
        <AddressSearch
          label={t('carpool.form.destination')}
          onSelect={(p) => setDestination(p.lat !== undefined ? (p as Place) : null)}
        />
        {destination && <p className="text-xs text-brand-dark -mt-2 mb-2">✓ {destination.address}</p>}
        {!canPublish && (origin === null || destination === null) && (
          <p className="text-xs text-gray-500 mb-2">{t('carpool.form.missingPlaces')}</p>
        )}
        <TextField
          label={t('carpool.form.departure')}
          type="datetime-local"
          value={departure}
          onChange={(e) => setDeparture(e.target.value)}
        />
        <TextField
          label={t('carpool.form.seats')}
          type="number"
          min={1}
          max={8}
          value={seats}
          onChange={(e) => setSeats(Number(e.target.value) || 1)}
        />
        <TextField
          label={t('carpool.form.price')}
          type="number"
          inputMode="numeric"
          min={0}
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
        <TextAreaField
          label={t('carpool.form.description')}
          placeholder={t('carpool.form.descriptionPlaceholder')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <ErrorBox error={publish.error} />
      </Modal>

      <Modal open={!!openId} onClose={() => setOpenId(null)} title={t('carpool.title')}>
        {detail.isPending ? (
          <div className="py-6 text-center text-brand">
            <Spinner />
          </div>
        ) : tr ? (
          <>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-xs text-gray-500">{formatDateTime(tr.departure_at)}</div>
                <div className="font-extrabold">{tr.origin.address}</div>
                <div className="text-gray-700">→ {tr.destination.address}</div>
                <div className="text-sm text-gray-600 mt-1">
                  {t('carpool.perSeat', { price: formatMoney(tr.price_per_seat) })} · {tr.seats_booked}/
                  {tr.seats_total}
                </div>
              </div>
              <Badge tone={carpoolTone(tr.status)}>{t(`carpool.status.${tr.status}`)}</Badge>
            </div>
            <h3 className="font-extrabold mt-4 mb-1">{t('carpool.passengers')}</h3>
            {!tr.bookings?.length ? (
              <p className="text-sm text-gray-500">{t('carpool.noPassengers')}</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {tr.bookings.map((b) => (
                  <li key={b.id} className="py-2 flex items-center justify-between text-sm">
                    <span>
                      {b.passenger.first_name || '—'} · {t('carpool.seats', { n: b.seats })} ·{' '}
                      {formatMoney(b.price_total)}
                    </span>
                    <Badge tone={carpoolTone(b.status)}>{t(`carpool.bookingStatus.${b.status}`)}</Badge>
                  </li>
                ))}
              </ul>
            )}
            <div className="grid gap-2 mt-4">
              {tr.status === 'published' && (
                <Button
                  block
                  loading={act.isPending}
                  onClick={() => act.mutate({ id: tr.id, action: 'start' })}
                >
                  {t('carpool.start')}
                </Button>
              )}
              {tr.status === 'in_progress' && (
                <Button
                  block
                  loading={act.isPending}
                  onClick={() => act.mutate({ id: tr.id, action: 'complete' })}
                >
                  {t('carpool.complete')}
                </Button>
              )}
              {(tr.status === 'published' || tr.status === 'in_progress') && (
                <Button variant="secondary" block className="text-alert" onClick={() => setCancelOpen(true)}>
                  {t('carpool.cancelTrip')}
                </Button>
              )}
            </div>
            <ErrorBox error={act.error} />
          </>
        ) : (
          <ErrorBox error={detail.error ?? new Error('not found')} />
        )}
      </Modal>

      <Modal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title={t('carpool.cancelTrip')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCancelOpen(false)}>
              {t('common.back')}
            </Button>
            <Button
              variant="danger"
              loading={act.isPending}
              onClick={() => tr && act.mutate({ id: tr.id, action: 'cancel' })}
            >
              {t('common.confirm')}
            </Button>
          </>
        }
      >
        <p>{t('carpool.cancelTripHint')}</p>
      </Modal>
    </MobilePage>
  );
}
