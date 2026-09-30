import { useTranslation } from 'react-i18next';
import { adminApi } from '@/shared/api/endpoints';
import type { AuditLog } from '@/shared/api/types';
import { AdminPage, DataTable, Pager, useCursorQuery, type Column } from '../components';
import { formatDateTime } from '@/shared/utils/date';

export default function AuditPage() {
  const { t } = useTranslation();
  const list = useCursorQuery(['admin', 'audit'], (c) => adminApi.auditLogs(c));
  const columns: Column<AuditLog>[] = [
    { key: 'at', header: t('common.date'), render: (l) => formatDateTime(l.created_at) },
    {
      key: 'actor',
      header: t('admin.audit.actor'),
      render: (l) =>
        typeof l.actor === 'string' ? l.actor : l.actor ? `${l.actor.first_name} ${l.actor.last_name}` : '—',
    },
    {
      key: 'action',
      header: t('admin.audit.action'),
      render: (l) => <code className="text-xs font-semibold">{l.action}</code>,
    },
    {
      key: 'target',
      header: t('admin.audit.target'),
      render: (l) => `${l.target_type} ${l.target_id?.slice(0, 8) ?? ''}`,
    },
    {
      key: 'diff',
      header: t('admin.audit.diff'),
      render: (l) => (
        <code className="text-xs block max-w-[420px] truncate">{l.diff ? JSON.stringify(l.diff) : '—'}</code>
      ),
    },
  ];
  return (
    <AdminPage title={t('admin.audit.title')}>
      <DataTable
        columns={columns}
        rows={list.rows}
        rowKey={(l) => l.id}
        loading={list.isPending}
        error={list.error}
        onRetry={() => void list.refetch()}
      />
      <Pager hasNext={list.hasNext} hasPrev={list.hasPrev} onNext={list.next} onPrev={list.prev} />
    </AdminPage>
  );
}
