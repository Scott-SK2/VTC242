import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { adminApi } from '@/shared/api/endpoints';
import type { AdminDispute, AdminRide } from '@/shared/api/types';
import { MapView, type MapMarker } from '@/shared/map';
import { AdminPage, DataTable, Pager, Stat, useCursorQuery, type Column } from '../components';
import { Badge, Button, ErrorBox, Money, Tabs, TextAreaField, TextField } from '@/shared/ui';
import { formatDateTime } from '@/shared/utils/date';
import { useAuthStore } from '@/shared/store/auth';
import { toast } from '@/shared/store/ui';

type Status = 'open' | 'resolved' | 'rejected';

/** Litiges (F-58) : prévu / réel côte à côte, remboursement total ou partiel, rejet motivé. */
export default function DisputesPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const { id } = useParams<{ id?: string }>();
  const [status, setStatus] = useState<Status>('open');
  const list = useCursorQuery(['admin', 'disputes', status], (c) => adminApi.disputes(status, c));
  const columns: Column<AdminDispute>[] = [
    { key: 'at', header: t('common.date'), render: (d) => formatDateTime(d.created_at) },
    {
      key: 'status',
      header: t('common.status'),
      render: (d) => (
        <Badge tone={d.status === 'open' ? 'yellow' : d.status === 'resolved' ? 'green' : 'red'}>
          {t(`admin.disputes.${d.status}`)}
        </Badge>
      ),
    },
    {
      key: 'reason',
      header: t('admin.disputes.reason'),
      render: (d) => <span className="block max-w-[320px] truncate">{d.reason}</span>,
    },
    { key: 'ride', header: t('admin.alerts.ride'), render: (d) => d.ride_id.slice(0, 8) },
    {
      key: 'refund',
      header: t('admin.disputes.refundAmount'),
      render: (d) => <Money value={d.refund_amount} />,
    },
  ];
  return (
    <AdminPage title={t('admin.disputes.title')}>
      <Tabs
        value={status}
        onChange={(v) => {
          setStatus(v);
          list.reset();
        }}
        items={(['open', 'resolved', 'rejected'] as Status[]).map((s) => ({
          value: s,
          label: t(`admin.disputes.${s}`),
        }))}
        className="max-w-md mb-4"
      />
      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <div>
          <DataTable
            columns={columns}
            rows={list.rows}
            rowKey={(d) => d.id}
            selectedKey={id ?? null}
            onRowClick={(d) => nav(`/admin/disputes/${d.id}`)}
            loading={list.isPending}
            error={list.error}
            onRetry={() => void list.refetch()}
          />
          <Pager hasNext={list.hasNext} hasPrev={list.hasPrev} onNext={list.next} onPrev={list.prev} />
        </div>
        {id ? (
          <DisputeDetail id={id} />
        ) : (
          <div className="card text-gray-500 h-fit">{t('admin.disputes.noSelection')}</div>
        )}
      </div>
    </AdminPage>
  );
}

function RouteMap({ ride, kind }: { ride: AdminRide; kind: 'planned' | 'actual' }) {
  const coords =
    kind === 'planned'
      ? ride.planned_route
      : (ride.actual_route ??
        (ride.positions?.length ? ride.positions.map((p) => [p.lng, p.lat] as [number, number]) : null));
  const markers: MapMarker[] = [
    { id: 'p', ...ride.pickup, kind: 'pickup' },
    { id: 'd', ...ride.dropoff, kind: 'dropoff' },
  ];
  return (
    <MapView
      markers={markers}
      routes={coords?.length ? [{ id: kind, coords, color: kind === 'planned' ? '#1E9B45' : '#C8202C' }] : []}
      fit={[ride.pickup, ride.dropoff]}
      fitKey={ride.id + kind}
      interactive={false}
    />
  );
}

