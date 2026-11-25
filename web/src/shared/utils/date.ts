const dt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
const d = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' });
const t = new Intl.DateTimeFormat('fr-FR', { timeStyle: 'short' });

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const v = new Date(iso);
  return Number.isNaN(v.getTime()) ? '—' : dt.format(v);
}
/** « AAAA-MM-JJ » est une date du calendrier : lue en heure locale (new Date() la lirait à
 * minuit UTC, soit la veille pour un fuseau à l'ouest de Greenwich). */
export function parseDate(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(iso);
}
/** Date du jour au format AAAA-MM-JJ, dans le fuseau de l'appareil. */
export function localToday(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const v = parseDate(iso);
  return Number.isNaN(v.getTime()) ? '—' : d.format(v);
}
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const v = new Date(iso);
  return Number.isNaN(v.getTime()) ? '—' : t.format(v);
}
export function secondsUntil(iso: string | null | undefined): number {
  if (!iso) return 0;
  return Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 1000));
}
export function isPast(iso: string | null | undefined): boolean {
  return !iso || new Date(iso).getTime() <= Date.now();
}
