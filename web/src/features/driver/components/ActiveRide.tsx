import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Ride } from '@/shared/api/types';
import { ridesApi } from '@/shared/api/endpoints';
import { isApiError } from '@/shared/api/client';
import { qk } from '@/shared/api/hooks';
import {
  Button,
  Modal,
  TextAreaField,
  ChatPanel,
  RatingForm,
  Money,
  ErrorBox,
  errorMessage,
  Avatar,
  EmergencySheet,
  TripTimer,
} from '@/shared/ui';
import type { GeoFix } from '@/shared/utils/geolocation';
import { distanceM, formatDistance, googleMapsUrl } from '@/shared/utils/geo';
import { formatMoney } from '@/shared/utils/money';
import { formatTime } from '@/shared/utils/date';
import { toast } from '@/shared/store/ui';
import { useWsEvent } from '@/shared/ws';
import { notify } from '@/shared/notify';
import { useGeoSimStore } from '@/shared/store/geoSim';

const RADIUS_M = 200;
type Overlay = 'none' | 'chat' | 'detour' | 'cancel' | 'sos';

/** Panneau de course active côté chauffeur (F-34 à F-39). */
export function ActiveRide({
  ride,
  fix,
  onFinished,
}: {
  ride: Ride;
  fix: GeoFix | null;
  onFinished: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [overlay, setOverlay] = useState<Overlay>('none');
  const [otp, setOtp] = useState('');
  const [otpError, setOtpError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [rated, setRated] = useState(false);
  const [unread, setUnread] = useState(0);
  const simEnabled = useGeoSimStore((s) => s.enabled);
  const moveSim = useGeoSimStore((s) => s.move);
  const pos = fix ? { lat: fix.lat, lng: fix.lng } : null;
  useWsEvent('chat.message', (m) => {
    if (m.ride_id !== ride.id || m.sender_role === 'driver') return;
    if (overlay === 'chat') return;
    setUnread((n) => n + 1);
    notify(t('chat.newMessage'), m.body, { tag: `chat-${ride.id}` });
  });
  const openChat = () => {
    setUnread(0);
    setOverlay('chat');
  };
  const setRide = (r: Ride) => {
    qc.setQueryData(qk.ride(r.id), r);
    qc.setQueryData(
      qk.activeRide,
      ['completed', 'cancelled_by_driver', 'cancelled_by_passenger', 'no_driver'].includes(r.status)
        ? null
        : r,
    );
  };

  const arrive = useMutation({
    mutationFn: () => ridesApi.arrive(ride.id, pos as { lat: number; lng: number }),
    onSuccess: setRide,
  });
  const start = useMutation({
    mutationFn: () => ridesApi.start(ride.id, otp, pos ?? { lat: ride.pickup.lat, lng: ride.pickup.lng }),
    onSuccess: (r) => {
      setRide(r);
      setOtp('');
      setOtpError(null);
    },
    onError: (e) => {
      if (isApiError(e) && e.status === 423) setOtpError(t('driver.ride.locked'));
      else if (isApiError(e) && e.code === 'invalid_otp')
        setOtpError(t('driver.ride.invalidCode', { left: String(e.details.attempts_left ?? '?') }));
      else setOtpError(errorMessage(e, t));
      setOtp('');
    },
  });
  const detour = useMutation({
    mutationFn: () => ridesApi.detour(ride.id, reason || 'road_closed'),
    onSuccess: (r) => {
      setRide(r);
      toast(t('driver.ride.detourSent'), 'success');
      setOverlay('none');
    },
  });
  const complete = useMutation({
    mutationFn: () => ridesApi.complete(ride.id, pos as { lat: number; lng: number }),
    onSuccess: setRide,
  });
  const cancel = useMutation({
    mutationFn: () => ridesApi.cancel(ride.id, reason || 'driver'),
    onSuccess: (r) => {
      setRide(r);
      setOverlay('none');
    },
  });

  const toPickup = pos ? distanceM(pos, ride.pickup) : null;
  const toDropoff = pos ? distanceM(pos, ride.dropoff) : null;
  const canArrive = toPickup !== null && toPickup <= RADIUS_M;
  const canComplete = toDropoff !== null && toDropoff <= RADIUS_M;
  const tooFar = (e: unknown) => isApiError(e) && e.status === 422;
  const p = ride.passenger;

  return (
    <div>
      {p && (
        <div className="flex items-center gap-3 mb-3">
          <Avatar name={p.first_name} size={48} />
          <div>
            <div className="font-extrabold">
              {p.first_name} {p.last_initial ? `${p.last_initial}.` : ''}
            </div>
            <div className="text-sm text-gray-600">
              ★ {p.rating?.toFixed(1) ?? '—'} · {t('driver.ride.passenger')}
            </div>
          </div>
          <div className="ml-auto flex gap-2">
            <Button
              variant="secondary"
              className="px-3 relative"
              onClick={openChat}
              aria-label={t('chat.title')}
            >
              💬
              {unread > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-alert text-white text-xs font-extrabold flex items-center justify-center">
                  {unread}
                </span>
              )}
            </Button>
            <Button
              variant="danger"
              className="px-3"
              onClick={() => setOverlay('sos')}
              aria-label={t('emergency.button')}
            >
              SOS
            </Button>
          </div>
        </div>
      )}

      {simEnabled && (ride.status === 'accepted' || ride.status === 'in_progress') && (
        <button
          type="button"
          className="w-full rounded-xl bg-code px-3 py-2 mb-3 text-sm font-semibold text-ink"
          onClick={() => moveSim(ride.status === 'accepted' ? ride.pickup : ride.dropoff)}
        >
          {ride.status === 'accepted' ? t('geoSim.goToPickup') : t('geoSim.goToDropoff')}
        </button>
      )}
      {(ride.status === 'accepted' || ride.status === 'arrived') && (
        <div>
          <div className="text-sm text-gray-500">{t('driver.offer.pickup')}</div>
          <div className="font-extrabold mb-2">{ride.pickup.address}</div>
          <a
            className="btn-secondary w-full mb-3"
            href={googleMapsUrl(ride.pickup, pos)}
            target="_blank"
            rel="noopener noreferrer"
          >
            🧭 {t('driver.ride.openMaps')} · {t('driver.ride.navigateToPickup')}
          </a>
          {ride.status === 'accepted' ? (
            <>
              <Button
                block
                className="min-h-[56px]"
                disabled={!canArrive}
                loading={arrive.isPending}
                onClick={() => arrive.mutate()}
              >
                {t('driver.ride.arrived')}
              </Button>
              <p className="text-xs text-gray-500 text-center mt-1">
                {t('driver.ride.arrivedHint', { distance: formatDistance(toPickup) })}
              </p>
              {arrive.error && (
                <p className="text-sm text-alert text-center" role="alert">
                  {tooFar(arrive.error) ? t('driver.ride.tooFar') : errorMessage(arrive.error, t)}
                </p>
              )}
            </>
          ) : (
            <div className="rounded-2xl border-2 border-code p-4">
              <TripTimer ride={ride} className="mb-3" />
              <div className="font-extrabold">{t('driver.ride.codeTitle')}</div>
              <p className="text-sm text-gray-600 mb-2">
                {t('driver.ride.codeHint')}{' '}
                {ride.arrived_at &&
                  `· ${t('driver.ride.waitingSince', { time: formatTime(ride.arrived_at) })}`}
              </p>
              <input
                className="input text-center text-3xl tracking-[0.5em] font-extrabold mb-2"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={4}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 4))}
                aria-label={t('driver.ride.codeTitle')}
                disabled={ride.otp_locked}
                data-testid="otp-input"
              />
              {otpError && (
                <p className="text-sm text-alert mb-2" role="alert">
                  {otpError}
                </p>
              )}
              {ride.otp_locked && !otpError && (
                <p className="text-sm text-alert mb-2" role="alert">
                  {t('driver.ride.locked')}
                </p>
              )}
              <Button
                block
                className="min-h-[56px]"
                disabled={otp.length !== 4 || ride.otp_locked}
                loading={start.isPending}
                onClick={() => start.mutate()}
              >
                {t('driver.ride.start')}
              </Button>
            </div>
          )}
          <Button variant="ghost" block className="mt-2 text-alert" onClick={() => setOverlay('cancel')}>
            {t('driver.ride.cancel')}
          </Button>
        </div>
      )}

      {ride.status === 'in_progress' && (
        <div>
          <div className="text-sm text-gray-500">{t('driver.offer.dropoff')}</div>
          <div className="font-extrabold mb-2">{ride.dropoff.address}</div>
          <a
            className="btn-secondary w-full mb-3"
            href={googleMapsUrl(ride.dropoff, pos)}
            target="_blank"
            rel="noopener noreferrer"
          >
            🧭 {t('driver.ride.openMaps')} · {t('driver.ride.navigateToDropoff')}
          </a>
          <TripTimer ride={ride} className="mb-3" />
          {ride.payment_method === 'cash' && (
            <p className="rounded-xl bg-code-light p-3 text-sm mb-2">
              {t('driver.ride.cash', {
                amount: `${formatMoney(ride.estimated_price_min)} – ${formatMoney(ride.estimated_price_max)}`,
              })}
            </p>
          )}
          <Button
            block
            className="min-h-[56px]"
            disabled={!canComplete}
            loading={complete.isPending}
            onClick={() => complete.mutate()}
          >
            {t('driver.ride.complete')}
          </Button>
          <p className="text-xs text-gray-500 text-center mt-1">
            {t('driver.ride.completeHint', { distance: formatDistance(toDropoff) })}
          </p>
          {complete.error && (
            <p className="text-sm text-alert text-center" role="alert">
              {tooFar(complete.error) ? t('driver.ride.tooFar') : errorMessage(complete.error, t)}
            </p>
          )}
          <Button variant="secondary" block className="mt-2" onClick={() => setOverlay('detour')}>
            {t('driver.ride.detour')}
          </Button>
        </div>
      )}

      {ride.status === 'completed' && (
        <div>
          <h2 className="text-xl font-extrabold mb-2">{t('driver.ride.done')}</h2>
          <div className="rounded-2xl bg-brand-light p-4 mb-3 space-y-1">
            <div className="flex justify-between">
              <span>{t('driver.ride.price')}</span>
              <Money value={ride.final_price} className="font-semibold" />
            </div>
            <div className="flex justify-between text-gray-600">
              <span>{t('driver.ride.commission')}</span>
              <Money value={ride.commission_amount ? `-${ride.commission_amount}` : null} />
            </div>
            <div className="flex justify-between text-lg font-extrabold text-brand-dark border-t border-brand/20 pt-1">
              <span>{t('driver.ride.net')}</span>
              <Money value={ride.driver_earning} />
            </div>
            {ride.payment_method === 'cash' && (
              <div className="text-sm">
                {t('driver.ride.cash', { amount: formatMoney(ride.final_price) })}
              </div>
            )}
          </div>
          {!rated && !ride.my_rating ? (
            <RatingForm
              rideId={ride.id}
              title={t('driver.ride.ratePassenger')}
              onDone={() => setRated(true)}
            />
          ) : (
            <p className="text-brand-dark font-semibold">{t('passenger.done.rated')}</p>
          )}
          <Button variant="secondary" block className="mt-3" onClick={onFinished}>
            {t('driver.ride.backOnline')}
          </Button>
        </div>
      )}

      {(ride.status.startsWith('cancelled') || ride.status === 'no_driver') && (
        <div className="text-center py-2">
          <p className="font-extrabold">{t(`status.${ride.status}`)}</p>
          <Button block className="mt-3" onClick={onFinished}>
            {t('driver.ride.backOnline')}
          </Button>
        </div>
      )}

      <Modal open={overlay === 'chat'} onClose={() => setOverlay('none')} title={t('chat.title')}>
        <ChatPanel rideId={ride.id} me="driver" />
      </Modal>
      <Modal
        open={overlay === 'detour'}
        onClose={() => setOverlay('none')}
        title={t('driver.ride.detourTitle')}
        footer={
          <Button loading={detour.isPending} onClick={() => detour.mutate()}>
            {t('common.send')}
          </Button>
        }
      >
        <TextAreaField
          label={t('common.reason')}
          hint={t('driver.ride.detourHint')}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <ErrorBox error={detour.error} />
      </Modal>
      <Modal
        open={overlay === 'cancel'}
        onClose={() => setOverlay('none')}
        title={t('driver.ride.cancel')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOverlay('none')}>
              {t('common.back')}
            </Button>
            <Button variant="danger" loading={cancel.isPending} onClick={() => cancel.mutate()}>
              {t('common.confirm')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-gray-600 mb-2">{t('driver.ride.cancelHint')}</p>
        <TextAreaField
          label={t('common.reason')}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <ErrorBox error={cancel.error} />
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
