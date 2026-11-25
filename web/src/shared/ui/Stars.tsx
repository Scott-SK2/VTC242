import { useTranslation } from 'react-i18next';

export function Stars({
  value,
  onChange,
  size = 40,
}: {
  value: number;
  onChange?: (v: number) => void;
  size?: number;
}) {
  const { t } = useTranslation();
  // étoiles cliquables : zone tactile d'au moins 44 px, quelle que soit la taille du dessin
  const box = onChange ? Math.max(size, 44) : size;
  return (
    <div
      className="flex gap-1"
      role={onChange ? 'radiogroup' : undefined}
      aria-label={t('rating.stars', { n: value })}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role={onChange ? 'radio' : undefined}
          aria-checked={onChange ? n === value : undefined}
          aria-label={t('rating.stars', { n })}
          disabled={!onChange}
          onClick={() => onChange?.(n)}
          style={{ width: box, height: box, fontSize: size * 0.8 }}
          className={`flex items-center justify-center ${n <= value ? 'text-code' : 'text-gray-300'} disabled:opacity-100`}
        >
          ★
        </button>
      ))}
    </div>
  );
}
