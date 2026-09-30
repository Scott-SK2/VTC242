import { useEffect, useState } from 'react';

/** Compte à rebours en jaune (usage réservé : offre chauffeur, code de départ). */
export function useCountdown(expiresAt: string | null | undefined, onExpire?: () => void) {
  const [left, setLeft] = useState(() => calc(expiresAt));
  useEffect(() => {
    setLeft(calc(expiresAt));
    if (!expiresAt) return;
    const id = setInterval(() => {
      const v = calc(expiresAt);
      setLeft(v);
      if (v <= 0) {
        clearInterval(id);
        onExpire?.();
      }
    }, 250);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expiresAt]);
  return left;
}

function calc(iso: string | null | undefined) {
  if (!iso) return 0;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 1000));
}

export function CountdownRing({ seconds, total }: { seconds: number; total: number }) {
  const r = 44;
  const c = 2 * Math.PI * r;
  const ratio = total > 0 ? Math.min(1, seconds / total) : 0;
  return (
    <div className="relative h-28 w-28" role="timer" aria-live="polite" aria-label={`${seconds} secondes`}>
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="#FFF6D6" strokeWidth="8" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke="#F2C21B"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - ratio)}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-4xl font-extrabold text-yellow-900 tabular-nums">
        {seconds}
      </span>
    </div>
  );
}
