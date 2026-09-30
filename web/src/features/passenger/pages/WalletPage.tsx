import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MobilePage, Button, Modal, Money, TransactionList, MobileMoneyForm, ErrorBox } from '@/shared/ui';
import { qk, useWallet } from '@/shared/api/hooks';
import { walletApi } from '@/shared/api/endpoints';
import { toast } from '@/shared/store/ui';

export default function WalletPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: wallet } = useWallet();
  const [open, setOpen] = useState(false);
  const deposit = useMutation({
    mutationFn: (v: { amount: string; operator: 'mtn' | 'airtel'; phone: string }) =>
      walletApi.deposit(v.amount, v.operator, v.phone),
    onSuccess: () => {
      toast(t('passenger.wallet.depositSent'), 'success');
      setOpen(false);
      void qc.invalidateQueries({ queryKey: qk.transactions });
      setTimeout(() => {
        void qc.invalidateQueries({ queryKey: qk.wallet });
        void qc.invalidateQueries({ queryKey: qk.transactions });
      }, 4000);
    },
  });
  return (
    <MobilePage
      title={t('passenger.wallet.title')}
      action={<Button onClick={() => setOpen(true)}>{t('passenger.wallet.deposit')}</Button>}
    >
      <div className="rounded-2xl bg-slate text-white p-5 mb-4">
        <div className="text-sm opacity-80">{t('passenger.wallet.available')}</div>
        <Money value={wallet?.available} className="text-4xl font-extrabold block" />
        <div className="mt-3 flex gap-6 text-sm">
          <div>
            <span className="opacity-80">{t('passenger.wallet.reserved')}</span>{' '}
            <Money value={wallet?.reserved_balance} className="font-semibold" />
          </div>
          <div>
            <span className="opacity-80">{t('passenger.wallet.balance')}</span>{' '}
            <Money value={wallet?.balance} className="font-semibold" />
          </div>
        </div>
      </div>
      <h2 className="font-extrabold mb-1">{t('passenger.wallet.history')}</h2>
      <TransactionList />
      <Modal open={open} onClose={() => setOpen(false)} title={t('passenger.wallet.depositTitle')}>
        <p className="text-sm text-gray-600 mb-3">{t('passenger.wallet.depositHint')}</p>
        <MobileMoneyForm
          amountLabel={t('passenger.wallet.depositAmount')}
          submitLabel={t('passenger.wallet.deposit')}
          min={500}
          belowMinText={t('passenger.wallet.minAmount')}
          loading={deposit.isPending}
          onSubmit={(amount, operator, phone) => deposit.mutate({ amount, operator, phone })}
        />
        <ErrorBox error={deposit.error} />
      </Modal>
    </MobilePage>
  );
}
