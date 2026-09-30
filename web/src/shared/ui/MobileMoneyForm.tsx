import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { MobileOperator } from '@/shared/api/types';
import { TextField } from './Field';
import { Button } from './Button';
import { normalizePhone, isValidCongoPhone } from '@/shared/utils/phone';
import { useAuthStore } from '@/shared/store/auth';

/** Formulaire commun recharge / retrait : montant, opérateur, numéro Mobile Money. */
export function MobileMoneyForm({
  submitLabel,
  amountLabel,
  min,
  max,
  loading,
  onSubmit,
  belowMinText,
  aboveMaxText,
}: {
  submitLabel: string;
  amountLabel: string;
  min?: number;
  max?: number;
  loading?: boolean;
  belowMinText?: string;
  aboveMaxText?: string;
  onSubmit: (amount: string, operator: MobileOperator, phone: string) => void;
}) {
  const { t } = useTranslation();
  const me = useAuthStore((s) => s.user);
  const [amount, setAmount] = useState('');
  const [operator, setOperator] = useState<MobileOperator>('mtn');
  const [phone, setPhone] = useState(me?.phone_number ?? '');
  const [err, setErr] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return setErr(t('common.required'));
    if (min !== undefined && n < min) return setErr(belowMinText ?? t('common.required'));
    if (max !== undefined && n > max) return setErr(aboveMaxText ?? t('common.required'));
    if (!isValidCongoPhone(phone)) return setErr(t('auth.phoneInvalid'));
    setErr(null);
    onSubmit(String(Math.round(n)), operator, normalizePhone(phone));
  }

  return (
    <form onSubmit={submit} noValidate>
      <TextField
        label={amountLabel}
        inputMode="numeric"
        value={amount}
        onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))}
        error={err}
      />
      <div className="mb-3">
        <span className="label">{t('admin.finance.operator')}</span>
        <div className="grid grid-cols-2 gap-2" role="radiogroup">
          {(['mtn', 'airtel'] as MobileOperator[]).map((op) => (
            <button
              key={op}
              type="button"
              role="radio"
              aria-checked={operator === op}
              onClick={() => setOperator(op)}
              className={`rounded-xl border p-3 min-h-tap font-semibold ${operator === op ? 'border-brand bg-brand-light' : 'border-gray-300'}`}
            >
              {t(`operators.${op}`)}
            </button>
          ))}
        </div>
      </div>
      <TextField
        label={t('passenger.wallet.operatorPhone')}
        type="tel"
        inputMode="tel"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
      />
      <Button type="submit" block loading={loading}>
        {submitLabel}
      </Button>
    </form>
  );
}
