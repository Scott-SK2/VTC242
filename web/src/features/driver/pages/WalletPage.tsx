import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MobilePage, Button, Modal, Money, TransactionList, MobileMoneyForm, ErrorBox } from '@/shared/ui';
import { qk, useWallet } from '@/shared/api/hooks';
import { walletApi } from '@/shared/api/endpoints';
import { toast } from '@/shared/store/ui';
import { formatMoney } from '@/shared/utils/money';

export default function DriverWalletPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: wallet } = useWallet();
  const [open, setOpen] = useState(false);
  const min = Number(wallet?.payout_min ?? 2000);
  const cap = Number(wallet?.payout_daily_cap ?? 200000);
  const payout = useMutation({
    mutationFn: (v: { amount: string; operator: 'mtn' | 'airtel'; phone: string }) =>
      walletApi.payout(v.amount, v.operator, v.phone),
    onSuccess: () => {
      toast(t('driver.wallet.payoutSent'), 'success');
      setOpen(false);
      void qc.invalidateQueries({ queryKey: qk.wallet });
      void qc.invalidateQueries({ queryKey: qk.transactions });
    },
  });
  const available = Number(wallet?.available ?? 0);
  return (
    <MobilePage
      title={t('driver.wallet.title')}
      action={
        <Button onClick={() => setOpen(true)} disabled={available < min}>
          {t('driver.wallet.payout')}
        </Button>
      }
    >
      <div className="rounded-2xl bg-slate text-white p-5 mb-4">
        <div className="text-sm opacity-80">{t('passenger.wallet.available')}</div>
        <Money
          value={wallet?.available}
          className={`text-4xl font-extrabold block ${available < 0 ? 'text-code' : ''}`}
        />
        <div className="mt-3 flex gap-6 text-sm flex-wrap">
          <div>
            <span className="opacity-80">{t('passenger.wallet.reserved')}</span>{' '}
            <Money value={wallet?.reserved_balance} className="font-semibold" />
          </div>
          {wallet?.cash_debt_limit && (
            <div className="opacity-80">
              {t('driver.wallet.debt', { limit: formatMoney(wallet.cash_debt_limit) })}
            </div>
          )}
        </div>
      </div>
      <h2 className="font-extrabold mb-1">{t('passenger.wallet.history')}</h2>
      <TransactionList />
      <Modal open={open} onClose={() => setOpen(false)} title={t('driver.wallet.payoutTitle')}>
        <p className="text-sm text-gray-600 mb-3">
          {t('driver.wallet.payoutHint', { min: formatMoney(min), cap: formatMoney(cap) })}
        </p>
        <MobileMoneyForm
          amountLabel={t('driver.wallet.payoutAmount')}
          submitLabel={t('driver.wallet.payout')}
          min={min}
          max={Math.min(cap, available)}
          belowMinText={t('driver.wallet.belowMin', { min: formatMoney(min) })}
          aboveMaxText={t('driver.wallet.aboveCap', { cap: formatMoney(Math.min(cap, available)) })}
          loading={payout.isPending}
          onSubmit={(amount, operator, phone) => payout.mutate({ amount, operator, phone })}
        />
        <ErrorBox error={payout.error} />
      </Modal>
    </MobilePage>
  );
}
