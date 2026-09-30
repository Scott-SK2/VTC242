import { useUiStore } from '@/shared/store/ui';

export function Toasts() {
  const toasts = useUiStore((s) => s.toasts);
  const dismiss = useUiStore((s) => s.dismiss);
  if (!toasts.length) return null;
  return (
    <div
      className="fixed left-1/2 top-3 z-[60] -translate-x-1/2 w-[calc(100%-32px)] max-w-md space-y-2"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => dismiss(t.id)}
          className={`w-full text-left rounded-xl px-4 py-3 text-sm font-semibold shadow-lg ${
            t.kind === 'error'
              ? 'bg-alert text-white'
              : t.kind === 'success'
                ? 'bg-brand text-white'
                : 'bg-slate text-white'
          }`}
        >
          {t.message}
        </button>
      ))}
    </div>
  );
}
