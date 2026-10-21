import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { rentalsApi } from '@/shared/api/endpoints';
import type { RentalMode } from '@/shared/api/types';
import { Button, Empty, ErrorBox, MobilePage, Spinner, Tabs, TextField } from '@/shared/ui';
import { RentalListingCard } from '@/features/services/components';

type ModeFilter = 'all' | RentalMode;

/** Catalogue des véhicules à louer (annonces validées), filtrable par mode et dates. */
export default function RentalsPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [mode, setMode] = useState<ModeFilter>('all');
  const [q, setQ] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const dates = start && end && end >= start ? { start_date: start, end_date: end } : {};
  const query = useInfiniteQuery({
    queryKey: ['rentals', 'listings', mode, q, start, end],
    queryFn: ({ pageParam }) =>
      rentalsApi.listings({
        mode: mode === 'all' ? undefined : mode,
        q: q || undefined,
        ...dates,
        cursor: pageParam || undefined,
      }),
    initialPageParam: '',
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const items = query.data?.pages.flatMap((p) => p.results) ?? [];
  return (
    <MobilePage title={t('rentals.title')}>
      <Tabs
        value={mode}
        onChange={setMode}
        className="mb-3"
        items={[
          { value: 'all', label: t('rentals.mode.all') },
          { value: 'with_driver', label: t('rentals.mode.with_driver') },
          { value: 'without_driver', label: t('rentals.mode.without_driver') },
        ]}
      />
      <TextField
        label={t('common.search')}
        placeholder={t('rentals.searchPlaceholder')}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
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
      {query.isPending ? (
        <div className="py-6 text-center text-brand">
          <Spinner />
        </div>
      ) : query.error ? (
        <ErrorBox error={query.error} onRetry={() => void query.refetch()} />
      ) : items.length === 0 ? (
        <Empty text={t('rentals.empty')} />
      ) : (
        <div className="grid gap-3">
          {items.map((l) => (
            <RentalListingCard
              key={l.id}
              listing={l}
              onOpen={() => nav(`/p/rentals/${l.id}${start && end ? `?start=${start}&end=${end}` : ''}`)}
            />
          ))}
          {query.hasNextPage && (
            <Button
              variant="secondary"
              block
              loading={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {t('common.loadMore')}
            </Button>
          )}
        </div>
      )}
    </MobilePage>
  );
}
