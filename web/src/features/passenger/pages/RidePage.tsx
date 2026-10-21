import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MapView, type MapMarker, type MapRoute } from '@/shared/map';
import {
  Sheet,
  Button,
  Modal,
  TextAreaField,
  ErrorBox,
  EmergencyButton,
  EmergencySheet,
  ChatPanel,
  RatingForm,
  FullPageSpinner,
  Money,
  errorMessage,
  Badge,
  rideTone,
} from '@/shared/ui';
import { qk, useRide, useWallet } from '@/shared/api/hooks';
import { ridesApi } from '@/shared/api/endpoints';
import { useWsEvent } from '@/shared/ws';
import type { LatLng, Ride } from '@/shared/api/types';
import { formatDuration } from '@/shared/utils/geo';
import { formatDateTime, formatTime } from '@/shared/utils/date';
import { formatMoney } from '@/shared/utils/money';
import { beep, vibrate, shareOrCopy } from '@/shared/utils/device';
import { toast } from '@/shared/store/ui';
import { DriverCard } from '../components/DriverCard';
import { installPromptWasShown, isStandalone } from '@/pwa';
import { subscribePush } from '@/pwa/push';
import { ensureNotificationPermission, notify } from '@/shared/notify';

type Overlay = 'none' | 'chat' | 'cancel' | 'dispute' | 'sos';

