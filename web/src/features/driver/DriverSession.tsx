import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { qk, useActiveRide } from '@/shared/api/hooks';
import { driversApi } from '@/shared/api/endpoints';
import { useWsEvent } from '@/shared/ws';
import { vibrate, beep } from '@/shared/utils/device';
import { notify } from '@/shared/notify';
import { useLocationSender } from './useLocationSender';
import { useDriverSessionStore } from './sessionStore';

/**
 * Service de fond de l'espace chauffeur, actif quel que soit l'onglet ouvert : envoi de la
 * position (sinon le chauffeur disparaissait des disponibles en ouvrant son wallet) et
 * réception des offres (ramène à l'accueil, où l'offre s'affiche).
 */
export default function DriverSession() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const location = useLocation();
  const profile = useQuery({ queryKey: qk.driverMe, queryFn: driversApi.me, refetchInterval: 30_000 });
  const active = useActiveRide();
  const ride = active.data ?? null;
  const isOnline = !!profile.data?.is_online;
  const sender = useLocationSender(isOnline || !!ride, ride?.id ?? null);
  const setSender = useDriverSessionStore((s) => s.setSender);
  const setOffer = useDriverSessionStore((s) => s.setOffer);
  const { fix, stale, queued, gpsError, simulated } = sender;
  useEffect(() => {
    setSender({ fix, stale, queued, gpsError, simulated });
  }, [fix, stale, queued, gpsError, simulated, setSender]);

  const showOffer = () => {
    if (location.pathname !== '/d') nav('/d');
  };

  useWsEvent('ride.offer', (o) => {
    // Une offre à la fois : si une autre est déjà affichée, on garde la première (le serveur
    // ne devrait pas en envoyer deux, mais on se protège d'un croisement).
    const current = useDriverSessionStore.getState().offer;
    if (current && current.ride_id !== o.ride_id && (current.deadline ?? Infinity) > Date.now()) return;
    setOffer({ ...o, deadline: Date.now() + (o.ttl_s ?? 15) * 1000 });
    notify(t('driver.offer.title'), o.pickup.address, { tag: `offer-${o.ride_id}`, silent: true });
    vibrate([200, 100, 200]);
    beep(2);
    showOffer();
  });

  // Repli REST : à la mise en ligne, en fin de course et à chaque (re)connexion du temps réel
  const fetchOffer = () => {
    if (!isOnline || ride) return;
    driversApi
      .currentOffer()
      .then((o) => {
        if (!o) return;
        setOffer(o);
        showOffer();
      })
      .catch(() => undefined);
  };
  useEffect(fetchOffer, [isOnline, ride?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useWsEvent('ws.open', () => fetchOffer());

  useWsEvent('ride.status_updated', (r) => {
    const current = useDriverSessionStore.getState().offer;
    if (current && r.id === current.ride_id && r.status !== 'dispatching' && r.status !== 'requested')
      setOffer(null);
  });
  // Hors ligne : plus d'offre affichée
  useEffect(() => {
    if (profile.data && !isOnline) setOffer(null);
  }, [profile.data, isOnline, setOffer]);

  return null;
}
