import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { carpoolApi } from '@/shared/api/endpoints';
import { Button, Empty, ErrorBox, MobilePage, Spinner, TextField } from '@/shared/ui';
import { CarpoolTripCard } from '@/features/services/components';

/** Recherche de trajets en covoiturage (texte + date). */
export default function CarpoolPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [date, setDate] = useState('');
  const query = useInfiniteQuery({
    queryKey: ['carpool', 'search', q, date],
    queryFn: ({ pageParam }) =>
      carpoolApi.search({ q: q || undefined, date: date || undefined, cursor: pageParam || undefined }),
    initialPageParam: '',
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const items = query.data?.pages.flatMap((p) => p.results) ?? [];
  return (
    <MobilePage title={t('carpool.title')}>
      <TextField
        label={t('common.search')}
        placeholder={t('carpool.searchPlaceholder')}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <TextField
        label={t('carpool.date')}
        type="date"
        value={date}
        onChange={(e) => setDate(e.target.value)}
      />
      {query.isPending ? (
        <div className="py-6 text-center text-brand">
          <Spinner />
        </div>
      ) : query.error ? (
        <ErrorBox error={query.error} onRetry={() => void query.refetch()} />
      ) : items.length === 0 ? (
        <Empty text={t('carpool.empty')} />
      ) : (
        <div className="grid gap-3">
          {items.map((trip) => (
            <CarpoolTripCard key={trip.id} trip={trip} onOpen={() => nav(`/p/carpool/${trip.id}`)} />
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
