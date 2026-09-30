import { formatMoney } from '@/shared/utils/money';

export function Money({
  value,
  sign,
  className = '',
}: {
  value: string | number | null | undefined;
  sign?: boolean;
  className?: string;
}) {
  return <span className={`tabular-nums ${className}`}>{formatMoney(value, { sign })}</span>;
}
