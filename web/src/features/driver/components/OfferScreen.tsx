import { useTranslation } from 'react-i18next';
import type { Offer } from '@/shared/api/types';
import { Button, CountdownRing, useCountdown } from '@/shared/ui';
import { formatDistance } from '@/shared/utils/geo';
import { formatMoney } from '@/shared/utils/money';

/** Offre de course plein écran (F-33) avec compte à rebours en jaune (durée fixée par le serveur). */
export function OfferScreen({
  offer,
  onAccept,
  onDecline,
  onExpire,
  busy,
}: {
  offer: Offer;
  onAccept: () => void;
  onDecline: () => void;
  onExpire: () => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const total = offer.ttl_s ?? 15;
  const expiresIso = offer.deadline ? new Date(offer.deadline).toISOString() : offer.expires_at;
  const left = useCountdown(expiresIso, onExpire);
  return (
    <div
      className="absolute inset-0 z-40 bg-white flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-label={t('driver.offer.title')}
    >
      <div className="flex-1 overflow-y-auto px-5 py-6 flex flex-col items-center">
        <CountdownRing seconds={left} total={total} />
        <h2 className="mt-4 text-2xl font-extrabold">{t('driver.offer.title')}</h2>
        <p className="text-gray-600 font-semibold">{t(`categories.${offer.category}`)}</p>
        <div className="mt-6 w-full space-y-4">
          <div className="flex gap-3">
            <span className="mt-1 text-brand text-xl" aria-hidden="true">
              ●
            </span>
            <div>
              <div className="text-sm text-gray-500">
                {t('driver.offer.pickup')} ·{' '}
                {t('driver.offer.approach', { distance: formatDistance(offer.pickup.distance_m) })}
              </div>
              <div className="font-extrabold text-lg">{offer.pickup.address}</div>
            </div>
          </div>
          <div className="flex gap-3">
            <span className="mt-1 text-xl" aria-hidden="true">
              ■
            </span>
            <div>
              <div className="text-sm text-gray-500">{t('driver.offer.dropoff')}</div>
              <div className="font-extrabold text-lg">{offer.dropoff.address}</div>
            </div>
          </div>
          <div className="rounded-2xl bg-brand-light p-4 text-center">
            <div className="text-sm text-brand-dark">{t('driver.offer.earning')}</div>
            <div className="text-3xl font-extrabold text-brand-dark">
              {formatMoney(offer.estimated_earning)}
            </div>
          </div>
        </div>
      </div>
      <div
        className="p-4 grid grid-cols-2 gap-3"
        style={{ paddingBottom: 'calc(16px + var(--safe-bottom))' }}
      >
        <Button variant="secondary" className="min-h-[64px] text-lg" onClick={onDecline} disabled={busy}>
          {t('driver.offer.decline')}
        </Button>
        <Button className="min-h-[64px] text-lg" onClick={onAccept} loading={busy}>
          {t('driver.offer.accept')}
        </Button>
      </div>
    </div>
  );
}
