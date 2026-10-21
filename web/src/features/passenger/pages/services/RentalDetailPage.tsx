import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { rentalsApi } from '@/shared/api/endpoints';
import type { RentalMode } from '@/shared/api/types';
import {
  Badge,
  Button,
  ErrorBox,
  FullPageSpinner,
  MobilePage,
  Tabs,
  TextAreaField,
  TextField,
} from '@/shared/ui';
import { formatMoney } from '@/shared/utils/money';
import { formatDate } from '@/shared/utils/date';
import { toast } from '@/shared/store/ui';
import { modeLabel } from '@/features/services/components';

function daysBetween(start: string, end: string): number {
  if (!start || !end) return 0;
  const a = new Date(start + 'T00:00:00').getTime();
  const b = new Date(end + 'T00:00:00').getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return 0;
  return Math.round((b - a) / 86_400_000) + 1;
}

/** Fiche véhicule et formulaire de réservation (fonds réservés sur le wallet). */
export default function RentalDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const [start, setStart] = useState(params.get('start') ?? '');
  const [end, setEnd] = useState(params.get('end') ?? '');
  const [note, setNote] = useState('');
  const listing = useQuery({
    queryKey: ['rentals', 'listing', id],
    queryFn: () => rentalsApi.listing(id as string),
    enabled: !!id,
  });
  const modes = listing.data?.modes ?? [];
  const [mode, setMode] = useState<RentalMode | null>(null);
  const selected = mode && modes.includes(mode) ? mode : (modes[0] ?? null);
  const days = daysBetween(start, end);
  const price = selected
    ? selected === 'with_driver'
      ? listing.data?.price_per_day_with_driver
      : listing.data?.price_per_day_without_driver
    : null;
  const total = useMemo(() => (price && days ? Number(price) * days : 0), [price, days]);
  const deposit = selected === 'without_driver' ? Number(listing.data?.deposit_amount ?? 0) : 0;
  const book = useMutation({
    mutationFn: () =>
      rentalsApi.book({
        listing_id: id as string,
        mode: selected as RentalMode,
        start_date: start,
        end_date: end,
        note: note || undefined,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['rentals'] });
      void qc.invalidateQueries({ queryKey: ['wallet'] });
      toast(t('rentals.booked'), 'success');
      nav('/p/rentals/bookings', { replace: true });
    },
  });
  if (listing.isPending) return <FullPageSpinner />;
  if (listing.error || !listing.data)
    return (
      <MobilePage title={t('rentals.title')}>
        <ErrorBox error={listing.error ?? new Error('not found')} onRetry={() => void listing.refetch()} />
      </MobilePage>
    );
  const l = listing.data;
  const v = l.vehicle;
  const tooShort = days > 0 && days < l.min_days;
  return (
    <MobilePage
      title={l.title}
      action={
        <Button variant="ghost" onClick={() => nav(-1)}>
          {t('common.back')}
        </Button>
      }
    >
      {l.photo_url && (
        <img src={l.photo_url} alt="" className="w-full h-44 object-cover rounded-2xl bg-gray-100 mb-3" />
      )}
      <p className="text-sm text-gray-600">
        {v.brand} {v.model} · {v.color} · {t(`categories.${v.category}`)} · {v.seats} pl. · {l.city}
      </p>
      <p className="text-sm text-gray-600 mt-1">
        {t('rentals.owner')} : {l.owner.first_name || '—'}
        {l.owner.rating_avg ? ` · ★ ${l.owner.rating_avg.toFixed(1)}` : ''}
      </p>
      {l.description && <p className="mt-2 whitespace-pre-line">{l.description}</p>}
      <div className="mt-3 text-sm text-gray-500">{t('rentals.minDays', { n: l.min_days })}</div>
      {l.booked_periods && l.booked_periods.length > 0 && (
        <div className="mt-2 text-sm">
          <span className="text-gray-500">{t('rentals.bookedPeriods')} : </span>
          {l.booked_periods.map((p) => (
            <Badge key={p.start_date} tone="neutral">
              {formatDate(p.start_date)} → {formatDate(p.end_date)}
            </Badge>
          ))}
        </div>
      )}
      <div className="mt-4 rounded-2xl border border-gray-200 p-3">
        {modes.length > 1 && selected && (
          <Tabs
            value={selected}
            onChange={setMode}
            className="mb-3"
            items={modes.map((m) => ({ value: m, label: t(`rentals.mode.${m}`) }))}
          />
        )}
        {selected && price && (
          <div className="font-extrabold mb-2">
            {t('rentals.perDay', { price: formatMoney(price) })} {modeLabel(selected, t)}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <TextField
            label={t('rentals.startDate')}
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
          <TextField
            label={t('rentals.endDate')}
            type="date"
            value={end}
            min={start || undefined}
            onChange={(e) => setEnd(e.target.value)}
          />
        </div>
        <TextAreaField
          label={t('rentals.note')}
          hint={t('rentals.noteHint')}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        {days > 0 && (
          <div className="text-sm">
            <div className="flex justify-between">
              <span>{t('rentals.days', { n: days })}</span>
              <span className="font-extrabold">{formatMoney(total)}</span>
            </div>
            {deposit > 0 && (
              <p className="text-xs text-gray-500 mt-1">
                {t('rentals.depositInfo', { amount: formatMoney(deposit) })}
              </p>
            )}
            {tooShort && <p className="text-xs text-alert mt-1">{t('rentals.minDays', { n: l.min_days })}</p>}
          </div>
        )}
        <Button
          block
          className="mt-3"
          disabled={!selected || days === 0 || tooShort}
          loading={book.isPending}
          onClick={() => book.mutate()}
        >
          {t('rentals.book')}
          {days > 0 && total > 0 ? ` · ${formatMoney(total)}` : ''}
        </Button>
        <ErrorBox error={book.error} />
      </div>
    </MobilePage>
  );
}
