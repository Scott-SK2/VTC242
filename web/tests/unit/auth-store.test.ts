import { beforeEach, describe, expect, it } from 'vitest';
import { useAuthStore, homeForRole, isAdminRole } from '@/shared/store/auth';
import type { User } from '@/shared/api/types';

const user: User = {
  id: 'u1',
  phone_number: '+242061234567',
  first_name: 'Scott',
  last_name: 'K.',
  role: 'passenger',
  photo_url: null,
  language: 'fr',
  is_active: true,
  created_at: '2026-09-30T00:00:00Z',
  driver: null,
  totp_enabled: false,
};

describe('auth store', () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.getState().logout();
  });

  it('garde l’access token en mémoire et le refresh en localStorage', () => {
    useAuthStore.getState().setTokens('access-1', 'refresh-1');
    expect(useAuthStore.getState().accessToken).toBe('access-1');
    expect(localStorage.getItem('vtc242.refresh')).toBe(JSON.stringify('refresh-1'));
    expect(localStorage.getItem('vtc242.access')).toBeNull();
  });

  it('persiste l’utilisateur et efface tout à la déconnexion', () => {
    useAuthStore.getState().setTokens('a', 'r');
    useAuthStore.getState().setUser(user);
    useAuthStore.getState().setTotpVerified(true);
    expect(JSON.parse(localStorage.getItem('vtc242.user') ?? 'null')).toMatchObject({ id: 'u1' });
    useAuthStore.getState().logout();
    const s = useAuthStore.getState();
    expect(s.accessToken).toBeNull();
    expect(s.refreshToken).toBeNull();
    expect(s.user).toBeNull();
    expect(s.totpVerified).toBe(false);
    expect(localStorage.getItem('vtc242.refresh')).toBeNull();
  });

  it('oriente vers l’accueil du rôle', () => {
    expect(homeForRole('passenger')).toBe('/p');
    expect(homeForRole('driver')).toBe('/d');
    expect(homeForRole('finance')).toBe('/admin');
    expect(isAdminRole('support')).toBe(true);
    expect(isAdminRole('driver')).toBe(false);
  });
});

describe('validation TOTP portée par le jeton', () => {
  const jwt = (claims: object) => `h.${btoa(JSON.stringify(claims))}.s`;
  const now = 1_800_000_000_000;

  it('reste valable 8 h après la validation, pas au-delà', async () => {
    const { tokenHasTotp } = await import('@/shared/store/auth');
    expect(tokenHasTotp(jwt({ totp: true, totp_at: now / 1000 - 3600 }), now)).toBe(true);
    expect(tokenHasTotp(jwt({ totp: true, totp_at: now / 1000 - 9 * 3600 }), now)).toBe(false);
    expect(tokenHasTotp(jwt({ totp: false }), now)).toBe(false);
    expect(tokenHasTotp('pas-un-jeton', now)).toBe(false);
    expect(tokenHasTotp(null, now)).toBe(false);
  });

  it('suit le jeton de renouvellement stocké', () => {
    useAuthStore.getState().setTokens('a', jwt({ totp: true, totp_at: Date.now() / 1000 }));
    expect(useAuthStore.getState().totpVerified).toBe(true);
    useAuthStore.getState().setTokens('a', jwt({ totp: false }));
    expect(useAuthStore.getState().totpVerified).toBe(false);
  });
});
