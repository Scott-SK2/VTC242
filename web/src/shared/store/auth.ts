import { create } from 'zustand';
import type { User } from '@/shared/api/types';

const REFRESH_KEY = 'vtc242.refresh';
const USER_KEY = 'vtc242.user';

function readStorage<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: unknown) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* stockage indisponible (navigation privée) */
  }
}

export interface AuthState {
  /** Access JWT conservé uniquement en mémoire. */
  accessToken: string | null;
  /** Refresh token (localStorage en V1 ; cookie HttpOnly à venir). */
  refreshToken: string | null;
  user: User | null;
  /** Vrai quand la session back-office a validé le TOTP. */
  totpVerified: boolean;
  setTokens: (access: string, refresh: string) => void;
  setAccessToken: (access: string) => void;
  setUser: (user: User | null) => void;
  setTotpVerified: (v: boolean) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  refreshToken: readStorage<string>(REFRESH_KEY),
  user: readStorage<User>(USER_KEY),
  totpVerified: false,
  setTokens: (access, refresh) => {
    writeStorage(REFRESH_KEY, refresh);
    set({ accessToken: access, refreshToken: refresh });
  },
  setAccessToken: (access) => set({ accessToken: access }),
  setUser: (user) => {
    writeStorage(USER_KEY, user);
    set({ user });
  },
  setTotpVerified: (v) => set({ totpVerified: v }),
  logout: () => {
    writeStorage(REFRESH_KEY, null);
    writeStorage(USER_KEY, null);
    set({ accessToken: null, refreshToken: null, user: null, totpVerified: false });
  },
}));

export const isAdminRole = (role?: string | null) =>
  role === 'admin' || role === 'finance' || role === 'support';

export function homeForRole(role?: string | null): string {
  if (role === 'driver') return '/d';
  if (isAdminRole(role)) return '/admin';
  return '/p';
}
