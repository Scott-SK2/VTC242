import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { carpoolApi } from '@/shared/api/endpoints';
import { Button, Empty, ErrorBox, MobilePage, Spinner } from '@/shared/ui';
import { CarpoolBookingCard, useServicesLive } from '@/features/services/components';

export default function CarpoolBookingsPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  useServicesLive();
  const q = useInfiniteQuery({
    queryKey: ['carpool', 'bookings'],
    queryFn: ({ pageParam }) => carpoolApi.myBookings({ cursor: pageParam || undefined }),
    initialPageParam: '',
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.results) ?? [];
  return (
    <MobilePage title={t('carpool.myBookings')}>
      {q.isPending ? (
        <div className="py-6 text-center text-brand">
          <Spinner />
        </div>
      ) : q.error ? (
        <ErrorBox error={q.error} onRetry={() => void q.refetch()} />
      ) : items.length === 0 ? (
        <Empty text={t('carpool.noBookings')} />
      ) : (
        <div className="grid gap-3">
          {items.map((b) => (
            <CarpoolBookingCard
              key={b.id}
              booking={b}
              onOpen={() => b.trip && nav(`/p/carpool/${b.trip.id}`)}
            />
          ))}
          {q.hasNextPage && (
            <Button
              variant="secondary"
              block
              loading={q.isFetchingNextPage}
              onClick={() => void q.fetchNextPage()}
            >
              {t('common.loadMore')}
            </Button>
          )}
        </div>
      )}
    </MobilePage>
  );
}
