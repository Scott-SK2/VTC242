import { create } from 'zustand';

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error';
  message: string;
}

interface UiState {
  toasts: Toast[];
  online: boolean;
  installPromptEvent: BeforeInstallPromptEvent | null;
  installOffered: boolean;
  toast: (message: string, kind?: Toast['kind']) => void;
  dismiss: (id: number) => void;
  setOnline: (v: boolean) => void;
  setInstallPrompt: (e: BeforeInstallPromptEvent | null) => void;
  setInstallOffered: (v: boolean) => void;
}

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let seq = 0;
export const useUiStore = create<UiState>((set) => ({
  toasts: [],
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  installPromptEvent: null,
  installOffered: false,
  toast: (message, kind = 'info') => {
    const id = ++seq;
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 5000);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setOnline: (online) => set({ online }),
  setInstallPrompt: (installPromptEvent) => set({ installPromptEvent }),
  setInstallOffered: (installOffered) => set({ installOffered }),
}));

export const toast = (message: string, kind?: Toast['kind']) => useUiStore.getState().toast(message, kind);
