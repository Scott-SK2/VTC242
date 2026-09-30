import { registerSW } from 'virtual:pwa-register';
import { useUiStore, type BeforeInstallPromptEvent } from '@/shared/store/ui';

const INSTALL_PROMPTED_KEY = 'vtc242.installPrompted';

/** Enregistre le service worker et capte l'invite d'installation. */
export function setupPwa() {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    useUiStore.getState().setInstallPrompt(e as BeforeInstallPromptEvent);
  });
  window.addEventListener('appinstalled', () => {
    useUiStore.getState().setInstallPrompt(null);
    useUiStore.getState().toast('Application installée', 'success');
  });
  window.addEventListener('online', () => useUiStore.getState().setOnline(true));
  window.addEventListener('offline', () => useUiStore.getState().setOnline(false));

  const updateSW = registerSW({
    onNeedRefresh() {
      if (window.confirm('Une nouvelle version de VTC 242 est disponible. Mettre à jour ?'))
        void updateSW(true);
    },
    onRegisterError(e) {
      console.warn('SW', e);
    },
  });
}

export function installPromptWasShown(): boolean {
  try {
    return localStorage.getItem(INSTALL_PROMPTED_KEY) === '1';
  } catch {
    return false;
  }
}

export function markInstallPromptShown() {
  try {
    localStorage.setItem(INSTALL_PROMPTED_KEY, '1');
  } catch {
    /* ignoré */
  }
}

export const isStandalone = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as { standalone?: boolean }).standalone === true);

export const isIos = () => typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);
