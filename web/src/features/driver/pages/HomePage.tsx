import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MapView, type MapMarker, type MapRoute } from '@/shared/map';
import {
  Sheet,
  Button,
  ErrorBox,
  EmergencyButton,
  EmergencySheet,
  FullPageSpinner,
  errorMessage,
} from '@/shared/ui';
import { qk, useActiveRide, useRide } from '@/shared/api/hooks';
import { driversApi, ridesApi } from '@/shared/api/endpoints';
import { isApiError } from '@/shared/api/client';
import { ws, useWsEvent } from '@/shared/ws';
import type { Offer, Ride } from '@/shared/api/types';
import { BRAZZAVILLE } from '@/shared/utils/geo';
import { formatTime } from '@/shared/utils/date';
import { vibrate, beep } from '@/shared/utils/device';
import { toast } from '@/shared/store/ui';
import { ensureNotificationPermission, notify } from '@/shared/notify';
import { subscribePush } from '@/pwa/push';
import { useLocationSender } from '../useLocationSender';
import { useWatchPosition } from '@/shared/utils/geolocation';
import { useGeoSimStore } from '@/shared/store/geoSim';
import { GeoSimBanner } from '@/shared/ui/GeoSim';
import { NameCard } from '@/shared/ui/NameCard';
import { OfferScreen } from '../components/OfferScreen';
import { ActiveRide } from '../components/ActiveRide';

