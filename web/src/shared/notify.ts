import { toast } from '@/shared/store/ui';
import { vibrate } from '@/shared/utils/device';

/** Demande la permission de notification (une fois) ; silencieux si non supporté. */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (typeof Notification === 'undefined') return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try {
    return (await Notification.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

/**
 * Notification in-app : toast + vibration quand l'application est visible ; notification
 * système (via le service worker) quand l'onglet est en arrière-plan et la permission accordée.
 */
export function notify(
  title: string,
  body: string,
  opts: { kind?: 'info' | 'success' | 'error'; tag?: string; url?: string; silent?: boolean } = {},
) {
  if (!opts.silent) vibrate([150, 80, 150]);
  const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
  if (!hidden) {
    toast(`${title} · ${body}`, opts.kind ?? 'info');
    return;
  }
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  void navigator.serviceWorker?.ready
    .then((reg) =>
      reg.showNotification(title, {
        body,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag: opts.tag,
        data: { url: opts.url ?? '/' },
      }),
    )
    .catch(() => {
      try {
        new Notification(title, { body, icon: '/icons/icon-192.png' });
      } catch {
        /* non supporté */
      }
    });
}
