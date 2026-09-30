import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { adminApi } from '@/shared/api/endpoints';
import type { AdminDriver, DriverDocument } from '@/shared/api/types';
import { AdminPage, DataTable, Pager, ReasonModal, Stat, useCursorQuery, type Column } from '../components';
import { Badge, Button, ErrorBox, Modal, Tabs, TextField, Avatar, type BadgeTone } from '@/shared/ui';
import { formatDate, formatDateTime } from '@/shared/utils/date';
import { toast } from '@/shared/store/ui';

type Status = 'pending' | 'approved' | 'suspended' | 'rejected';
const tone: Record<string, BadgeTone> = {
  pending: 'yellow',
  approved: 'green',
  suspended: 'red',
  rejected: 'red',
  missing: 'neutral',
};

/** Chauffeurs (F-53) : file de validation, aperçu des documents, validation / refus / suspension. */
export default function DriversPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const { id } = useParams<{ id?: string }>();
  const [status, setStatus] = useState<Status>('pending');
  const [q, setQ] = useState('');
  const [applied, setApplied] = useState('');
  const list = useCursorQuery(['admin', 'drivers', status, applied], (cursor) =>
    adminApi.drivers({ status, q: applied || undefined, cursor }),
  );
  const columns: Column<AdminDriver>[] = [
    {
      key: 'name',
      header: t('common.name'),
      render: (d) => (
        <span className="font-semibold">
          {d.first_name} {d.last_name}
        </span>
      ),
    },
    { key: 'phone', header: t('common.phone'), render: (d) => d.phone_number },
    {
      key: 'status',
      header: t('common.status'),
      render: (d) => (
        <Badge tone={tone[d.driver.status] ?? 'neutral'}>{t(`admin.drivers.${d.driver.status}`)}</Badge>
      ),
    },
    {
      key: 'docs',
      header: t('admin.drivers.documents'),
      render: (d) =>
        `${(d.documents ?? []).filter((x) => x.status === 'approved').length} / ${(d.documents ?? []).length}`,
    },
    {
      key: 'vehicle',
      header: t('admin.drivers.vehicles'),
      render: (d) => (d.vehicles ?? []).find((v) => v.is_active)?.license_plate ?? '—',
    },
    {
      key: 'rating',
      header: t('admin.drivers.rating'),
      render: (d) => `★ ${d.driver.rating_avg?.toFixed(1) ?? '—'}`,
    },
    { key: 'created', header: t('common.date'), render: (d) => formatDate(d.created_at) },
  ];
  return (
    <AdminPage title={t('admin.drivers.title')}>
      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <Tabs
          value={status}
          onChange={(v) => {
            setStatus(v);
            list.reset();
          }}
          items={(['pending', 'approved', 'suspended', 'rejected'] as Status[]).map((s) => ({
            value: s,
            label: t(`admin.drivers.${s}`),
          }))}
          className="w-full max-w-lg"
        />
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setApplied(q);
            list.reset();
          }}
        >
          <input
            className="input max-w-xs"
            placeholder={t('admin.drivers.searchPlaceholder')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label={t('common.search')}
          />
          <button type="submit" className="btn-dark">
            {t('common.search')}
          </button>
        </form>
      </div>
      <div className="grid gap-4 xl:grid-cols-[1fr_460px]">
        <div>
          <DataTable
            columns={columns}
            rows={list.rows}
            rowKey={(d) => d.id}
            selectedKey={id ?? null}
            onRowClick={(d) => nav(`/admin/drivers/${d.id}`)}
            loading={list.isPending}
            error={list.error}
            onRetry={() => void list.refetch()}
          />
          <Pager hasNext={list.hasNext} hasPrev={list.hasPrev} onNext={list.next} onPrev={list.prev} />
        </div>
        <aside>
          {id ? (
            <DriverDetail id={id} fromList={list.rows.find((d) => d.id === id)} />
          ) : (
            <div className="card text-gray-500">{t('admin.drivers.noSelection')}</div>
          )}
        </aside>
      </div>
    </AdminPage>
  );
}

