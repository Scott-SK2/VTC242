import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { meApi } from '@/shared/api/endpoints';
import { useAuthStore } from '@/shared/store/auth';
import { toast } from '@/shared/store/ui';
import { TextField } from './Field';
import { Button } from './Button';
import { ErrorBox } from './ErrorBox';

/**
 * Invite à renseigner prénom et nom quand le profil est incomplet (F-03) : le prénom est ce que
 * l'autre partie voit (jamais le numéro). Affichée sur l'accueil passager et chauffeur.
 */
export function NameCard() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const save = useMutation({
    mutationFn: () => meApi.patch({ first_name: first.trim(), last_name: last.trim() }),
    onSuccess: (u) => {
      setUser(u);
      toast(t('profile.nameSaved'), 'success');
    },
  });
  if (!user || user.first_name) return null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (first.trim().length < 2) return;
    save.mutate();
  };
  return (
    <form
      onSubmit={submit}
      className="rounded-xl bg-code-light p-3 mb-3 text-sm"
      aria-labelledby="name-card-title"
    >
      <p id="name-card-title" className="font-semibold">
        {t('profile.nameTitle')}
      </p>
      <p className="text-gray-700 mb-2">{t('profile.nameHint')}</p>
      <div className="grid grid-cols-2 gap-2">
        <TextField
          label={t('profile.firstName')}
          value={first}
          onChange={(e) => setFirst(e.target.value)}
          autoComplete="given-name"
          required
        />
        <TextField
          label={t('profile.lastName')}
          value={last}
          onChange={(e) => setLast(e.target.value)}
          autoComplete="family-name"
        />
      </div>
      <ErrorBox error={save.error} />
      <Button type="submit" block loading={save.isPending} disabled={first.trim().length < 2}>
        {t('common.save')}
      </Button>
    </form>
  );
}
