import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { meApi, uploadFile, authApi } from '@/shared/api/endpoints';
import { useAuthStore } from '@/shared/store/auth';
import { Avatar } from './Avatar';
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
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="flex items-center gap-4">
        <Avatar src={user.photo_url} name={user.first_name || user.phone_number} size={72} />
        <div>
          <label className="btn-secondary cursor-pointer">
            {uploading ? t('driver.onboarding.uploading') : t('passenger.profile.changePhoto')}
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => void onPhoto(e.target.files?.[0])}
              disabled={uploading}
            />
          </label>
          {photoRequired && !user.photo_url && (
            <p className="text-xs text-alert mt-1">{t('common.required')}</p>
          )}
        </div>
      </div>
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
      <TextField label={t('common.phone')} value={user.phone_number} readOnly disabled />
      <ErrorBox error={save.error} />
      <Button type="submit" block loading={save.isPending}>
        {t('common.save')}
      </Button>
      {!isStandalone() && installPrompt && (
        <Button variant="secondary" block onClick={() => nav('/install')}>
          {t('passenger.profile.install')}
        </Button>
      )}
      <Button variant="secondary" block onClick={() => void doLogout()}>
        {t('common.logout')}
      </Button>
      <Button variant="ghost" block className="text-alert" onClick={() => setConfirmDelete(true)}>
        {t('passenger.profile.deleteTitle')}
      </Button>
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
