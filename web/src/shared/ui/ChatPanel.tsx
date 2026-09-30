import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useMessages } from '@/shared/api/hooks';
import { ridesApi } from '@/shared/api/endpoints';
import type { ChatPreset } from '@/shared/api/types';
import { Button } from './Button';
import { formatTime } from '@/shared/utils/date';
import { toast } from '@/shared/store/ui';

const PRESETS: Record<'passenger' | 'driver', ChatPreset[]> = {
  passenger: ['where', 'coming', 'ok'],
  driver: ['arriving', 'waiting', 'traffic', 'ok'],
};

/** Chat in-app lié à une course : messages libres + prédéfinis, sans numéros. */
export function ChatPanel({ rideId, me }: { rideId: string; me: 'passenger' | 'driver' }) {
  const { t } = useTranslation();
  const { data: messages = [], append, isPending } = useMessages(rideId);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  async function send(payload: { body: string } | { preset: ChatPreset }) {
    setSending(true);
    try {
      const m = await ridesApi.sendMessage(rideId, payload);
      append(m);
      setText('');
    } catch {
      toast(t('common.error'), 'error');
    } finally {
      setSending(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (text.trim()) void send({ body: text.trim() });
  }

  return (
    <div className="flex flex-col h-full min-h-[320px]">
      <div className="flex-1 overflow-y-auto space-y-2 py-2" aria-live="polite">
        {!isPending && messages.length === 0 && (
          <p className="text-center text-gray-500 text-sm py-6">{t('chat.empty')}</p>
        )}
        {messages.map((m) => {
          const mine = m.sender_role === me;
          return (
            <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${mine ? 'bg-brand text-white' : m.sender_role === 'support' ? 'bg-slate text-white' : 'bg-gray-100'}`}
              >
                {!mine && (
                  <div className="text-xs opacity-70 mb-0.5">{t(`chat.sender.${m.sender_role}`)}</div>
                )}
                <div>{m.body}</div>
                <div className={`text-[11px] mt-0.5 ${mine ? 'text-white/70' : 'text-gray-500'}`}>
                  {formatTime(m.sent_at)}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
      <div className="flex gap-2 overflow-x-auto py-2 -mx-1 px-1">
        {PRESETS[me].map((p) => (
          <button
            key={p}
            type="button"
            disabled={sending}
            onClick={() => void send({ preset: p })}
            className="shrink-0 rounded-full border border-brand text-brand-dark px-3 min-h-[40px] text-sm font-semibold"
          >
            {t(`chat.presets.${p}`)}
          </button>
        ))}
      </div>
      <form onSubmit={submit} className="flex gap-2">
        <input
          className="input flex-1"
          placeholder={t('chat.placeholder')}
          value={text}
          onChange={(e) => setText(e.target.value)}
          aria-label={t('chat.placeholder')}
          maxLength={500}
        />
        <Button type="submit" loading={sending} disabled={!text.trim()} aria-label={t('common.send')}>
          ➤
        </Button>
      </form>
    </div>
  );
}