function DriverDetail({ id, fromList }: { id: string; fromList?: AdminDriver }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['admin', 'driver', id],
    queryFn: () => adminApi.driver(id),
    initialData: fromList,
    retry: false,
  });
  const [modal, setModal] = useState<'reject' | 'suspend' | null>(null);
  const [preview, setPreview] = useState<DriverDocument | null>(null);
  const [docNote, setDocNote] = useState('');
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'drivers'] });
    void qc.invalidateQueries({ queryKey: ['admin', 'driver', id] });
  };
  const act = useMutation({
    mutationFn: ({
      action,
      reason,
    }: {
      action: 'approve' | 'reject' | 'suspend' | 'reinstate';
      reason?: string;
    }) =>
      action === 'approve'
        ? adminApi.approveDriver(id)
        : action === 'reject'
          ? adminApi.rejectDriver(id, reason ?? '')
          : action === 'suspend'
            ? adminApi.suspendDriver(id, reason ?? '')
            : adminApi.reinstateDriver(id),
    onSuccess: (d) => {
      qc.setQueryData(['admin', 'driver', id], d);
      invalidate();
      setModal(null);
      toast(t('common.ok'), 'success');
    },
  });
  const review = useMutation({
    mutationFn: ({ doc, status }: { doc: DriverDocument; status: 'approved' | 'rejected' }) =>
      adminApi.reviewDocument(doc.id, status, status === 'rejected' ? docNote : undefined),
    onSuccess: () => {
      invalidate();
      setPreview(null);
      setDocNote('');
    },
  });
  const d = q.data;
  if (!d)
    return (
      <div className="card">
        <ErrorBox error={q.error} />
      </div>
    );
  const s = d.driver?.status;
  return (
    <div className="card space-y-4">
      <div className="flex items-center gap-3">
        <Avatar src={d.photo_url} name={d.first_name} size={56} />
        <div className="min-w-0">
          <h2 className="font-extrabold text-lg truncate">
            {d.first_name} {d.last_name}
          </h2>
          <div className="text-sm text-gray-600">{d.phone_number}</div>
        </div>
        <Badge tone={tone[s] ?? 'neutral'}>{t(`admin.drivers.${s}`)}</Badge>
      </div>
      <div>
        <Stat label={t('admin.drivers.rating')}>
          ★ {d.driver?.rating_avg?.toFixed(1) ?? '—'} ({d.driver?.rating_count ?? 0})
        </Stat>
        <Stat label={t('admin.drivers.consecutiveDeclines')}>{d.driver?.consecutive_declines ?? 0}</Stat>
        <Stat label={t('driver.onboarding.license_number')}>{d.driver?.license_number ?? '—'}</Stat>
        <Stat label={t('common.zone')}>{d.driver?.zone?.name ?? '—'}</Stat>
        <Stat label={t('common.date')}>{formatDateTime(d.created_at)}</Stat>
      </div>
      <div className="flex flex-wrap gap-2">
        {(s === 'pending' || s === 'rejected') && (
          <Button loading={act.isPending} onClick={() => act.mutate({ action: 'approve' })}>
            {t('admin.drivers.approve')}
          </Button>
        )}
        {s === 'pending' && (
          <Button variant="danger" onClick={() => setModal('reject')}>
            {t('admin.drivers.reject')}
          </Button>
        )}
        {s === 'approved' && (
          <Button variant="danger" onClick={() => setModal('suspend')}>
            {t('admin.drivers.suspend')}
          </Button>
        )}
        {s === 'suspended' && (
          <Button loading={act.isPending} onClick={() => act.mutate({ action: 'reinstate' })}>
            {t('admin.drivers.reinstate')}
          </Button>
        )}
      </div>
      <ErrorBox error={act.error} />
      <div>
        <h3 className="font-extrabold mb-2">{t('admin.drivers.documents')}</h3>
        <ul className="divide-y divide-gray-100">
          {(d.documents ?? []).map((doc) => (
            <li key={doc.id} className="py-2 flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm">{t(`driver.onboarding.docs.${doc.type}`)}</div>
                <div className="text-xs text-gray-500">
                  {formatDate(doc.created_at)}
                  {doc.expires_at ? ` · exp. ${formatDate(doc.expires_at)}` : ''}
                  {doc.review_note ? ` · ${doc.review_note}` : ''}
                </div>
              </div>
              <Badge tone={tone[doc.status] ?? 'neutral'}>
                {t(`driver.onboarding.docStatus.${doc.status}`)}
              </Badge>
              <Button
                variant="secondary"
                className="min-h-[36px] px-3 text-xs"
                onClick={() => setPreview(doc)}
              >
                {t('admin.drivers.preview')}
              </Button>
            </li>
          ))}
          {!d.documents?.length && <li className="py-2 text-sm text-gray-500">{t('common.none')}</li>}
        </ul>
      </div>
      <div>
        <h3 className="font-extrabold mb-2">{t('admin.drivers.vehicles')}</h3>
        <ul className="text-sm space-y-1">
          {(d.vehicles ?? []).map((v) => (
            <li key={v.id} className="flex flex-wrap gap-2 items-center">
              <span>
                {v.brand} {v.model} · {v.color} · <strong>{v.license_plate}</strong> ·{' '}
                {t(`categories.${v.category}`)}
              </span>
              {v.is_active && <Badge tone="green">{t('driver.onboarding.active')}</Badge>}
              {v.is_verified && <Badge tone="blue">{t('driver.onboarding.verified')}</Badge>}
            </li>
          ))}
          {!d.vehicles?.length && <li className="text-gray-500">{t('common.none')}</li>}
        </ul>
      </div>
      <ReasonModal
        open={modal === 'reject'}
        title={t('admin.drivers.reject')}
        danger
        onClose={() => setModal(null)}
        loading={act.isPending}
        error={act.error}
        onConfirm={(reason) => act.mutate({ action: 'reject', reason })}
      />
      <ReasonModal
        open={modal === 'suspend'}
        title={t('admin.drivers.suspend')}
        danger
        onClose={() => setModal(null)}
        loading={act.isPending}
        error={act.error}
        onConfirm={(reason) => act.mutate({ action: 'suspend', reason })}
      />
      <Modal
        open={!!preview}
        onClose={() => setPreview(null)}
        title={preview ? t(`driver.onboarding.docs.${preview.type}`) : ''}
        footer={
          preview &&
          preview.status !== 'approved' && (
            <>
              <Button
                variant="danger"
                loading={review.isPending}
                disabled={docNote.trim().length < 3}
                onClick={() => review.mutate({ doc: preview, status: 'rejected' })}
              >
                {t('admin.drivers.docReject')}
              </Button>
              <Button
                loading={review.isPending}
                onClick={() => review.mutate({ doc: preview, status: 'approved' })}
              >
                {t('admin.drivers.docApprove')}
              </Button>
            </>
          )
        }
      >
        {preview && (
          <div>
            {/\.pdf($|\?)/i.test(preview.file_url) ? (
              <iframe
                src={preview.file_url}
                title={preview.type}
                className="w-full h-[50vh] rounded-xl border"
              />
            ) : (
              <img
                src={preview.file_url}
                alt={t(`driver.onboarding.docs.${preview.type}`)}
                className="w-full max-h-[50vh] object-contain rounded-xl bg-gray-100"
              />
            )}
            <a
              href={preview.file_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm underline mt-2 inline-block"
            >
              {t('admin.drivers.openFile')}
            </a>
            {preview.status !== 'approved' && (
              <TextField
                label={t('admin.drivers.docNote')}
                value={docNote}
                onChange={(e) => setDocNote(e.target.value)}
                className="mt-2"
              />
            )}
            <ErrorBox error={review.error} />
          </div>
        )}
      </Modal>
    </div>
  );
}
