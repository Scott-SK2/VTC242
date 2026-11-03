import { useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { adminApi } from '@/shared/api/endpoints';
import { useWsEvent } from '@/shared/ws';
import type { AdminRide } from '@/shared/api/types';
import { MapView, type MapMarker, type MapRoute } from '@/shared/map';
import { AdminPage, Stat } from '../components';
import {
  Badge,
  Button,
  rideTone,
  FullPageSpinner,
  ErrorBox,
  Modal,
  Money,
  TextAreaField,
  TextField,
} from '@/shared/ui';
import { formatMoney } from '@/shared/utils/money';
import { toast } from '@/shared/store/ui';
import { formatDateTime } from '@/shared/utils/date';
import { formatDistance, formatDuration } from '@/shared/utils/geo';
import { SupportChat } from '../components/SupportChat';
import { useAuthStore } from '@/shared/store/auth';

/** Fiche course : trajet prévu / réel sur carte, chronologie, messages. */
export default function RideDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const role = useAuthStore((s) => s.user?.role);
  const q = useQuery({
    queryKey: ['admin', 'ride', id],
    queryFn: () => adminApi.ride(id as string),
    enabled: !!id,
  });
  useWsEvent('ride.status_updated', (r) => {
    if (r.id === id)
      qc.setQueryData<AdminRide>(['admin', 'ride', id], (old) => (old ? { ...old, ...r } : old));
  });
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const refund = useMutation({
    mutationFn: () => adminApi.refundRide(id as string, refundAmount, refundReason),
    onSuccess: (r) => {
      qc.setQueryData(['admin', 'ride', id], r);
      setRefundOpen(false);
      setRefundReason('');
      toast(t('admin.rides.refunded', { amount: formatMoney(refundAmount) }), 'success');
    },
  });
  const ride = q.data;
  const actual = useMemo(
    () =>
      ride?.actual_route ??
      (ride?.positions?.length ? ride.positions.map((p) => [p.lng, p.lat] as [number, number]) : null),
    [ride],
  );
  const routes = useMemo<MapRoute[]>(() => {
    const list: MapRoute[] = [];
    if (ride?.planned_route?.length)
      list.push({ id: 'planned', coords: ride.planned_route, color: '#1E9B45' });
    if (actual?.length) list.push({ id: 'actual', coords: actual, color: '#C8202C', dashed: true });
    return list;
  }, [ride, actual]);
  if (q.isPending) return <FullPageSpinner />;
  if (q.error || !ride)
    return (
      <div className="p-6">
        <ErrorBox error={q.error} onRetry={() => void q.refetch()} />
      </div>
    );
  const markers: MapMarker[] = [
    { id: 'pickup', ...ride.pickup, kind: 'pickup', label: t('passenger.home.pickup') },
    { id: 'dropoff', ...ride.dropoff, kind: 'dropoff', label: t('passenger.home.dropoff') },
  ];
  if (ride.driver?.location)
    markers.push({ id: 'driver', ...ride.driver.location, kind: 'driver', label: t('roles.driver') });
  return (
    <AdminPage
      title={`${t('admin.alerts.ride')} ${ride.id.slice(0, 8)}`}
      actions={<Badge tone={rideTone(ride.status)}>{t(`status.${ride.status}`)}</Badge>}
    >
      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <div className="h-[45vh] min-h-[320px] rounded-2xl overflow-hidden border border-gray-200 relative">
            <MapView markers={markers} routes={routes} fit={[ride.pickup, ride.dropoff]} fitKey={ride.id} />
            <div className="absolute bottom-2 left-2 bg-white/90 rounded-lg px-2 py-1 text-xs flex gap-3">
              <span>
                <span className="inline-block w-4 h-1 bg-brand align-middle mr-1" />
                {t('admin.rides.planned')}
              </span>
              <span>
                <span className="inline-block w-4 h-1 bg-alert align-middle mr-1" />
                {t('admin.rides.actual')}
                {!actual?.length ? ` (${t('admin.rides.noRoute')})` : ''}
              </span>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="card">
              <h2 className="font-extrabold mb-2">{t('admin.rides.timeline')}</h2>
              <Stat label={t('status.requested')}>{formatDateTime(ride.requested_at)}</Stat>
              <Stat label={t('status.accepted')}>{formatDateTime(ride.accepted_at)}</Stat>
              <Stat label={t('status.arrived')}>{formatDateTime(ride.arrived_at)}</Stat>
              <Stat label={t('status.in_progress')}>{formatDateTime(ride.started_at)}</Stat>
              <Stat label={t('status.completed')}>{formatDateTime(ride.completed_at)}</Stat>
              {ride.cancelled_at && (
                <Stat label={t('common.cancel')}>
                  {formatDateTime(ride.cancelled_at)} · {ride.cancel_reason}
                </Stat>
              )}
            </div>
            <div className="card">
              <h2 className="font-extrabold mb-2">{t('common.price')}</h2>
              <Stat label={t('common.category')}>
                {t(`categories.${ride.category}`)} · {t(`payment.${ride.payment_method}`)}
              </Stat>
              <Stat label={t('common.distance')}>
                {formatDistance(ride.planned_distance_m)} · {formatDuration(ride.planned_duration_s)}
              </Stat>
              <Stat label={t('passenger.estimate.range')}>
                <Money value={ride.estimated_price_min} /> – <Money value={ride.estimated_price_max} />
              </Stat>
              <Stat label={t('passenger.done.finalPrice')}>
                <Money value={ride.final_price} />
              </Stat>
              <Stat label={t('driver.ride.commission')}>
                <Money value={ride.commission_amount} />
              </Stat>
              <Stat label={t('driver.ride.net')}>
                <Money value={ride.driver_earning} />
              </Stat>
              <Stat label="Attente / trajet">
                {formatDuration(ride.waiting_seconds)} / {formatDuration(ride.ride_seconds)}
              </Stat>
              {ride.charged_amount != null && (
                <Stat label={t('admin.rides.charged')}>
                  <Money value={ride.charged_amount} />
                </Stat>
              )}
              {ride.refunded_amount != null && Number(ride.refunded_amount) > 0 && (
                <Stat label={t('admin.rides.refundedTotal')}>
                  <Money value={ride.refunded_amount} />
                </Stat>
              )}
              {ride.charged_amount != null &&
                (role === 'admin' || role === 'finance') &&
                Number(ride.charged_amount) - Number(ride.refunded_amount ?? 0) > 0 && (
                  <Button
                    variant="secondary"
                    block
                    className="mt-2"
                    onClick={() => {
                      const max = Number(ride.charged_amount) - Number(ride.refunded_amount ?? 0);
                      const over = Number(ride.charged_amount) - Number(ride.estimated_price_max);
                      setRefundAmount(String(Math.max(0, Math.min(max, over > 0 ? over : max))));
                      setRefundOpen(true);
                    }}
                  >
                    {t('admin.rides.refund')}
                  </Button>
                )}
              {ride.dispute && (
                <Stat label={t('nav.disputes')}>
                  <Link to={`/admin/disputes/${ride.dispute.id}`} className="underline">
                    {ride.dispute.status}
                  </Link>
                </Stat>
              )}
            </div>
          </div>
          <div className="card">
            <h2 className="font-extrabold mb-2">{t('admin.rides.events')}</h2>
            <ul className="text-sm divide-y divide-gray-100 max-h-72 overflow-y-auto">
              {(ride.events ?? []).map((e, i) => (
                <li key={e.id ?? i} className="py-1 flex gap-3">
                  <span className="text-gray-500 w-36 shrink-0">{formatDateTime(e.occurred_at)}</span>
                  <span className="font-semibold">{e.event_type}</span>
                  {e.payload && (
                    <code className="text-xs text-gray-500 truncate">{JSON.stringify(e.payload)}</code>
                  )}
                </li>
              ))}
              {!ride.events?.length && <li className="py-2 text-gray-500">{t('common.empty')}</li>}
            </ul>
          </div>
        </div>
        <div className="space-y-4">
          <div className="card">
            <h2 className="font-extrabold mb-2">{t('admin.rides.passenger')}</h2>
            <Stat label={t('common.name')}>
              {ride.passenger?.first_name ?? '—'} {ride.passenger?.last_initial ?? ''}
            </Stat>
            <Stat label={t('common.phone')}>{ride.passenger_phone ?? '—'}</Stat>
            <Stat label={t('passenger.home.pickup')}>{ride.pickup.address}</Stat>
            <Stat label={t('passenger.home.dropoff')}>{ride.dropoff.address}</Stat>
          </div>
          <div className="card">
            <h2 className="font-extrabold mb-2">{t('admin.rides.driver')}</h2>
            <Stat label={t('common.name')}>{ride.driver?.first_name ?? '—'}</Stat>
            <Stat label={t('common.phone')}>{ride.driver_phone ?? '—'}</Stat>
            {ride.driver?.vehicle && (
              <Stat label={t('driver.profile.vehicle')}>
                {ride.driver.vehicle.brand} {ride.driver.vehicle.model} · {ride.driver.vehicle.license_plate}
              </Stat>
            )}
            {ride.driver && <Stat label={t('admin.drivers.rating')}>★ {ride.driver.rating ?? '—'}</Stat>}
          </div>
          <div className="card">
            <h2 className="font-extrabold mb-2">{t('admin.rides.messages')}</h2>
            {role === 'support' || role === 'admin' ? (
              <SupportChat rideId={ride.id} />
            ) : (
              <ul className="text-sm space-y-1">
                {(ride.messages ?? []).map((m) => (
                  <li key={m.id}>
                    <span className="text-gray-500">
                      {formatDateTime(m.sent_at)} · {t(`chat.sender.${m.sender_role}`)}
                    </span>{' '}
                    : {m.body}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
      <Modal
        open={refundOpen}
        onClose={() => setRefundOpen(false)}
        title={t('admin.rides.refundTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRefundOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              loading={refund.isPending}
              disabled={!(Number(refundAmount) > 0) || !refundReason.trim()}
              onClick={() => refund.mutate()}
            >
              {t('admin.rides.refundConfirm', { amount: formatMoney(refundAmount || 0) })}
            </Button>
          </>
        }
      >
        <p className="text-sm text-gray-600 mb-3">
          {t('admin.rides.refundHint', {
            charged: formatMoney(ride.charged_amount ?? 0),
            max: formatMoney(Number(ride.charged_amount ?? 0) - Number(ride.refunded_amount ?? 0)),
          })}
        </p>
        <TextField
          label={t('common.amount')}
          type="number"
          inputMode="numeric"
          min={1}
          value={refundAmount}
          onChange={(e) => setRefundAmount(e.target.value)}
        />
        <TextAreaField
          label={t('common.reason')}
          value={refundReason}
          onChange={(e) => setRefundReason(e.target.value)}
        />
        <ErrorBox error={refund.error} />
      </Modal>
    </AdminPage>
  );
}
