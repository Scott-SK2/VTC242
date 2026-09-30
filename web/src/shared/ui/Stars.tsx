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
          style={{ width: size, height: size, fontSize: size * 0.8 }}
          className={`flex items-center justify-center ${n <= value ? 'text-code' : 'text-gray-300'} disabled:opacity-100`}
        >
          ★
        </button>
      ))}
    </div>
  );
}
