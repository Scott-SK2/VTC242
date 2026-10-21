import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@tanstack/react-query';
import { MapView, type MapMarker } from '@/shared/map';
import {
  Sheet,
  Button,
  Tabs,
  ErrorBox,
  EmergencyButton,
  EmergencySheet,
  Spinner,
  errorMessage,
} from '@/shared/ui';
import { useActiveRide, useWallet } from '@/shared/api/hooks';
import { ridesApi } from '@/shared/api/endpoints';
import { isApiError } from '@/shared/api/client';
import type { Estimate, LatLng, PaymentMethod, Place, VehicleCategory } from '@/shared/api/types';
import { BRAZZAVILLE, formatDistance, formatDuration } from '@/shared/utils/geo';
import { formatMoney, formatRange } from '@/shared/utils/money';
import { useWatchPosition } from '@/shared/utils/geolocation';
import { useGeoSimStore } from '@/shared/store/geoSim';
import { GeoSimBanner } from '@/shared/ui/GeoSim';
import { NameCard } from '@/shared/ui/NameCard';
import { AddressSearch } from '../components/AddressSearch';
import { toast } from '@/shared/store/ui';

type Mode = 'idle' | 'search-dropoff' | 'search-pickup' | 'pick-on-map' | 'estimate';
type Tab = 'taxis' | 'cars';
const TAB_CATEGORIES: Record<Tab, VehicleCategory[]> = {
  taxis: ['taxi'],
  cars: ['standard', 'vip', 'wedding', 'moving'],
};