function DisputeDetail({ id }: { id: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const role = useAuthStore((s) => s.user?.role);
  const canDecide = role === 'admin' || role === 'finance';
  const q = useQuery({ queryKey: ['admin', 'dispute', id], queryFn: () => adminApi.dispute(id) });
  const [refund, setRefund] = useState('');
  const [resolution, setResolution] = useState('');
  const done = () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'disputes'] });
    void qc.invalidateQueries({ queryKey: ['admin', 'dispute', id] });
    toast(t('admin.disputes.resolved'), 'success');
  };
  const resolve = useMutation({
    mutationFn: () => adminApi.resolveDispute(id, refund, resolution),
    onSuccess: done,
  });
  const reject = useMutation({ mutationFn: () => adminApi.rejectDispute(id, resolution), onSuccess: done });
  const d = q.data;
  if (!d)
    return (
      <div className="card">
        <ErrorBox error={q.error} />
      </div>
    );
  const ride = d.ride;
  const price = Number(ride?.final_price ?? 0);
  return (
    <div className="card space-y-4 h-fit">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-extrabold text-lg">
          {t('nav.disputes')} {d.id.slice(0, 8)}
        </h2>
        <Badge tone={d.status === 'open' ? 'yellow' : d.status === 'resolved' ? 'green' : 'red'}>
          {t(`admin.disputes.${d.status}`)}
        </Badge>
      </div>
      <p className="rounded-xl bg-gray-50 p-3 text-sm">
        <span className="text-gray-600">{t('admin.disputes.reason')} :</span> {d.reason}
      </p>
      {ride && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div>
              <div className="text-xs font-semibold mb-1 text-brand-dark">{t('admin.disputes.planned')}</div>
              <div className="h-56 rounded-xl overflow-hidden border">
                <RouteMap ride={ride} kind="planned" />
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold mb-1 text-alert">{t('admin.disputes.actual')}</div>
              <div className="h-56 rounded-xl overflow-hidden border">
                <RouteMap ride={ride} kind="actual" />
              </div>
            </div>
          </div>
          <div>
            <Stat label={t('admin.alerts.ride')}>
              <Link to={`/admin/rides/${ride.id}`} className="underline">
                {ride.id.slice(0, 8)}
              </Link>{' '}
              · {formatDateTime(ride.requested_at)}
            </Stat>
            <Stat label={t('passenger.done.finalPrice')}>
              <Money value={ride.final_price} />
            </Stat>
            <Stat label={t('roles.passenger')}>{ride.passenger?.first_name ?? '—'}</Stat>
            <Stat label={t('roles.driver')}>{ride.driver?.first_name ?? '—'}</Stat>
          </div>
        </>
      )}
      {d.status !== 'open' && (
        <p className="text-sm">
          <span className="text-gray-600">{t('admin.disputes.resolution')} :</span> {d.resolution}{' '}
          {d.refund_amount && (
            <>
              · <Money value={d.refund_amount} />
            </>
          )}
        </p>
      )}
      {d.status === 'open' && canDecide && (
        <div className="space-y-2">
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <TextField
                label={t('admin.disputes.refundAmount')}
                inputMode="decimal"
                value={refund}
                onChange={(e) => setRefund(e.target.value)}
              />
            </div>
            <Button variant="secondary" className="mb-3" onClick={() => setRefund(price.toFixed(2))}>
              {t('admin.disputes.refundFull')}
            </Button>
            <Button variant="secondary" className="mb-3" onClick={() => setRefund((price / 2).toFixed(2))}>
              {t('admin.disputes.refundHalf')}
            </Button>
          </div>
          <TextAreaField
            label={t('admin.disputes.resolution')}
            hint={t('admin.disputes.rejectHint')}
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
          />
          <ErrorBox error={resolve.error ?? reject.error} />
          <div className="flex gap-2 justify-end">
            <Button
              variant="danger"
              loading={reject.isPending}
              disabled={resolution.trim().length < 3}
              onClick={() => reject.mutate()}
            >
              {t('admin.disputes.reject')}
            </Button>
            <Button
              loading={resolve.isPending}
              disabled={!refund || resolution.trim().length < 3}
              onClick={() => resolve.mutate()}
            >
              {t('admin.disputes.refund')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
