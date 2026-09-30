import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { adminApi } from '@/shared/api/endpoints';
import { useWsEvent } from '@/shared/ws';
import type { Alert } from '@/shared/api/types';
import { AdminPage, DataTable, Pager, useCursorQuery, type Column } from '../components';
import { Badge, Button, Modal, Tabs } from '@/shared/ui';
import { formatDateTime } from '@/shared/utils/date';
import { SupportChat } from '../components/SupportChat';

/** Journal des alertes (F-52) : prise en charge par un opérateur et accès au chat. */
export default function AlertsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [status, setStatus] = useState<'open' | 'acknowledged'>('open');
  const [chatRide, setChatRide] = useState<string | null>(null);
  const list = useCursorQuery(['admin', 'alerts', status], (c) => adminApi.alerts(status, c));
  useWsEvent('admin.alert', () => void qc.invalidateQueries({ queryKey: ['admin', 'alerts'] }));
  const ack = useMutation({
    mutationFn: (id: string) => adminApi.ackAlert(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'alerts'] }),
  });
  const columns: Column<Alert>[] = [
    {
      key: 'type',
      header: t('common.status'),
      render: (a) => (
        <Badge tone={a.type === 'emergency' || a.type === 'deviation' ? 'red' : 'yellow'}>
          {t(`admin.alerts.types.${a.type}`)}
        </Badge>
      ),
    },
    { key: 'at', header: t('common.date'), render: (a) => formatDateTime(a.created_at) },
    { key: 'driver', header: t('roles.driver'), render: (a) => a.driver?.first_name ?? '—' },
    { key: 'passenger', header: t('roles.passenger'), render: (a) => a.passenger?.first_name ?? '—' },
    {
      key: 'payload',
      header: 'Détail',
      render: (a) => <code className="text-xs">{JSON.stringify(a.payload ?? {}).slice(0, 80)}</code>,
    },
    {
      key: 'actions',
      header: t('common.actions'),
      render: (a) => (
        <div className="flex gap-2 flex-wrap">
          {a.ride_id && (
            <Link to={`/admin/rides/${a.ride_id}`} className="btn-secondary min-h-[36px] px-3 text-xs">
              {t('admin.alerts.ride')}
            </Link>
          )}
          {a.ride_id && (
            <Button
              variant="secondary"
              className="min-h-[36px] px-3 text-xs"
              onClick={() => setChatRide(a.ride_id)}
            >
              {t('admin.alerts.chat')}
            </Button>
          )}
          {a.status === 'open' ? (
            <Button
              className="min-h-[36px] px-3 text-xs"
              loading={ack.isPending && ack.variables === a.id}
              onClick={() => ack.mutate(a.id)}
            >
              {t('admin.alerts.ack')}
            </Button>
          ) : (
            <Badge tone="green">
              {t('admin.alerts.acked')}
              {a.acknowledged_by ? ` · ${a.acknowledged_by}` : ''}
            </Badge>
          )}
        </div>
      ),
    },
  ];
  return (
    <AdminPage title={t('admin.alerts.title')}>
      <Tabs
        value={status}
        onChange={(v) => {
          setStatus(v);
          list.reset();
        }}
        items={[
          { value: 'open', label: t('admin.alerts.open') },
          { value: 'acknowledged', label: t('admin.alerts.acknowledged') },
        ]}
        className="max-w-sm mb-4"
      />
      <DataTable
        columns={columns}
        rows={list.rows}
        rowKey={(a) => a.id}
        loading={list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
      />
      <Pager hasNext={list.hasNext} hasPrev={list.hasPrev} onNext={list.next} onPrev={list.prev} />
      <Modal open={!!chatRide} onClose={() => setChatRide(null)} title={t('admin.rides.supportChat')}>
        {chatRide && <SupportChat rideId={chatRide} />}
      </Modal>
    </AdminPage>
  );
}