export default function HomePage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const { data: active } = useActiveRide();
  const { fix, error: gpsError, simulated } = useWatchPosition(true);
  const moveSim = useGeoSimStore((s) => s.move);
  const [mode, setMode] = useState<Mode>('idle');
  const [tab, setTab] = useState<Tab>('taxis');
  const [pickup, setPickup] = useState<Place | null>(null);
  const [dropoff, setDropoff] = useState<Place | null>(null);
  const [pickTarget, setPickTarget] = useState<'pickup' | 'dropoff'>('dropoff');
  const [category, setCategory] = useState<VehicleCategory | null>(null);
  // Décision client : paiement par wallet uniquement (les espèces restent désactivées côté zone)
  const payment: PaymentMethod = 'wallet';
  const [sos, setSos] = useState(false);
  const wallet = useWallet();

  useEffect(() => {
    if (active?.id) nav(`/p/ride/${active.id}`, { replace: true });
  }, [active?.id, nav]);

  // Point de départ proposé par GPS, modifiable
  useEffect(() => {
    if (fix && !pickup) setPickup({ lat: fix.lat, lng: fix.lng, address: t('passenger.home.myPosition') });
  }, [fix, pickup, t]);
  useEffect(() => {
    if (simulated && fix && mode === 'idle')
      setPickup({ lat: fix.lat, lng: fix.lng, address: t('passenger.home.myPosition') });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simulated, fix?.lat, fix?.lng]);

  const estimate = useQuery({
    queryKey: ['estimate', pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng],
    queryFn: () => ridesApi.estimate(pickup as Place, dropoff as Place),
    enabled: !!pickup && !!dropoff && mode === 'estimate',
    retry: false,
  });

  const order = useMutation({
    mutationFn: (est: Estimate) =>
      ridesApi.create({
        category: est.category,
        pricing_rule_id: est.pricing_rule_id,
        payment_method: payment,
        pickup: pickup as Place,
        dropoff: dropoff as Place,
      }),
    onSuccess: (ride) => nav(`/p/ride/${ride.id}`, { replace: true }),
    onError: (e) => {
      if (isApiError(e) && e.status === 409) toast(t('passenger.order.alreadyActive'), 'error');
    },
  });

  const estimates = useMemo(() => {
    const list = estimate.data?.estimates ?? [];
    const cats = TAB_CATEGORIES[tab];
    return list.filter((e) => cats.includes(e.category));
  }, [estimate.data, tab]);
  const selected = estimates.find((e) => e.category === category) ?? estimates[0] ?? null;
  const nearby = estimate.data?.estimates.reduce((s, e) => s + (e.available_drivers ?? 0), 0) ?? null;

  const markers: MapMarker[] = [];
  if (fix)
    markers.push({ id: 'me', lat: fix.lat, lng: fix.lng, kind: 'me', label: t('passenger.home.myPosition') });
  if (pickup && mode !== 'idle')
    markers.push({
      id: 'pickup',
      lat: pickup.lat,
      lng: pickup.lng,
      kind: 'pickup',
      label: t('passenger.home.pickup'),
    });
  if (dropoff)
    markers.push({
      id: 'dropoff',
      lat: dropoff.lat,
      lng: dropoff.lng,
      kind: 'dropoff',
      label: t('passenger.home.dropoff'),
    });
  const routes = estimate.data?.route?.length ? [{ id: 'planned', coords: estimate.data.route }] : [];
  const fitPoints: LatLng[] = mode === 'estimate' && pickup && dropoff ? [pickup, dropoff] : [];

  function handleSelect(target: 'pickup' | 'dropoff', p: { address: string; lat?: number; lng?: number }) {
    if (p.lat === undefined || p.lng === undefined) {
      // Saisie libre : on demande de placer le point sur la carte
      setPickTarget(target);
      setMode('pick-on-map');
      if (target === 'pickup')
        setPickup({
          address: p.address,
          lat: pickup?.lat ?? fix?.lat ?? BRAZZAVILLE.lat,
          lng: pickup?.lng ?? fix?.lng ?? BRAZZAVILLE.lng,
        });
      else
        setDropoff({
          address: p.address,
          lat: pickup?.lat ?? BRAZZAVILLE.lat,
          lng: pickup?.lng ?? BRAZZAVILLE.lng,
        });
      return;
    }
    const place = { address: p.address, lat: p.lat, lng: p.lng };
    if (target === 'pickup') setPickup(place);
    else setDropoff(place);
    if ((target === 'pickup' && dropoff) || (target === 'dropoff' && pickup)) setMode('estimate');
    else setMode(target === 'dropoff' ? 'search-pickup' : 'search-dropoff');
  }

  const insufficient = isApiError(order.error) && order.error.status === 402 ? order.error : null;

  return (
    <div className="absolute inset-0">
      <MapView
        showNavigation={false}
        center={fix ?? BRAZZAVILLE}
        zoom={14}
        markers={markers}
        routes={routes}
        fit={fitPoints}
        fitKey={`${mode}-${pickup?.lat}-${dropoff?.lat}`}
        onClick={
          mode === 'pick-on-map'
            ? (p) => {
                if (pickTarget === 'pickup') setPickup((old) => ({ address: old?.address ?? '', ...p }));
                else setDropoff((old) => ({ address: old?.address ?? '', ...p }));
                const otherMissing = pickTarget === 'dropoff' ? !pickup : !dropoff;
                setMode(
                  otherMissing ? (pickTarget === 'dropoff' ? 'search-pickup' : 'search-dropoff') : 'estimate',
                );
              }
            : simulated && mode === 'idle'
              ? (p) => {
                  moveSim(p);
                  setPickup({ ...p, address: t('passenger.home.myPosition') });
                }
              : undefined
        }
      />
      <div className="absolute top-3 right-3 z-10">
        <EmergencyButton onClick={() => setSos(true)} />
      </div>
      <div className="absolute top-3 left-3 right-[180px] z-10">
        <GeoSimBanner fix={fix} gpsError={gpsError} />
      </div>
      <EmergencySheet open={sos} onClose={() => setSos(false)} zone={estimate.data?.zone} rideId={null} />

      {mode === 'idle' && (
        <Sheet title={undefined}>
          <NameCard />
          {gpsError && (
            <p className="mb-2 rounded-xl bg-gray-100 p-3 text-sm">{t('passenger.home.gpsDenied')}</p>
          )}
          {!fix && !gpsError && (
            <p className="mb-2 text-sm text-gray-500 flex items-center gap-2">
              <Spinner size={16} /> {t('passenger.home.locating')}
            </p>
          )}
          <Tabs
            value={tab}
            onChange={setTab}
            items={[
              { value: 'taxis', label: t('passenger.home.tabTaxis') },
              { value: 'cars', label: t('passenger.home.tabCars') },
            ]}
            className="mb-3"
          />
          <button
            type="button"
            className="input text-left text-gray-500 flex items-center gap-2 font-semibold text-lg"
            onClick={() => setMode('search-dropoff')}
          >
            <span aria-hidden="true">🔍</span> {t('passenger.home.where')}
          </button>
          <button
            type="button"
            className="mt-2 w-full text-left text-sm text-gray-600 min-h-tap flex items-center gap-2"
            onClick={() => setMode('search-pickup')}
          >
            <span className="text-brand" aria-hidden="true">
              ●
            </span>{' '}
            {t('passenger.home.pickup')} :{' '}
            <span className="font-semibold text-ink truncate">{pickup?.address ?? '—'}</span>
          </button>
          {nearby !== null && (
            <p className="text-xs text-gray-500">
              {nearby > 0 ? t('passenger.home.nearby', { count: nearby }) : t('passenger.home.noNearby')}
            </p>
          )}
        </Sheet>
      )}

      {(mode === 'search-dropoff' || mode === 'search-pickup') && (
        <Sheet collapsible={false}>
          <div className="flex items-center gap-2 mb-2">
            <Button
              variant="ghost"
              onClick={() => setMode(pickup && dropoff ? 'estimate' : 'idle')}
              aria-label={t('common.back')}
            >
              ←
            </Button>
            <span className="font-extrabold">
              {mode === 'search-dropoff' ? t('passenger.home.dropoff') : t('passenger.home.pickup')}
            </span>
          </div>
          <AddressSearch
            key={mode}
            label={mode === 'search-dropoff' ? t('passenger.home.where') : t('passenger.home.pickup')}
            initial={
              mode === 'search-pickup' && pickup?.address !== t('passenger.home.myPosition')
                ? (pickup?.address ?? '')
                : ''
            }
            near={fix}
            autoFocus
            onSelect={(p) => handleSelect(mode === 'search-dropoff' ? 'dropoff' : 'pickup', p)}
            onPickOnMap={() => {
              setPickTarget(mode === 'search-dropoff' ? 'dropoff' : 'pickup');
              setMode('pick-on-map');
            }}
          />
          {mode === 'search-pickup' && fix && (
            <Button
              variant="secondary"
              block
              className="mt-2"
              onClick={() =>
                handleSelect('pickup', {
                  address: t('passenger.home.myPosition'),
                  lat: fix.lat,
                  lng: fix.lng,
                })
              }
            >
              📍 {t('passenger.home.myPosition')}
            </Button>
          )}
        </Sheet>
      )}

      {mode === 'pick-on-map' && (
        <Sheet collapsible={false}>
          <p className="font-semibold mb-1">
            {t('passenger.search.notFoundTitle')} —{' '}
            {pickTarget === 'pickup' ? t('passenger.home.pickup') : t('passenger.home.dropoff')}
          </p>
          <p className="text-sm text-gray-600 mb-3">
            {t('passenger.search.notFoundHint', {
              q: (pickTarget === 'pickup' ? pickup : dropoff)?.address ?? '',
            })}
          </p>
          <Button variant="secondary" block onClick={() => setMode(pickup && dropoff ? 'estimate' : 'idle')}>
            {t('common.cancel')}
          </Button>
        </Sheet>
      )}

      {mode === 'estimate' && (
        <Sheet collapsible={false}>
          <div className="flex items-center gap-2 mb-2">
            <Button
              variant="ghost"
              onClick={() => {
                setMode('idle');
                setDropoff(null);
                order.reset();
              }}
              aria-label={t('common.back')}
            >
              ←
            </Button>
            <span className="font-extrabold">{t('passenger.estimate.title')}</span>
          </div>
          <div className="text-sm space-y-1 mb-3">
            <button
              type="button"
              className="w-full text-left flex gap-2 min-h-[36px] items-center"
              onClick={() => setMode('search-pickup')}
            >
              <span className="text-brand" aria-hidden="true">
                ●
              </span>
              <span className="truncate">{pickup?.address}</span>
            </button>
            <button
              type="button"
              className="w-full text-left flex gap-2 min-h-[36px] items-center"
              onClick={() => setMode('search-dropoff')}
            >
              <span aria-hidden="true">■</span>
              <span className="truncate">{dropoff?.address}</span>
            </button>
          </div>
          <Tabs
            value={tab}
            onChange={(v) => {
              setTab(v);
              setCategory(null);
            }}
            items={[
              { value: 'taxis', label: t('passenger.home.tabTaxis') },
              { value: 'cars', label: t('passenger.home.tabCars') },
            ]}
            className="mb-3"
          />
          {estimate.isPending && (
            <p className="text-sm text-gray-500 flex items-center gap-2">
              <Spinner size={16} /> {t('passenger.estimate.recalc')}
            </p>
          )}
          {estimate.isError &&
            (isApiError(estimate.error) && estimate.error.status === 422 ? (
              <p className="rounded-xl bg-alert-light text-alert p-3 text-sm">
                {t('passenger.estimate.outOfZone')}
              </p>
            ) : (
              <ErrorBox error={estimate.error} onRetry={() => void estimate.refetch()} />
            ))}
          {estimate.data && (
            <>
              <p className="text-sm text-gray-600 mb-2">
                {formatDistance(estimate.data.distance_m)} · {formatDuration(estimate.data.duration_s)} ·{' '}
                {t('passenger.estimate.range')}
              </p>
              <ul className="space-y-2 mb-3" role="radiogroup" aria-label={t('common.category')}>
                {estimates.map((e) => (
                  <li key={e.category}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={selected?.category === e.category}
                      onClick={() => setCategory(e.category)}
                      className={`w-full rounded-xl border p-3 text-left ${selected?.category === e.category ? 'border-brand bg-brand-light' : 'border-gray-200'}`}
                    >
                      <div className="flex justify-between items-baseline gap-2">
                        <span className="font-extrabold">{e.label || t(`categories.${e.category}`)}</span>
                        <span className="font-extrabold whitespace-nowrap">
                          {e.on_quote ? t('categories.onQuote') : formatRange(e.price_min, e.price_max)}
                        </span>
                      </div>
                      <div className="text-sm text-gray-600 flex flex-wrap gap-x-3">
                        <span>
                          {e.eta_pickup_s !== null
                            ? t('passenger.estimate.approach', { eta: formatDuration(e.eta_pickup_s) })
                            : ''}
                        </span>
                        <span>
                          {e.available_drivers > 0
                            ? t('passenger.estimate.drivers', { count: e.available_drivers })
                            : t('passenger.estimate.noDrivers')}
                        </span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
              {selected?.on_quote && (
                <p className="text-sm text-gray-600 mb-2">{t('passenger.estimate.quoteHint')}</p>
              )}
              <p className="text-sm mb-2">
                <span className="font-semibold">{t('payment.wallet')}</span>
                <span className="text-gray-600">
                  {' '}
                  · {t('passenger.wallet.available')} : {formatMoney(wallet.data?.available)}
                </span>
              </p>
              {selected && !selected.on_quote && (
                <p className="text-xs text-gray-500 mb-2">
                  {t('passenger.order.reserve', { amount: formatMoney(selected.price_max) })}
                </p>
              )}
              {insufficient && (
                <div className="rounded-xl bg-alert-light text-alert p-3 text-sm mb-2" role="alert">
                  {t('passenger.order.insufficient', {
                    required: formatMoney(String(insufficient.details.required ?? '')),
                    available: formatMoney(String(insufficient.details.available ?? '')),
                  })}
                  <Button variant="secondary" block className="mt-2" onClick={() => nav('/p/wallet')}>
                    {t('passenger.order.recharge')}
                  </Button>
                </div>
              )}
              {order.error && !insufficient && (
                <p className="text-sm text-alert mb-2" role="alert">
                  {errorMessage(order.error, t)}
                </p>
              )}
              <Button
                block
                loading={order.isPending}
                disabled={!selected || (selected.available_drivers === 0 && !selected.on_quote)}
                onClick={() => selected && order.mutate(selected)}
              >
                {t('passenger.estimate.order')}{' '}
                {selected && !selected.on_quote
                  ? `· ${formatRange(selected.price_min, selected.price_max)}`
                  : ''}
              </Button>
            </>
          )}
        </Sheet>
      )}
    </div>
  );
}
