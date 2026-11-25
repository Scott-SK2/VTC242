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

const ADMIN_SESSION_S = 8 * 3600;

/** Le jeton porte-t-il une validation TOTP encore valable (8 h) ? Simple confort d'affichage :
 * le serveur revérifie à chaque requête (403 totp_required sinon). Évite de redemander le
 * code à chaque rechargement de la page. */
export function tokenHasTotp(token: string | null, now = Date.now()): boolean {
  if (!token) return false;
  try {
    const part = token.split('.')[1];
    if (!part) return false;
    const claims = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as {
      totp?: boolean;
      totp_at?: number;
    };
    return !!claims.totp && !!claims.totp_at && now / 1000 - claims.totp_at < ADMIN_SESSION_S;
  } catch {
    return false;
  }
}

const storedRefresh = readStorage<string>(REFRESH_KEY);

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  refreshToken: storedRefresh,
  user: readStorage<User>(USER_KEY),
  totpVerified: tokenHasTotp(storedRefresh),
  setTokens: (access, refresh) => {
    writeStorage(REFRESH_KEY, refresh);
    set({ accessToken: access, refreshToken: refresh, totpVerified: tokenHasTotp(refresh) });
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
