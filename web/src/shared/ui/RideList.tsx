import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ridesApi } from '@/shared/api/endpoints';
import { qk } from '@/shared/api/hooks';
import type { Ride } from '@/shared/api/types';
import { Badge, rideTone } from './Badge';
import { Button } from './Button';
import { Empty } from './Empty';
import { ErrorBox } from './ErrorBox';
import { Money } from './Money';
import { Spinner } from './Spinner';
import { formatDateTime } from '@/shared/utils/date';
import { toast } from '@/shared/store/ui';

export function RideList({ role, onOpen }: { role: 'passenger' | 'driver'; onOpen?: (ride: Ride) => void }) {
  const { t } = useTranslation();
  const q = useInfiniteQuery({
    queryKey: qk.rides('all'),
    queryFn: ({ pageParam }) => ridesApi.list({ cursor: pageParam || undefined }),
    initialPageParam: '',
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.results) ?? [];
  if (q.isPending)
    return (
      <div className="py-6 text-center text-brand">
        <Spinner />
      </div>
    );
  if (q.error) return <ErrorBox error={q.error} onRetry={() => void q.refetch()} />;
  if (!items.length) return <Empty text={t('passenger.rides.empty')} />;

  async function receipt(r: Ride) {
    try {
      const res = await ridesApi.receipt(r.id);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `recu-vtc242-${r.id.slice(0, 8)}.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      toast(t('passenger.rides.receiptError'), 'error');
    }
  }

  return (
    <div>
      <ul className="divide-y divide-gray-100">
        {items.map((r) => (
          <li key={r.id} className="py-3">
            <button type="button" className="w-full text-left" onClick={() => onOpen?.(r)}>
              <div className="flex justify-between gap-2 items-start">
                <div className="min-w-0">
                  <div className="text-xs text-gray-500">
                    {formatDateTime(r.requested_at)} · {t(`categories.${r.category}`)}
                  </div>
                  <div className="font-semibold truncate">{r.pickup.address}</div>
                  <div className="text-sm text-gray-600 truncate">→ {r.dropoff.address}</div>
                </div>
                <div className="text-right shrink-0">
                  <Money
                    value={
                      role === 'driver'
                        ? (r.driver_earning ?? r.final_price)
                        : (r.final_price ?? r.estimated_price_max)
                    }
                    className="font-extrabold"
                  />
                  <div>
                    <Badge tone={rideTone(r.status)}>{t(`status.${r.status}`)}</Badge>
                  </div>
                </div>
              </div>
            </button>
            {role === 'passenger' && r.status === 'completed' && (
              <Button variant="ghost" className="mt-1 px-2 text-brand-dark" onClick={() => void receipt(r)}>
                📄 {t('passenger.rides.receipt')}
              </Button>
            )}
          </li>
        ))}
      </ul>
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
  );
}
