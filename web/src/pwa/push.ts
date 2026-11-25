import { meApi } from '@/shared/api/endpoints';

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/** Abonne l'appareil aux notifications Web Push (VAPID) si possible. */
export async function subscribePush(): Promise<boolean> {
  const vapid = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
  if (!vapid || !('serviceWorker' in navigator) || !('PushManager' in window)) return false;
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return false;
    const reg = await navigator.serviceWorker.ready;
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapid) as BufferSource,
      }));
    const json = sub.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) return false;
    await meApi.pushSubscribe({
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      user_agent: navigator.userAgent,
    });
    return true;
  } catch {
    return false;
  }
}

/** À la déconnexion : cet appareil ne reçoit plus les notifications du compte (téléphone
 *  partagé : ni course, ni code de départ pour le compte précédent). */
export async function unsubscribePush(): Promise<void> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (!sub) return;
    await meApi.pushUnsubscribe(sub.endpoint).catch(() => undefined);
    await sub.unsubscribe();
  } catch {
    /* ignoré */
  }
}
