import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Ride } from '@/shared/api/types';
import { formatDuration } from '@/shared/utils/geo';

function mmss(total: number): string {
  const s = Math.max(0, Math.floor(total));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

/**
 * Chronomètre de course : temps d'attente au point de prise en charge (avec le temps
 * gratuit restant) puis durée écoulée et temps restant estimé pendant le trajet.
 */
export function TripTimer({
  ride,
  freeWaitingSeconds = 180,
  className = '',
}: {
  ride: Ride;
  freeWaitingSeconds?: number;
  className?: string;
}) {
  const { t } = useTranslation();
  const waiting = ride.status === 'arrived' && !!ride.arrived_at;
  const riding = ride.status === 'in_progress' && !!ride.started_at;
  const now = useNow(waiting || riding);
  if (waiting) {
    const waited = (now - new Date(ride.arrived_at as string).getTime()) / 1000;
    const paid = waited > freeWaitingSeconds;
    return (
      <div
        className={`rounded-xl px-3 py-2 text-sm flex items-center justify-between gap-2 ${
          paid ? 'bg-amber-50 text-amber-900' : 'bg-gray-50 text-gray-700'
        } ${className}`}
        role="timer"
        aria-live="off"
      >
        <span>⏱ {t('tripTimer.waiting', { time: mmss(waited) })}</span>
        <span className="font-semibold text-right">
          {paid
            ? t('tripTimer.waitingPaid')
            : t('tripTimer.waitingFree', { left: mmss(freeWaitingSeconds - waited) })}
        </span>
      </div>
    );
  }
  if (riding) {
    const elapsed = (now - new Date(ride.started_at as string).getTime()) / 1000;
    const planned = ride.planned_duration_s;
    const remaining = planned ? Math.max(0, planned - elapsed) : null;
    return (
      <div
        className={`rounded-xl px-3 py-2 text-sm flex items-center justify-between gap-2 bg-gray-50 text-gray-700 ${className}`}
        role="timer"
        aria-live="off"
      >
        <span>⏱ {t('tripTimer.elapsed', { time: mmss(elapsed) })}</span>
        {remaining !== null && (
          <span className="font-semibold text-right">
            {remaining > 0
              ? t('tripTimer.remaining', { time: formatDuration(remaining) })
              : t('tripTimer.overdue')}
          </span>
        )}
      </div>
    );
  }
  return null;
}
