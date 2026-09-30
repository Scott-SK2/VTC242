import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { adminApi } from '@/shared/api/endpoints';
import type { PayoutRequest, ReconciliationResult, Transaction } from '@/shared/api/types';
import { AdminPage, DataTable, KpiCard, Pager, useCursorQuery, type Column } from '../components';
import { Badge, Button, ErrorBox, Money, type BadgeTone } from '@/shared/ui';
import { formatMoney } from '@/shared/utils/money';
import { formatDateTime } from '@/shared/utils/date';
import { toast } from '@/shared/store/ui';

const tone: Record<string, BadgeTone> = {
  pending: 'yellow',
  completed: 'green',
  failed: 'red',
  expired: 'neutral',
  approved: 'green',
  rejected: 'red',
};
type Tx = Transaction & { user?: { first_name: string; last_name: string; role: string } };

/** Finances (F-59) : résumé, transactions, retraits à traiter, import CSV de réconciliation, exports. */
export default function FinancePage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const summary = useQuery({
    queryKey: ['admin', 'finance', 'summary'],
    queryFn: adminApi.financeSummary,
    refetchInterval: 60_000,
  });
  const [filters, setFilters] = useState({ type: '', status: '', operator: '' });
  const tx = useCursorQuery(['admin', 'finance', 'tx', filters], (cursor) =>
    adminApi.financeTransactions({ ...filters, cursor }),
  );
  const payouts = useQuery({
    queryKey: ['admin', 'finance', 'payouts'],
    queryFn: () => adminApi.payouts('pending'),
  });
  const decide = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) =>
      approve ? adminApi.approvePayout(id) : adminApi.rejectPayout(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'finance'] });
      toast(t('common.ok'), 'success');
    },
  });
  const [recon, setRecon] = useState<ReconciliationResult | null>(null);
  const importCsv = useMutation({
    mutationFn: (f: File) => adminApi.importReconciliation(f),
    onSuccess: setRecon,
  });
  const [range, setRange] = useState({ from: '', to: '' });

  async function exportCsv(type: 'transactions' | 'rides') {
    try {
      const res = await adminApi.exportCsv(type, range.from || undefined, range.to || undefined);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vtc242-${type}-${range.from || 'debut'}-${range.to || 'fin'}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  const txColumns: Column<Tx>[] = [
    { key: 'at', header: t('common.date'), render: (x) => formatDateTime(x.created_at) },
    { key: 'type', header: t('admin.finance.type'), render: (x) => t(`transactions.${x.type}`) },
    {
      key: 'user',
      header: t('admin.finance.user'),
      render: (x) => (x.user ? `${x.user.first_name} ${x.user.last_name}` : '—'),
    },
    {
      key: 'amount',
      header: t('common.amount'),
      render: (x) => <Money value={x.amount} sign />,
      className: 'text-right',
    },
    {
      key: 'status',
      header: t('common.status'),
      render: (x) => <Badge tone={tone[x.status] ?? 'neutral'}>{t(`transactions.${x.status}`)}</Badge>,
    },
    {
      key: 'op',
      header: t('admin.finance.operator'),
      render: (x) => (x.operator ? t(`operators.${x.operator}`) : '—'),
    },
    {
      key: 'ref',
      header: t('common.reference'),
      render: (x) => <code className="text-xs">{x.external_reference ?? '—'}</code>,
    },
    { key: 'ride', header: t('admin.alerts.ride'), render: (x) => x.ride_id?.slice(0, 8) ?? '—' },
  ];
  const payoutColumns: Column<PayoutRequest>[] = [
    { key: 'at', header: t('common.date'), render: (p) => formatDateTime(p.created_at) },
    {
      key: 'driver',
      header: t('roles.driver'),
      render: (p) =>
        p.driver ? `${p.driver.first_name} ${p.driver.last_name}` : (p.driver_id?.slice(0, 8) ?? '—'),
    },
    {
      key: 'amount',
      header: t('common.amount'),
      render: (p) => <Money value={p.amount} />,
      className: 'text-right',
    },
    {
      key: 'op',
      header: t('admin.finance.operator'),
      render: (p) => `${t(`operators.${p.operator}`)} · ${p.phone_number}`,
    },
    {
      key: 'status',
      header: t('common.status'),
      render: (p) => <Badge tone={tone[p.status] ?? 'neutral'}>{p.status}</Badge>,
    },
    {
      key: 'actions',
      header: t('common.actions'),
      render: (p) =>
        p.status === 'pending' && (
          <div className="flex gap-2">
            <Button
              className="min-h-[36px] px-3 text-xs"
              loading={decide.isPending && decide.variables?.id === p.id}
              onClick={() => decide.mutate({ id: p.id, approve: true })}
            >
              {t('admin.finance.approvePayout')}
            </Button>
            <Button
              variant="danger"
              className="min-h-[36px] px-3 text-xs"
              onClick={() => decide.mutate({ id: p.id, approve: false })}
            >
              {t('admin.finance.rejectPayout')}
            </Button>
          </div>
        ),
    },
  ];
  const s = summary.data;
  return (
    <AdminPage title={t('admin.finance.title')}>
      <ErrorBox error={summary.error} onRetry={() => void summary.refetch()} />
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))] mb-6">
        <KpiCard label={t('admin.finance.wallets_total')} value={s ? formatMoney(s.wallets_total) : '—'} />
        <KpiCard
          label={t('admin.finance.reserved_total')}
          value={s ? formatMoney(s.reserved_total) : '—'}
          tone="yellow"
        />
        <KpiCard
          label={t('admin.finance.payouts_pending')}
          value={s ? formatMoney(s.payouts_pending) : '—'}
          tone="red"
        />
        <KpiCard label={t('admin.finance.deposits_today')} value={s ? formatMoney(s.deposits_today) : '—'} />
        <KpiCard
          label={t('admin.finance.commission_today')}
          value={s ? formatMoney(s.commission_today) : '—'}
          tone="green"
        />
      </div>

      <section className="mb-6">
        <h2 className="font-extrabold text-lg mb-2">{t('admin.finance.payouts')}</h2>
        <DataTable
          columns={payoutColumns}
          rows={payouts.data?.results ?? []}
          rowKey={(p) => p.id}
          loading={payouts.isPending}
          error={payouts.error}
          onRetry={() => void payouts.refetch()}
        />
        <ErrorBox error={decide.error} />
      </section>

      <section className="mb-6">
        <h2 className="font-extrabold text-lg mb-2">{t('admin.finance.transactions')}</h2>
        <div className="flex flex-wrap gap-2 mb-2">
          <select
            className="input max-w-[200px]"
            value={filters.type}
            onChange={(e) => {
              setFilters({ ...filters, type: e.target.value });
              tx.reset();
            }}
            aria-label={t('admin.finance.type')}
          >
            <option value="">
              {t('admin.finance.type')} : {t('common.all')}
            </option>
            {[
              'deposit',
              'ride_payment',
              'ride_earning',
              'commission',
              'payout',
              'refund',
              'cancellation_fee',
              'adjustment',
            ].map((k) => (
              <option key={k} value={k}>
                {t(`transactions.${k}`)}
              </option>
            ))}
          </select>
          <select
            className="input max-w-[200px]"
            value={filters.status}
            onChange={(e) => {
              setFilters({ ...filters, status: e.target.value });
              tx.reset();
            }}
            aria-label={t('common.status')}
          >
            <option value="">
              {t('common.status')} : {t('common.all')}
            </option>
            {['pending', 'completed', 'failed', 'expired'].map((k) => (
              <option key={k} value={k}>
                {t(`transactions.${k}`)}
              </option>
            ))}
          </select>
          <select
            className="input max-w-[200px]"
            value={filters.operator}
            onChange={(e) => {
              setFilters({ ...filters, operator: e.target.value });
              tx.reset();
            }}
            aria-label={t('admin.finance.operator')}
          >
            <option value="">
              {t('admin.finance.operator')} : {t('common.all')}
            </option>
            <option value="mtn">{t('operators.mtn')}</option>
            <option value="airtel">{t('operators.airtel')}</option>
          </select>
        </div>
        <DataTable
          columns={txColumns}
          rows={tx.rows}
          rowKey={(x) => x.id}
          loading={tx.isPending}
          error={tx.error}
          onRetry={() => void tx.refetch()}
        />
        <Pager hasNext={tx.hasNext} hasPrev={tx.hasPrev} onNext={tx.next} onPrev={tx.prev} />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card">
          <h2 className="font-extrabold text-lg mb-1">{t('admin.finance.reconciliation')}</h2>
          <p className="text-sm text-gray-600 mb-3">{t('admin.finance.reconciliationHint')}</p>
          <label className="btn-dark cursor-pointer">
            {importCsv.isPending ? t('common.loading') : t('admin.finance.import')}
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(e) => e.target.files?.[0] && importCsv.mutate(e.target.files[0])}
            />
          </label>
          <ErrorBox error={importCsv.error} />
          {recon && (
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-brand-light p-3">
                <div className="text-2xl font-extrabold">{recon.matched}</div>
                <div className="text-xs">{t('admin.finance.matched')}</div>
              </div>
              <div className="rounded-xl bg-alert-light p-3">
                <div className="text-2xl font-extrabold">{recon.mismatched.length}</div>
                <div className="text-xs">{t('admin.finance.mismatched')}</div>
              </div>
              <div className="rounded-xl bg-code-light p-3">
                <div className="text-2xl font-extrabold">{recon.missing.length}</div>
                <div className="text-xs">{t('admin.finance.missing')}</div>
              </div>
              {(recon.mismatched.length > 0 || recon.missing.length > 0) && (
                <pre className="col-span-3 text-left text-xs bg-gray-50 rounded-xl p-2 max-h-48 overflow-auto">
                  {JSON.stringify({ mismatched: recon.mismatched, missing: recon.missing }, null, 2)}
                </pre>
              )}
            </div>
          )}
        </section>
        <section className="card">
          <h2 className="font-extrabold text-lg mb-3">{t('admin.finance.exports')}</h2>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <label className="text-sm">
              <span className="label">{t('common.from')}</span>
              <input
                type="date"
                className="input"
                value={range.from}
                onChange={(e) => setRange({ ...range, from: e.target.value })}
              />
            </label>
            <label className="text-sm">
              <span className="label">{t('common.to')}</span>
              <input
                type="date"
                className="input"
                value={range.to}
                onChange={(e) => setRange({ ...range, to: e.target.value })}
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => void exportCsv('transactions')}>
              {t('admin.finance.exportTransactions')}
            </Button>
            <Button variant="secondary" onClick={() => void exportCsv('rides')}>
              {t('admin.finance.exportRides')}
            </Button>
          </div>
        </section>
      </div>
    </AdminPage>
  );
}
