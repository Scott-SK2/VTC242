import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { meApi, uploadFile, authApi } from '@/shared/api/endpoints';
import { useAuthStore } from '@/shared/store/auth';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { ModeSwitch } from './ModeSwitch';
import { formatDate } from '@/shared/utils/date';
import { TextField } from './Field';
import { Button } from './Button';
import { Modal } from './Modal';
import { ErrorBox } from './ErrorBox';
import { toast } from '@/shared/store/ui';
import { useUiStore } from '@/shared/store/ui';
import { isStandalone } from '@/pwa';

export function ProfileForm({ photoRequired = false }: { photoRequired?: boolean }) {
  const { t } = useTranslation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const logout = useAuthStore((s) => s.logout);
  const refresh = useAuthStore((s) => s.refreshToken);
  const installPrompt = useUiStore((s) => s.installPromptEvent);
  const [first, setFirst] = useState(user?.first_name ?? '');
  const [last, setLast] = useState(user?.last_name ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [uploading, setUploading] = useState(false);

  const save = useMutation({
    mutationFn: () => meApi.patch({ first_name: first.trim(), last_name: last.trim() }),
    onSuccess: (u) => {
      setUser(u);
      toast(t('passenger.profile.saved'), 'success');
    },
  });
  const del = useMutation({
    mutationFn: () => meApi.delete(),
    onSuccess: () => {
      logout();
      nav('/login', { replace: true });
    },
  });

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadFile('profile_photo', file);
      const u = await meApi.patch({ photo_url: url });
      setUser(u);
      void qc.invalidateQueries({ queryKey: ['me'] });
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setUploading(false);
    }
  }

  async function doLogout() {
    try {
      if (refresh) await authApi.logout(refresh);
    } catch {
      /* ignoré */
    }
    logout();
    qc.clear();
    nav('/login', { replace: true });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  if (!user) return null;
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ');
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <section className="card flex items-center gap-4">
        <div className="relative">
          <Avatar src={user.photo_url} name={user.first_name || user.phone_number} size={72} />
          <label
            className="absolute -bottom-1 -right-1 h-8 w-8 rounded-full bg-white border border-gray-200 shadow flex items-center justify-center cursor-pointer text-gray-700"
            title={t('passenger.profile.changePhoto')}
          >
            {uploading ? <span className="text-xs">…</span> : <Icon name="camera" size={16} />}
            <span className="sr-only">{t('passenger.profile.changePhoto')}</span>
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => void onPhoto(e.target.files?.[0])}
              disabled={uploading}
            />
          </label>
        </div>
        <div className="min-w-0">
          <div className="text-lg font-extrabold truncate">{fullName || t('passenger.profile.title')}</div>
          <div className="text-sm text-gray-600">{user.phone_number}</div>
          <div className="mt-1 text-xs text-gray-500">
            {t('profile.memberSince', { date: formatDate(user.created_at) })}
          </div>
          {photoRequired && !user.photo_url && (
            <p className="text-xs text-alert mt-1">{t('profile.photoRequired')}</p>
          )}
        </div>
      </section>
      <ModeSwitch />
      <section className="card">
        <h2 className="font-extrabold mb-3">{t('profile.info')}</h2>
        <TextField
          label={t('common.firstName')}
          value={first}
          onChange={(e) => setFirst(e.target.value)}
          autoComplete="given-name"
        />
        <TextField
          label={t('common.lastName')}
          value={last}
          onChange={(e) => setLast(e.target.value)}
          autoComplete="family-name"
        />
        <ErrorBox error={save.error} />
        <Button type="submit" block loading={save.isPending}>
          {t('common.save')}
        </Button>
      </section>
      <section className="card p-0 overflow-hidden" aria-label={t('profile.account')}>
        {!isStandalone() && installPrompt && (
          <button type="button" className="profile-row" onClick={() => nav('/install')}>
            <Icon name="phone" size={20} className="text-gray-500" />
            <span className="flex-1">{t('passenger.profile.install')}</span>
            <Icon name="chevron" size={18} className="text-gray-400" />
          </button>
        )}
        <button type="button" className="profile-row" onClick={() => void doLogout()}>
          <Icon name="logout" size={20} className="text-gray-500" />
          <span className="flex-1">{t('common.logout')}</span>
          <Icon name="chevron" size={18} className="text-gray-400" />
        </button>
        <button type="button" className="profile-row text-alert" onClick={() => setConfirmDelete(true)}>
          <Icon name="trash" size={20} />
          <span className="flex-1">{t('passenger.profile.deleteTitle')}</span>
        </button>
      </section>
      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={t('passenger.profile.deleteTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" loading={del.isPending} onClick={() => del.mutate()}>
              {t('passenger.profile.deleteConfirm')}
            </Button>
          </>
        }
      >
        <p>{t('passenger.profile.deleteHint')}</p>
        <ErrorBox error={del.error} />
      </Modal>
    </form>
  );
}