export default function DriverHomePage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const profile = useQuery({ queryKey: qk.driverMe, queryFn: driversApi.me, refetchInterval: 30_000 });
  const active = useActiveRide();
  const activeId = active.data?.id;
  const ride = useRide(activeId);
  const currentRide: Ride | null = ride.data ?? active.data ?? null;
  const [offer, setOffer] = useState<Offer | null>(null);
  const offerRef = useRef<Offer | null>(null);
  offerRef.current = offer;
  const [sos, setSos] = useState(false);
  const isOnline = !!profile.data?.is_online;
  const { fix, stale, queued, gpsError, simulated } = useLocationSender(
    isOnline || !!currentRide,
    currentRide?.id ?? null,
  );
  const moveSim = useGeoSimStore((s) => s.move);
  const simEnabled = useGeoSimStore((s) => s.enabled);
  const simPosition = useGeoSimStore((s) => s.position);
  // Hors ligne : position suivie pour l'affichage seulement (proposition du mode test hors zone)
  const idle = useWatchPosition(!(isOnline || !!currentRide));
  const shownFix = fix ?? idle.fix ?? (simEnabled ? { ...simPosition, heading: null } : null);
  const shownGpsError = gpsError ?? idle.error;

  const toggle = useMutation({
    mutationFn: (is_online: boolean) => driversApi.setStatus(is_online),
    onSuccess: (p) => {
      qc.setQueryData(qk.driverMe, p);
      if (p.is_online) void ensureNotificationPermission().then((ok) => ok && subscribePush());
    },
  });

  // Offres : WebSocket + repli REST au chargement
  useWsEvent('ride.offer', (o) => {
    // Une offre à la fois : si une autre est déjà affichée, on garde la première (le serveur
    // ne devrait pas en envoyer deux, mais on se protège d'un croisement).
    if (offerRef.current && offerRef.current.ride_id !== o.ride_id) return;
    setOffer({ ...o, deadline: Date.now() + (o.ttl_s ?? 15) * 1000 });
    notify(t('driver.offer.title'), o.pickup.address, { tag: `offer-${o.ride_id}`, silent: true });
    vibrate([200, 100, 200]);
    beep(2);
  });
  useEffect(() => {
    if (!isOnline || currentRide) return;
    driversApi
      .currentOffer()
      .then((o) => o && setOffer(o))
      .catch(() => undefined);
  }, [isOnline, currentRide]);
  useWsEvent('ride.status_updated', (r) => {
    if (offer && r.id === offer.ride_id && r.status !== 'dispatching' && r.status !== 'requested')
      setOffer(null);
  });
  useWsEvent('ride.cancelled', (d) => {
    if (currentRide && d.ride_id === currentRide.id) toast(t('status.cancelled_by_passenger'), 'error');
  });

  const respond = useMutation({
    mutationFn: async (accepted: boolean) => {
      if (!offer) return null;
      ws.send('ride.offer_response', { ride_id: offer.ride_id, accepted });
      if (accepted) return ridesApi.accept(offer.ride_id);
      await ridesApi.decline(offer.ride_id).catch(() => undefined);
      return null;
    },
    onSuccess: (r) => {
      setOffer(null);
      if (r) {
        qc.setQueryData(qk.ride(r.id), r);
        qc.setQueryData(qk.activeRide, r);
      }
      void qc.invalidateQueries({ queryKey: qk.driverMe });
    },
    onError: (e) => {
      setOffer(null);
      toast(isApiError(e) && e.status === 409 ? t('driver.offer.taken') : errorMessage(e, t), 'error');
    },
  });

  const markers = useMemo<MapMarker[]>(() => {
    const list: MapMarker[] = [];
    if (fix)
      list.push({
        id: 'me',
        lat: fix.lat,
        lng: fix.lng,
        heading: fix.heading,
        kind: 'driver',
        label: t('passenger.home.myPosition'),
      });
    if (currentRide && ['accepted', 'arrived', 'in_progress'].includes(currentRide.status)) {
      list.push({ id: 'pickup', ...currentRide.pickup, kind: 'pickup', label: t('driver.offer.pickup') });
      list.push({ id: 'dropoff', ...currentRide.dropoff, kind: 'dropoff', label: t('driver.offer.dropoff') });
    }
    return list;
  }, [fix, currentRide, t]);
  const routes = useMemo<MapRoute[]>(
    () =>
      currentRide?.planned_route?.length && currentRide.status === 'in_progress'
        ? [{ id: 'planned', coords: currentRide.planned_route }]
        : [],
    [currentRide],
  );
  const fit = useMemo(
    () =>
      currentRide && ['accepted', 'arrived', 'in_progress'].includes(currentRide.status)
        ? [currentRide.pickup, currentRide.dropoff, ...(fix ? [fix] : [])]
        : fix
          ? [fix]
          : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentRide?.id, currentRide?.status],
  );

  if (profile.isPending) return <FullPageSpinner />;
  if (profile.error)
    return (
      <div className="p-4">
        <ErrorBox error={profile.error} onRetry={() => void profile.refetch()} />
      </div>
    );
  const p = profile.data;
  const pausedUntil =
    p.paused_until && new Date(p.paused_until).getTime() > Date.now() ? p.paused_until : null;

  return (
    <div className="absolute inset-0">
      <MapView
        showNavigation={false}
        center={fix ?? BRAZZAVILLE}
        zoom={14}
        markers={markers}
        routes={routes}
        fit={fit}
        fitKey={`${currentRide?.id}-${currentRide?.status}-${!!fix}`}
        follow={!currentRide}
        onClick={simEnabled ? (p) => moveSim(p) : undefined}
      />
      <div className="absolute top-3 right-3 z-10">
        <EmergencyButton onClick={() => setSos(true)} />
      </div>
      <div className="absolute top-3 left-3 right-[180px] z-10 space-y-2">
        <GeoSimBanner fix={shownFix} gpsError={shownGpsError} />
        <div
          className={`rounded-full px-3 py-1.5 text-sm font-extrabold inline-flex items-center gap-2 shadow ${isOnline ? 'bg-brand text-white' : 'bg-white text-gray-600'}`}
          role="status"
        >
          <span
            className={`h-2.5 w-2.5 rounded-full ${isOnline ? 'bg-white' : 'bg-gray-400'}`}
            aria-hidden="true"
          />
          {isOnline ? t('driver.home.online') : t('driver.home.offline')}
        </div>
        {(isOnline || currentRide) && stale && (
          <div className="rounded-xl bg-alert text-white px-3 py-2 text-sm font-semibold" role="alert">
            {t('driver.home.noPosition', { s: 30 })}
          </div>
        )}
        {(isOnline || currentRide) && gpsError && !stale && !simulated && (
          <div className="rounded-xl bg-slate text-white px-3 py-2 text-sm" role="status">
            {t('passenger.home.gpsDenied')}
          </div>
        )}
        {queued > 0 && (
          <div className="rounded-xl bg-code-light px-3 py-2 text-sm" role="status">
            {t('driver.home.queued', { count: queued })}
          </div>
        )}
      </div>
      <EmergencySheet
        open={sos}
        onClose={() => setSos(false)}
        zone={p.zone ?? currentRide?.zone}
        rideId={currentRide?.id ?? null}
      />

      {offer && !currentRide && (
        <OfferScreen
          offer={offer}
          busy={respond.isPending}
          onAccept={() => respond.mutate(true)}
          onDecline={() => respond.mutate(false)}
          onExpire={() => setOffer(null)}
        />
      )}

      <Sheet>
        {!currentRide && active.isError && (
          <div className="rounded-xl bg-alert-light text-alert p-3 mb-3 text-sm" role="alert">
            <div className="font-semibold">{t('driver.activeRideCheckFailed')}</div>
            <button type="button" className="underline mt-1" onClick={() => void active.refetch()}>
              {t('common.retry')}
            </button>
          </div>
        )}
        {currentRide ? (
          <ActiveRide
            ride={currentRide}
            fix={fix}
            onFinished={() => {
              qc.setQueryData(qk.activeRide, null);
              void qc.invalidateQueries({ queryKey: qk.activeRide });
              void qc.invalidateQueries({ queryKey: qk.wallet });
            }}
          />
        ) : (
          <div>
            <NameCard />
            {p.status !== 'approved' && (
              <div className="rounded-xl bg-code-light p-3 mb-3 text-sm">
                <p className="font-semibold">
                  {p.status === 'pending'
                    ? t('driver.home.statusPending')
                    : p.status === 'rejected'
                      ? t('driver.home.statusRejected')
                      : t('driver.home.statusSuspended')}
                </p>
                {p.blocking_reason && <p className="text-gray-700">{p.blocking_reason}</p>}
                <Button variant="secondary" block className="mt-2" onClick={() => nav('/d/onboarding')}>
                  {t('driver.home.onboardingCta')}
                </Button>
              </div>
            )}
            {p.status === 'approved' && !p.can_go_online && p.blocking_reason && (
              <div className="rounded-xl bg-alert-light text-alert p-3 mb-3 text-sm" role="alert">
                <p className="font-semibold">{t('driver.home.blocked')}</p>
                <p>{p.blocking_reason}</p>
                {!p.active_vehicle_id && (
                  <Button variant="secondary" block className="mt-2" onClick={() => nav('/d/onboarding')}>
                    {t('driver.home.onboardingCta')}
                  </Button>
                )}
              </div>
            )}
            {pausedUntil && (
              <p className="rounded-xl bg-code-light p-3 mb-3 text-sm">
                {t('driver.home.paused', { time: formatTime(pausedUntil) })}
              </p>
            )}
            <Button
              block
              variant={isOnline ? 'secondary' : 'primary'}
              className="min-h-[64px] text-lg"
              disabled={!isOnline && !p.can_go_online}
              loading={toggle.isPending}
              onClick={() => toggle.mutate(!isOnline)}
              aria-pressed={isOnline}
            >
              {isOnline ? t('driver.home.goOffline') : t('driver.home.goOnline')}
            </Button>
            {toggle.error && (
              <p className="text-sm text-alert mt-2" role="alert">
                {errorMessage(toggle.error, t)}
              </p>
            )}
            {isOnline && (
              <p className="mt-3 text-center text-gray-600 flex items-center justify-center gap-2">
                <span className="h-3 w-3 rounded-full bg-brand animate-pulse" aria-hidden="true" />{' '}
                {t('driver.home.waiting')}
              </p>
            )}
            {isOnline && (
              <p className="text-xs text-gray-500 text-center mt-1">{t('driver.home.wakeLockHint')}</p>
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}
