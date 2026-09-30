import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'green' | 'yellow' | 'red' | 'dark' | 'blue';
const tones: Record<BadgeTone, string> = {
  neutral: 'bg-gray-100 text-gray-700',
  green: 'bg-brand-light text-brand-dark',
  yellow: 'bg-code-light text-yellow-900',
  red: 'bg-alert-light text-alert',
  dark: 'bg-slate text-white',
  blue: 'bg-blue-50 text-blue-800',
};

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function rideTone(status: string): BadgeTone {
  if (status === 'completed') return 'green';
  if (status === 'in_progress' || status === 'accepted' || status === 'arrived') return 'blue';
  if (status.startsWith('cancelled') || status === 'no_driver') return 'red';
  if (status === 'dispatching' || status === 'requested') return 'yellow';
  return 'neutral';
}
