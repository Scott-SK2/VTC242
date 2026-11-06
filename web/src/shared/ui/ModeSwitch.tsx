import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { meApi } from '@/shared/api/endpoints';
import { isApiError } from '@/shared/api/client';
import { useAuthStore, homeForRole } from '@/shared/store/auth';
import { toast } from '@/shared/store/ui';
import { Button } from './Button';
import { Modal } from './Modal';
import { ErrorBox } from './ErrorBox';
import { Icon } from './Icon';

type Mode = 'passenger' | 'driver';

/**
 * Un même compte peut être passager et chauffeur : sélecteur du mode actif. La bascule renouvelle
 * la session (nouveaux jetons) et ouvre l'accueil du mode choisi ; le wallet est commun.
 */
export function ModeSwitch() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const setTokens = useAuthStore((s) => s.setTokens);
  const setUser = useAuthStore((s) => s.setUser);
  const [target, setTarget] = useState<Mode | null>(null);
  const switchMode = useMutation({
    mutationFn: (role: Mode) => meApi.switchMode(role),
    onSuccess: (res) => {
      setTokens(res.access, res.refresh);
      setUser(res.user);
      qc.clear();
      setTarget(null);
      toast(t('mode.switched', { mode: t(`roles.${res.user.role}`) }), 'success');
      nav(
        res.user.role === 'driver' && !res.user.driver?.can_go_online
          ? '/d/onboarding'
          : homeForRole(res.user.role),
        {
          replace: true,
        },
      );
    },
    onError: (e) => {
      if (isApiError(e) && e.status === 409) {
        setTarget(null);
        toast(e.message, 'error');
      }
    },
  });
  if (!user || (user.role !== 'passenger' && user.role !== 'driver')) return null;
  const current = user.role as Mode;
  const firstTimeDriver = !user.has_driver_profile;
  const items: Array<{ value: Mode; icon: 'user' | 'steering' }> = [
    { value: 'passenger', icon: 'user' },
    { value: 'driver', icon: 'steering' },
  ];
  return (
    <section className="card" aria-labelledby="mode-title">
      <div className="flex items-center gap-2 mb-1">
        <Icon name="swap" size={20} className="text-brand" />
        <h2 id="mode-title" className="font-extrabold">
          {t('mode.title')}
        </h2>
      </div>
      <p className="text-sm text-gray-600 mb-3">{t('mode.hint')}</p>
      <div role="radiogroup" aria-labelledby="mode-title" className="grid grid-cols-2 gap-2">
        {items.map((it) => {
          const active = it.value === current;
          return (
            <button
              key={it.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => !active && setTarget(it.value)}
              className={`flex flex-col items-start gap-1 rounded-2xl border-2 p-3 text-left min-h-tap transition-colors ${
                active ? 'border-brand bg-brand-light' : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <Icon name={it.icon} size={22} className={active ? 'text-brand-dark' : 'text-gray-500'} />
              <span className="font-bold">{t(`roles.${it.value}`)}</span>
              <span className="text-xs text-gray-600">{active ? t('mode.active') : t('mode.switchTo')}</span>
            </button>
          );
        })}
      </div>
      <Modal
        open={!!target}
        onClose={() => setTarget(null)}
        title={target ? t('mode.confirmTitle', { mode: t(`roles.${target}`) }) : ''}
        footer={
          <>
            <Button variant="secondary" onClick={() => setTarget(null)}>
              {t('common.cancel')}
            </Button>
            <Button loading={switchMode.isPending} onClick={() => target && switchMode.mutate(target)}>
              {t('mode.confirm')}
            </Button>
          </>
        }
      >
        <p className="mb-2">
          {target === 'driver'
            ? firstTimeDriver
              ? t('mode.toDriverFirst')
              : t('mode.toDriver')
            : t('mode.toPassenger')}
        </p>
        <p className="text-sm text-gray-600">{t('mode.sharedWallet')}</p>
        <ErrorBox
          error={
            switchMode.error && !(isApiError(switchMode.error) && switchMode.error.status === 409)
              ? switchMode.error
              : null
          }
        />
      </Modal>
    </section>
  );
}
