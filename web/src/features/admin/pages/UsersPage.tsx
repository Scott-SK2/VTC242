import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { adminApi, asList } from '@/shared/api/endpoints';
import type { User } from '@/shared/api/types';
import { AdminPage, DataTable, type Column } from '../components';
import { Badge, Button, ErrorBox, Modal, SelectField, TextField } from '@/shared/ui';
import { formatDate } from '@/shared/utils/date';
import { normalizePhone, isValidCongoPhone } from '@/shared/utils/phone';
import { toast } from '@/shared/store/ui';

const ROLES = ['admin', 'finance', 'support'] as const;

export default function UsersPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [role, setRole] = useState('');
  const users = useQuery({
    queryKey: ['admin', 'users', role],
    queryFn: () => adminApi.users(role || undefined),
    select: asList,
  });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ phone_number: '', first_name: '', last_name: '', role: 'support' });
  const create = useMutation({
    mutationFn: () => adminApi.createUser({ ...form, phone_number: normalizePhone(form.phone_number) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      setOpen(false);
      toast(t('admin.users.created'), 'success');
    },
  });
  const columns: Column<User>[] = [
    {
      key: 'name',
      header: t('common.name'),
      render: (u) => (
        <span className="font-semibold">
          {u.first_name} {u.last_name}
        </span>
      ),
    },
    { key: 'phone', header: t('common.phone'), render: (u) => u.phone_number },
    {
      key: 'role',
      header: t('common.role'),
      render: (u) => <Badge tone="dark">{t(`roles.${u.role}`)}</Badge>,
    },
    {
      key: 'totp',
      header: t('admin.users.totp'),
      render: (u) => (u.totp_enabled ? t('common.yes') : t('common.no')),
    },
    { key: 'active', header: t('common.status'), render: (u) => (u.is_active ? 'OK' : '—') },
    { key: 'created', header: t('common.date'), render: (u) => formatDate(u.created_at) },
  ];
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!isValidCongoPhone(form.phone_number)) return toast(t('auth.phoneInvalid'), 'error');
    create.mutate();
  }
  return (
    <AdminPage
      title={t('admin.users.title')}
      actions={<Button onClick={() => setOpen(true)}>{t('admin.users.new')}</Button>}
    >
      <select
        className="input max-w-[220px] mb-4"
        value={role}
        onChange={(e) => setRole(e.target.value)}
        aria-label={t('common.role')}
      >
        <option value="">
          {t('common.role')} : {t('common.all')}
        </option>
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {t(`roles.${r}`)}
          </option>
        ))}
      </select>
      <DataTable
        columns={columns}
        rows={users.data ?? []}
        rowKey={(u) => u.id}
        loading={users.isPending}
        error={users.error}
        onRetry={() => void users.refetch()}
      />
      <Modal open={open} onClose={() => setOpen(false)} title={t('admin.users.new')}>
        <form onSubmit={submit} noValidate>
          <TextField
            label={t('common.phone')}
            type="tel"
            value={form.phone_number}
            onChange={(e) => setForm({ ...form, phone_number: e.target.value })}
          />
          <TextField
            label={t('common.firstName')}
            value={form.first_name}
            onChange={(e) => setForm({ ...form, first_name: e.target.value })}
          />
          <TextField
            label={t('common.lastName')}
            value={form.last_name}
            onChange={(e) => setForm({ ...form, last_name: e.target.value })}
          />
          <SelectField
            label={t('common.role')}
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`roles.${r}`)}
              </option>
            ))}
          </SelectField>
          <ErrorBox error={create.error} />
          <Button
            type="submit"
            block
            loading={create.isPending}
            className="mt-2"
            disabled={!form.first_name || !form.phone_number}
          >
            {t('common.create')}
          </Button>
        </form>
      </Modal>
    </AdminPage>
  );
}
