import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { walletApi } from '@/shared/api/endpoints';
import { qk } from '@/shared/api/hooks';
import { Money } from './Money';
import { Badge, type BadgeTone } from './Badge';
import { Button } from './Button';
import { Empty } from './Empty';
import { ErrorBox } from './ErrorBox';
import { formatDateTime } from '@/shared/utils/date';
import { Spinner } from './Spinner';

const tone: Record<string, BadgeTone> = {
  pending: 'yellow',
  completed: 'green',
  failed: 'red',
  expired: 'neutral',
};

export function TransactionList() {
  const { t } = useTranslation();
  const q = useInfiniteQuery({
    queryKey: qk.transactions,
    queryFn: ({ pageParam }) => walletApi.transactions(pageParam || undefined),
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
  if (!items.length) return <Empty />;
  return (
    <div>
      <ul className="divide-y divide-gray-100">
        {items.map((tx) => (
          <li key={tx.id} className="py-3 flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="font-semibold">
                {t(`transactions.${tx.type}`)}
                {tx.operator ? ` · ${t(`operators.${tx.operator}`)}` : ''}
              </div>
              <div className="text-xs text-gray-500">
                {formatDateTime(tx.created_at)}
                {tx.external_reference ? ` · ${t('common.reference')} ${tx.external_reference}` : ''}
              </div>
            </div>
            <div className="text-right">
              <Money
                value={tx.amount}
                sign
                className={`font-extrabold ${Number(tx.amount) > 0 ? 'text-brand-dark' : ''}`}
              />
              <div>
                <Badge tone={tone[tx.status] ?? 'neutral'}>{t(`transactions.${tx.status}`)}</Badge>
              </div>
            </div>
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
