import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { geoApi } from '@/shared/api/endpoints';
import { isApiError } from '@/shared/api/client';
import type { LatLng } from '@/shared/api/types';
import { useGeoSimStore } from '@/shared/store/geoSim';
import { BRAZZAVILLE } from '@/shared/utils/geo';
import { Button } from './Button';

/**
 * Bandeau « mode test » affiché sur les cartes : propose une position simulée quand l'utilisateur
 * est hors de la zone de service ou sans GPS, et rappelle qu'elle est active (déplaçable sur la carte).
 */
export function GeoSimBanner({ fix, gpsError }: { fix: LatLng | null; gpsError: string | null }) {
  const { t } = useTranslation();
  const enabled = useGeoSimStore((s) => s.enabled);
  const enable = useGeoSimStore((s) => s.enable);
  const disable = useGeoSimStore((s) => s.disable);
  const [outOfZone, setOutOfZone] = useState(false);
  const key = fix ? `${fix.lat.toFixed(3)},${fix.lng.toFixed(3)}` : null;

  useEffect(() => {
    if (enabled || !fix) {
      setOutOfZone(false);
      return;
    }
    let cancelled = false;
    geoApi
      .resolveZone(fix.lat, fix.lng)
      .then(() => !cancelled && setOutOfZone(false))
      .catch((e) => !cancelled && setOutOfZone(isApiError(e) && e.status === 404));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key]);

  if (enabled) {
    return (
      <div className="rounded-xl bg-code px-3 py-1.5 text-xs font-semibold text-ink" role="status">
        <span>{t('geoSim.active')}</span>{' '}
        <button type="button" className="underline whitespace-nowrap" onClick={disable}>
          {t('geoSim.disable')}
        </button>
      </div>
    );
  }
  if (!outOfZone && !gpsError) return null;
  return (
    <div className="rounded-xl bg-white shadow px-3 py-2 text-sm" role="status">
      <p className="mb-2">{outOfZone ? t('geoSim.outOfZone') : t('geoSim.noGps')}</p>
      <Button variant="secondary" onClick={() => enable(BRAZZAVILLE)}>
        {t('geoSim.offer')}
      </Button>
    </div>
  );
}

/** Carte de réglage dans le profil : activer / désactiver la position simulée. */
export function GeoSimCard() {
  const { t } = useTranslation();
  const enabled = useGeoSimStore((s) => s.enabled);
  const position = useGeoSimStore((s) => s.position);
  const enable = useGeoSimStore((s) => s.enable);
  const disable = useGeoSimStore((s) => s.disable);
  return (
    <section className="card mt-4" aria-labelledby="geosim-title">
      <h3 id="geosim-title" className="font-extrabold">
        {t('geoSim.title')}
      </h3>
      <p className="text-sm text-gray-600 mb-3">{t('geoSim.hint')}</p>
      {enabled && (
        <p className="text-sm mb-3">
          {t('geoSim.current', { lat: position.lat.toFixed(4), lng: position.lng.toFixed(4) })}
        </p>
      )}
      <Button
        variant={enabled ? 'secondary' : 'primary'}
        onClick={() => (enabled ? disable() : enable(BRAZZAVILLE))}
      >
        {enabled ? t('geoSim.disable') : t('geoSim.enable')}
      </Button>
    </section>
  );
}
