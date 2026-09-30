/** Formate un montant XAF (chaîne décimale ou nombre) au format « 12 500 F ». */
export function formatMoney(
  value: string | number | null | undefined,
  opts: { sign?: boolean } = {},
): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = typeof value === 'number' ? value : Number.parseFloat(value);
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(Math.round(n));
  const grouped = abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
  const sign = n < 0 ? '-' : opts.sign && n > 0 ? '+' : '';
  return `${sign}${grouped}\u00A0F`;
}

/** Fourchette « 1 500 – 1 800 F ». */
export function formatRange(min: string | number, max: string | number): string {
  const a = formatMoney(min).replace(/\u00A0F$/, '');
  return `${a} – ${formatMoney(max)}`;
}

export function toDecimalString(n: number): string {
  return n.toFixed(2);
}

export function parseAmount(s: string): number {
  return Number.parseFloat(s.replace(/[^\d.-]/g, '')) || 0;
}
