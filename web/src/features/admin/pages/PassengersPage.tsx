import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { adminApi } from '@/shared/api/endpoints';
import type { AdminPassenger } from '@/shared/api/types';
import { AdminPage, DataTable, Pager, ReasonModal, Stat, useCursorQuery, type Column } from '../components';
import { Badge, Button, ErrorBox, Money, rideTone } from '@/shared/ui';
import { formatDate, formatDateTime } from '@/shared/utils/date';
import { toast } from '@/shared/store/ui';

/** Passagers (F-54) : recherche, historique, blocage, déconnexion à distance. */
export default function PassengersPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [applied, setApplied] = useState('');
  const [selected, setSelected] = useState<AdminPassenger | null>(null);
  const [blockOpen, setBlockOpen] = useState(false);
  const list = useCursorQuery(['admin', 'passengers', applied], (cursor) =>
    adminApi.passengers({ q: applied || undefined, cursor }),
  );
  const history = useQuery({
    queryKey: ['admin', 'rides', 'passenger', selected?.id],
    queryFn: () => adminApi.rides({ passenger_id: selected?.id, q: selected?.phone_number }),
    enabled: !!selected,
  });
  const act = useMutation({
    mutationFn: ({ action, reason }: { action: 'block' | 'unblock' | 'logout'; reason?: string }) =>
      action === 'block'
        ? adminApi.blockPassenger(selected!.id, reason ?? '')
        : action === 'unblock'
          ? adminApi.unblockPassenger(selected!.id)
          : adminApi.logoutAll(selected!.id),
    onSuccess: (_u, v) => {
      void qc.invalidateQueries({ queryKey: ['admin', 'passengers'] });
      if (selected && v.action !== 'logout') setSelected({ ...selected, is_blocked: v.action === 'block' });
      setBlockOpen(false);
      toast(t('common.ok'), 'success');
    },
  });
  const columns: Column<AdminPassenger>[] = [
    {
      key: 'name',
      header: t('common.name'),
      render: (p) => (
        <span className="font-semibold">
          {p.first_name} {p.last_name}
        </span>
      ),
    },
    { key: 'phone', header: t('common.phone'), render: (p) => p.phone_number },
    { key: 'rides', header: t('admin.passengers.ridesCount'), render: (p) => p.rides_count },
    {
      key: 'wallet',
      header: t('admin.passengers.walletBalance'),
      render: (p) => <Money value={p.wallet_balance} />,
      className: 'text-right',
    },
    {
      key: 'status',
      header: t('common.status'),
      render: (p) =>
        p.is_blocked ? (
          <Badge tone="red">{t('admin.passengers.blocked')}</Badge>
        ) : (
          <Badge tone="green">OK</Badge>
        ),
    },
    { key: 'created', header: t('common.date'), render: (p) => formatDate(p.created_at) },
  ];
  return (
    <AdminPage title={t('admin.passengers.title')}>
      <form
        className="flex gap-2 mb-4"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(q);
          list.reset();
        }}
      >
        <input
          className="input max-w-xs"
          placeholder={t('admin.passengers.searchPlaceholder')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label={t('common.search')}
        />
        <button type="submit" className="btn-dark">
          {t('common.search')}
        </button>
      </form>
      <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
        <div>
          <DataTable
            columns={columns}
            rows={list.rows}
            rowKey={(p) => p.id}
            selectedKey={selected?.id ?? null}
            onRowClick={setSelected}
            loading={list.isPending}
            error={list.error}
            onRetry={() => void list.refetch()}
          />
          <Pager hasNext={list.hasNext} hasPrev={list.hasPrev} onNext={list.next} onPrev={list.prev} />
        </div>
        <aside className="card h-fit">
          {selected ? (
            <div className="space-y-3">
              <h2 className="font-extrabold text-lg">
                {selected.first_name} {selected.last_name}
              </h2>
              <div>
                <Stat label={t('common.phone')}>{selected.phone_number}</Stat>
                <Stat label={t('admin.passengers.walletBalance')}>
                  <Money value={selected.wallet_balance} />
                </Stat>
                <Stat label={t('admin.passengers.ridesCount')}>{selected.rides_count}</Stat>
                <Stat label={t('common.status')}>
                  {selected.is_blocked ? t('admin.passengers.blocked') : 'OK'}
                </Stat>
              </div>
              <div className="flex flex-wrap gap-2">
                {selected.is_blocked ? (
                  <Button loading={act.isPending} onClick={() => act.mutate({ action: 'unblock' })}>
                    {t('admin.passengers.unblock')}
                  </Button>
                ) : (
                  <Button variant="danger" onClick={() => setBlockOpen(true)}>
                    {t('admin.passengers.block')}
                  </Button>
                )}
                <Button
                  variant="secondary"
                  loading={act.isPending}
                  onClick={() => act.mutate({ action: 'logout' })}
                >
                  {t('admin.passengers.logoutAll')}
                </Button>
              </div>
              <ErrorBox error={act.error} />
              <h3 className="font-extrabold">{t('admin.passengers.history')}</h3>
              <ul className="text-sm divide-y divide-gray-100 max-h-80 overflow-y-auto">
                {(history.data?.results ?? []).map((r) => (
                  <li key={r.id} className="py-2">
                    <Link to={`/admin/rides/${r.id}`} className="flex justify-between gap-2 hover:underline">
                      <span className="truncate">
                        {formatDateTime(r.requested_at)} · {r.dropoff.address}
                      </span>
                      <Badge tone={rideTone(r.status)}>{t(`status.${r.status}`)}</Badge>
                    </Link>
                  </li>
                ))}
                {history.data && history.data.results.length === 0 && (
                  <li className="py-2 text-gray-500">{t('common.none')}</li>
                )}
              </ul>
            </div>
          ) : (
            <p className="text-gray-500">{t('admin.drivers.noSelection')}</p>
          )}
        </aside>
      </div>
      <ReasonModal
        open={blockOpen}
        title={t('admin.passengers.block')}
        danger
        onClose={() => setBlockOpen(false)}
        loading={act.isPending}
        error={act.error}
        onConfirm={(reason) => act.mutate({ action: 'block', reason })}
      />
    </AdminPage>
  );
}
