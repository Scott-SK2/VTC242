import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { adminApi } from '@/shared/api/endpoints';
import { useWsEvent } from '@/shared/ws';
import type { Message } from '@/shared/api/types';
import { Button, ErrorBox } from '@/shared/ui';
import { formatTime } from '@/shared/utils/date';

/** Chat côté support sur une course (rôle support / admin). */
export function SupportChat({ rideId }: { rideId: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const key = ['admin', 'messages', rideId];
  const q = useQuery({
    queryKey: key,
    queryFn: async () => (await adminApi.rideMessages(rideId)).results,
    refetchInterval: 10_000,
  });
  useWsEvent('chat.message', (m) => {
    if (m.ride_id === rideId)
      qc.setQueryData<Message[]>(key, (old) =>
        (old ?? []).some((x) => x.id === m.id) ? old : [...(old ?? []), m],
      );
  });
  const [text, setText] = useState('');
  const send = useMutation({
    mutationFn: () => adminApi.sendRideMessage(rideId, text.trim()),
    onSuccess: (m) => {
      qc.setQueryData<Message[]>(key, (old) => [...(old ?? []), m]);
      setText('');
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    if (text.trim()) send.mutate();
  }
  return (
    <div className="flex flex-col min-h-[320px] max-h-[60vh]">
      <div className="flex-1 overflow-y-auto space-y-2 py-2">
        {(q.data ?? []).map((m) => (
          <div key={m.id} className={`flex ${m.sender_role === 'support' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${m.sender_role === 'support' ? 'bg-slate text-white' : m.sender_role === 'driver' ? 'bg-brand-light' : 'bg-gray-100'}`}
            >
              <div className="text-xs opacity-70">
                {t(`chat.sender.${m.sender_role}`)} · {formatTime(m.sent_at)}
              </div>
              {m.body}
            </div>
          </div>
        ))}
        {q.data?.length === 0 && (
          <p className="text-center text-sm text-gray-500 py-4">{t('common.empty')}</p>
        )}
      </div>
      <ErrorBox error={send.error} />
      <form onSubmit={submit} className="flex gap-2 mt-2">
        <input
          className="input flex-1"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('admin.rides.supportPlaceholder')}
          aria-label={t('admin.rides.supportPlaceholder')}
        />
        <Button type="submit" variant="dark" loading={send.isPending} disabled={!text.trim()}>
          {t('common.send')}
        </Button>
      </form>
    </div>
  );
}
