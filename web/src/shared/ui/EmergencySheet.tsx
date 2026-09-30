import { useTranslation } from 'react-i18next';
import { Modal } from './Modal';
import { ridesApi } from '@/shared/api/endpoints';
import type { Zone } from '@/shared/api/types';
import { toast } from '@/shared/store/ui';
import { getCurrentPosition } from '@/shared/utils/geolocation';

/** Bouton d'urgence permanent (rouge, F-20) et feuille d'appel 117 / 118. */
export function EmergencyButton({ onClick, className = '' }: { onClick: () => void; className?: string }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t('emergency.button')}
      className={`btn-danger rounded-full shadow-lg px-4 ${className}`}
    >
      <span aria-hidden="true">SOS</span> {t('emergency.button')}
    </button>
  );
}

export function EmergencySheet({
  open,
  onClose,
  zone,
  rideId,
}: {
  open: boolean;
  onClose: () => void;
  zone: Zone | null | undefined;
  rideId?: string | null;
}) {
  const { t } = useTranslation();
  const police = zone?.emergency_police ?? '117';
  const fire = zone?.emergency_fire ?? '118';

  async function call(number: string) {
    if (rideId) {
      let pos: { lat: number; lng: number } | null = null;
      try {
        pos = await getCurrentPosition(4000);
      } catch {
        pos = null;
      }
      ridesApi.emergency(rideId, number, pos).then(
        () => toast(t('emergency.sent'), 'info'),
        () => undefined,
      );
    }
    window.location.href = `tel:${number}`;
  }

  return (
    <Modal open={open} onClose={onClose} title={t('emergency.title')}>
      <p className="text-gray-600 mb-4">{t('emergency.subtitle')}</p>
      <div className="space-y-2">
        <a
          href={`tel:${police}`}
          onClick={(e) => {
            e.preventDefault();
            void call(police);
          }}
          className="btn-danger w-full text-lg"
        >
          {t('emergency.police', { n: police })}
        </a>
        <a
          href={`tel:${fire}`}
          onClick={(e) => {
            e.preventDefault();
            void call(fire);
          }}
          className="btn-danger w-full text-lg"
        >
          {t('emergency.fire', { n: fire })}
        </a>
      </div>
    </Modal>
  );
}
