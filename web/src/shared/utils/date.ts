const dt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
const d = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' });
const t = new Intl.DateTimeFormat('fr-FR', { timeStyle: 'short' });

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const v = new Date(iso);
  return Number.isNaN(v.getTime()) ? '—' : dt.format(v);
}
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const v = new Date(iso);
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