export default function RidePage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data: ride, isPending, error, refetch, patch } = useRide(id);
  const wallet = useWallet();
  const [overlay, setOverlay] = useState<Overlay>('none');
  const [unread, setUnread] = useState(0);
  useWsEvent('chat.message', (m) => {
    if (m.ride_id !== id || m.sender_role === 'passenger' || overlay === 'chat') return;
    setUnread((n) => n + 1);
    notify(t('chat.newMessage'), m.body, { tag: `chat-${id}` });
  });
  useEffect(() => {
    void ensureNotificationPermission();
  }, []);
  const openChat = () => {
    setUnread(0);
    setOverlay('chat');
  };
  const [driverPos, setDriverPos] = useState<
    (LatLng & { heading?: number | null; eta_s?: number | null }) | null
  >(null);
  const [deviation, setDeviation] = useState<{ distance_off_m: number; police: string } | null>(null);
  const [positionLostSince, setPositionLostSince] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [rated, setRated] = useState(false);

  useEffect(() => {
    if (ride?.driver?.location) setDriverPos(ride.driver.location);
    if (ride?.deviation?.active)
      setDeviation({ distance_off_m: ride.deviation.distance_off_m, police: ride.zone.emergency_police });
    else if (ride && !ride.deviation?.active) setDeviation(null);
  }, [ride]);

  useWsEvent('ride.driver_position', (d) => {
    if (d.ride_id === id) setDriverPos({ lat: d.lat, lng: d.lng, heading: d.heading, eta_s: d.eta_s });
  });
  useWsEvent('ride.deviation_alert', (d) => {
    if (d.ride_id !== id) return;
    setDeviation({
      distance_off_m: d.distance_off_m,
      police: d.emergency_numbers?.police ?? ride?.zone.emergency_police ?? '117',
    });
    vibrate([300, 150, 300, 150, 300]);
    beep(3);
  });
  useWsEvent('ride.deviation_cleared', (d) => {
    if (d.ride_id !== id) return;
    setDeviation(null);
    toast(t('passenger.trip.deviationCleared'), 'success');
  });
  useWsEvent('ride.position_lost', (d) => d.ride_id === id && setPositionLostSince(d.since));
  useWsEvent('ride.position_restored', (d) => {
    if (d.ride_id !== id) return;
    setPositionLostSince(null);
    toast(t('passenger.trip.positionRestored'), 'success');
  });
  useWsEvent('ride.cancelled', (d) => {
    if (d.ride_id === id && d.by !== 'passenger') toast(t('status.cancelled_by_driver'), 'error');
  });

  // Invite d'installation PWA après la première course terminée (F-N-03)
  useEffect(() => {
    if (ride?.status === 'completed' && !isStandalone() && !installPromptWasShown()) {
      const timer = setTimeout(() => nav('/install'), 1500);
      void subscribePush();
      return () => clearTimeout(timer);
    }
  }, [ride?.status, nav]);

  const cancel = useMutation({
    mutationFn: () => ridesApi.cancel(id as string, reason || 'passenger'),
    onSuccess: (r) => {
      qc.setQueryData(qk.ride(r.id), r);
      void qc.invalidateQueries({ queryKey: qk.activeRide });
      void qc.invalidateQueries({ queryKey: qk.wallet });
      setOverlay('none');
    },
  });
  const retry = useMutation({
    mutationFn: () => ridesApi.retry(id as string),
    onSuccess: (r) => {
      qc.setQueryData(qk.ride(r.id), r);
      void qc.invalidateQueries({ queryKey: qk.activeRide });
      toast(t('passenger.searching.retried'), 'success');
    },
  });
  const dispute = useMutation({
    mutationFn: () => ridesApi.dispute(id as string, reason),
    onSuccess: (d) => {
      patch({ dispute: d });
      toast(t('passenger.done.disputeSent'), 'success');
      setOverlay('none');
    },
  });
  const confirmArrival = useMutation({
    mutationFn: () => ridesApi.confirmArrival(id as string),
    onSuccess: (r) => qc.setQueryData(qk.ride(r.id), r),
  });

  const markers = useMemo<MapMarker[]>(() => {
    if (!ride) return [];
    const list: MapMarker[] = [
      { id: 'pickup', ...ride.pickup, kind: 'pickup', label: t('passenger.home.pickup') },
      { id: 'dropoff', ...ride.dropoff, kind: 'dropoff', label: t('passenger.home.dropoff') },
    ];
    if (driverPos && ['accepted', 'arrived', 'in_progress'].includes(ride.status)) {
      list.push({
        id: 'driver',
        lat: driverPos.lat,
        lng: driverPos.lng,
        heading: driverPos.heading,
        kind: 'driver',
        label: t('roles.driver'),
      });
    }
    return list;
  }, [ride, driverPos, t]);
  const routes = useMemo<MapRoute[]>(
    () => (ride?.planned_route?.length ? [{ id: 'planned', coords: ride.planned_route }] : []),
    [ride?.planned_route],
  );
  const fit = useMemo<LatLng[]>(
    () => (ride ? [ride.pickup, ride.dropoff, ...(driverPos ? [driverPos] : [])] : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ride?.id, ride?.status],
  );

  if (isPending) return <FullPageSpinner />;
  if (error || !ride)
    return (
      <div className="p-4">
        <ErrorBox error={error ?? new Error('not found')} onRetry={() => void refetch()} />
      </div>
    );

  const status = ride.status;
  const searching = status === 'requested' || status === 'dispatching';
  const found = status === 'accepted' || status === 'arrived';
  const inTrip = status === 'in_progress';
  const done = status === 'completed';
  const noDriver = status === 'no_driver';
  const ended = status.startsWith('cancelled');
  const eta = driverPos?.eta_s ?? null;

  async function share() {
    try {
      const s =
        ride &&
        (ride.share_token
          ? { url: `${window.location.origin}/share/${ride.share_token}` }
          : await ridesApi.share(ride.id));
      if (!s) return;
      const res = await shareOrCopy({
        title: t('app.name'),
        text: t('passenger.trip.shareText'),
        url: s.url,
      });
      if (res === 'copied') toast(t('passenger.trip.shared'), 'success');
    } catch (e) {
      toast(errorMessage(e, t), 'error');
    }
  }

  return (
    <div className="absolute inset-0">
      <MapView
        showNavigation={false}
        markers={markers}
        routes={routes}
        fit={fit}
        fitKey={`${ride.id}-${status}`}
        follow={inTrip}
      />
      <div className="absolute top-3 right-3 z-10 flex gap-2">
        <EmergencyButton onClick={() => setOverlay('sos')} />
      </div>
      {deviation && (
        <div
          className="absolute top-3 left-3 right-3 z-30 mr-[140px] sm:mr-3 rounded-2xl bg-alert text-white p-4 shadow-xl"
          role="alert"
          aria-live="assertive"
        >
          <div className="font-extrabold text-lg">{t('passenger.trip.deviationTitle')}</div>
          <div className="text-sm mb-3">
            {t('passenger.trip.deviationBody', { distance: `${Math.round(deviation.distance_off_m)} m` })}
          </div>
          <div className="grid gap-2">
            <button type="button" className="btn bg-white text-alert" onClick={openChat}>
              {t('passenger.trip.write')}
            </button>
            <a
              className="btn bg-white text-alert"
              href={`tel:${deviation.police}`}
              onClick={() => void ridesApi.emergency(ride.id, deviation.police, driverPos)}
            >
              {t('passenger.trip.call117', { n: deviation.police })}
            </a>
            <button type="button" className="btn bg-white text-alert" onClick={() => void share()}>
              {t('passenger.trip.share')}
            </button>
          </div>
        </div>
      )}
      {positionLostSince && !deviation && (
        <div
          className="absolute top-3 left-3 z-30 mr-[140px] rounded-xl bg-slate text-white px-3 py-2 text-sm"
          role="status"
        >
          {t('passenger.trip.positionLost', { time: formatTime(positionLostSince) })}
        </div>
      )}
      {ride.detour_until && new Date(ride.detour_until).getTime() > Date.now() && !deviation && (
        <div
          className="absolute top-16 left-3 z-30 mr-[140px] rounded-xl bg-code-light px-3 py-2 text-sm"
          role="status"
        >
          {t('passenger.trip.detour')}
        </div>
      )}

      <Sheet collapsible={!searching}>
        {searching && (
          <div className="text-center py-4">
            <div
              className="mx-auto mb-4 h-16 w-16 rounded-full border-4 border-brand border-t-transparent animate-spin"
              aria-hidden="true"
            />
            <h2 className="text-xl font-extrabold">{t('passenger.searching.title')}</h2>
            <p className="text-gray-600 mb-4">{t('passenger.searching.subtitle')}</p>
            <p className="text-sm text-gray-500 mb-4">
              {ride.pickup.address} → {ride.dropoff.address}
            </p>
            <Button
              variant="secondary"
              block
              loading={cancel.isPending}
              onClick={() => {
                setReason('passenger_cancelled_before_accept');
                cancel.mutate();
              }}
            >
              {t('passenger.searching.cancelFree')}
            </Button>
            {cancel.error && <p className="text-sm text-alert mt-2">{errorMessage(cancel.error, t)}</p>}
          </div>
        )}

        {found && ride.driver && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-xl font-extrabold">
                {status === 'arrived' ? t('passenger.found.arrived') : t('passenger.found.title')}
              </h2>
              {eta !== null && status === 'accepted' && (
                <Badge tone="green">{t('passenger.found.arriving', { eta: formatDuration(eta) })}</Badge>
              )}
            </div>
            <DriverCard driver={ride.driver} />
            {ride.otp_code && (
              <div
                className="mt-4 rounded-2xl bg-code p-4 text-center"
                aria-label={t('passenger.found.code')}
              >
                <div className="text-sm font-semibold text-yellow-900">{t('passenger.found.code')}</div>
                <div
                  className="text-6xl font-extrabold tracking-[0.3em] text-ink tabular-nums"
                  data-testid="otp-code"
                >
                  {ride.otp_code}
                </div>
                <div className="text-xs text-yellow-900 mt-1">{t('passenger.found.codeHint')}</div>
              </div>
            )}
            {status === 'arrived' && (
              <p className="mt-2 text-sm text-gray-600">{t('passenger.found.waitingHint')}</p>
            )}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button variant="secondary" className="relative" onClick={openChat}>
                {t('passenger.trip.write')}
                {unread > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-alert text-white text-xs font-extrabold flex items-center justify-center">
                    {unread}
                  </span>
                )}
              </Button>
              <Button variant="secondary" onClick={() => void share()}>
                {t('passenger.trip.share')}
              </Button>
            </div>
            <Button variant="ghost" block className="mt-2 text-alert" onClick={() => setOverlay('cancel')}>
              {t('passenger.found.cancelWithFee')}
            </Button>
          </div>
        )}

        {inTrip && (
          <div>
            <h2 className="text-xl font-extrabold">{t('passenger.trip.title')}</h2>
            <p className="text-gray-600">{t('passenger.trip.toward', { address: ride.dropoff.address })}</p>
            {eta !== null && (
              <p className="font-semibold text-brand-dark mt-1">
                {t('passenger.trip.eta', { eta: formatDuration(eta) })}
              </p>
            )}
            {ride.driver && (
              <div className="mt-3">
                <DriverCard driver={ride.driver} />
              </div>
            )}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button variant="secondary" className="relative" onClick={openChat}>
                {t('passenger.trip.write')}
                {unread > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-alert text-white text-xs font-extrabold flex items-center justify-center">
                    {unread}
                  </span>
                )}
              </Button>
              <Button variant="secondary" onClick={() => void share()}>
                {t('passenger.trip.share')}
              </Button>
            </div>
            <Button
              variant="ghost"
              block
              className="mt-2"
              loading={confirmArrival.isPending}
              onClick={() => confirmArrival.mutate()}
            >
              {t('passenger.trip.confirmArrival')}
            </Button>
            <p className="text-xs text-gray-500 text-center">{t('passenger.trip.confirmArrivalHint')}</p>
          </div>
        )}

        {done && (
          <div>
            <h2 className="text-xl font-extrabold mb-2">{t('passenger.done.title')}</h2>
            <div className="rounded-2xl bg-brand-light p-4 mb-3">
              <div className="flex justify-between">
                <span>{t('passenger.done.finalPrice')}</span>
                <Money value={ride.final_price} className="font-extrabold text-xl" />
              </div>
              {ride.payment_method === 'wallet' && (
                <div className="flex justify-between text-sm mt-1">
                  <span>{t('passenger.done.newBalance')}</span>
                  <Money value={wallet.data?.available} />
                </div>
              )}
              {ride.payment_method === 'cash' && <div className="text-sm mt-1">{t('payment.cash')}</div>}
            </div>
            {!rated && !ride.my_rating ? (
              <RatingForm
                rideId={ride.id}
                title={t('passenger.done.rate')}
                onDone={(score, comment) => {
                  setRated(true);
                  patch({ my_rating: { score, comment } });
                }}
              />
            ) : (
              <p className="text-brand-dark font-semibold mb-3">{t('passenger.done.rated')}</p>
            )}
            {ride.dispute ? (
              <p className="text-sm text-gray-600 mt-3">{t('passenger.done.disputeSent')}</p>
            ) : ride.dispute_deadline_at && new Date(ride.dispute_deadline_at).getTime() > Date.now() ? (
              <div className="mt-3">
                <Button variant="secondary" block onClick={() => setOverlay('dispute')}>
                  {t('passenger.done.dispute')}
                </Button>
                <p className="text-xs text-gray-500 text-center mt-1">
                  {t('passenger.done.disputeUntil', { date: formatDateTime(ride.dispute_deadline_at) })}
                </p>
              </div>
            ) : null}
            <Button variant="ghost" block className="mt-2" onClick={() => nav('/p', { replace: true })}>
              {t('passenger.done.home')}
            </Button>
          </div>
        )}

        {noDriver && (
          <div className="text-center py-2">
            <Badge tone={rideTone(status)}>{t(`status.${status}`)}</Badge>
            <h2 className="text-xl font-extrabold mt-2">{t('passenger.searching.noDriver')}</h2>
            <p className="text-gray-600 mt-1 text-sm">
              {ride.pickup.address} → {ride.dropoff.address}
            </p>
            <p className="text-gray-600 mt-2 text-sm">
              {t('passenger.searching.noDriverHint', { amount: formatMoney(ride.reserved_amount) })}
            </p>
            <Button block className="mt-4" loading={retry.isPending} onClick={() => retry.mutate()}>
              {t('passenger.searching.retry')}
            </Button>
            <Button
              variant="secondary"
              block
              className="mt-2"
              loading={cancel.isPending}
              onClick={() => {
                setReason('passenger_cancelled_no_driver');
                cancel.mutate();
              }}
            >
              {t('passenger.searching.cancelRefund')}
            </Button>
            <ErrorBox error={retry.error ?? cancel.error} />
          </div>
        )}

        {ended && (
          <div className="text-center py-2">
            <Badge tone={rideTone(status)}>{t(`status.${status}`)}</Badge>
            <h2 className="text-xl font-extrabold mt-2">{t('passenger.done.cancelled')}</h2>
            {ride.cancellation_fee && Number(ride.cancellation_fee) > 0 && (
              <p className="text-gray-600 mt-1">
                {t('passenger.done.cancelFee', { fee: formatMoney(ride.cancellation_fee) })}
              </p>
            )}
            {ride.cancel_reason?.startsWith('Annulation automatique') && (
              <p className="text-gray-600 mt-1 text-sm">{t('passenger.searching.autoCancelled')}</p>
            )}
            <Button block className="mt-4" onClick={() => nav('/p', { replace: true })}>
              {t('passenger.done.home')}
            </Button>
          </div>
        )}
      </Sheet>

      <Modal open={overlay === 'chat'} onClose={() => setOverlay('none')} title={t('chat.title')}>
        <ChatPanel rideId={ride.id} me="passenger" />
      </Modal>
      <Modal
        open={overlay === 'cancel'}
        onClose={() => setOverlay('none')}
        title={t('passenger.found.cancelFeeTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOverlay('none')}>
              {t('common.back')}
            </Button>
            <Button variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate()}>
              {t('passenger.found.cancelConfirm', { fee: formatMoney(ride.cancellation_fee_preview ?? '0') })}
            </Button>
          </>
        }
      >
        <p className="mb-3">
          {t('passenger.found.cancelFeeBody', { fee: formatMoney(ride.cancellation_fee_preview ?? '0') })}
        </p>
        <TextAreaField
          label={t('passenger.found.cancelReason')}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <ErrorBox error={cancel.error} />
      </Modal>
      <Modal
        open={overlay === 'dispute'}
        onClose={() => setOverlay('none')}
        title={t('passenger.done.disputeTitle')}
        footer={
          <Button
            loading={dispute.isPending}
            disabled={reason.trim().length < 5}
            onClick={() => dispute.mutate()}
          >
            {t('common.send')}
          </Button>
        }
      >
        <TextAreaField
          label={t('common.reason')}
          hint={t('passenger.done.disputeHint')}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <ErrorBox error={dispute.error} />
      </Modal>
      <EmergencySheet
        open={overlay === 'sos'}
        onClose={() => setOverlay('none')}
        zone={ride.zone}
        rideId={ride.id}
      />
    </div>
  );
}

export type { Ride };
