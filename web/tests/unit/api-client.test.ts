import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, request } from '@/shared/api/client';
import { useAuthStore } from '@/shared/store/auth';

function jsonResponse(status: number, body: unknown) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('client API', () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.getState().logout();
    useAuthStore.getState().setTokens('old-access', 'refresh-1');
  });

  it('rafraîchit le token sur 401 puis rejoue la requête avec rotation du refresh', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const auth = (init?.headers as Record<string, string>)?.Authorization;
      if (url.endsWith('/auth/token/refresh')) {
        expect(JSON.parse(String(init?.body))).toEqual({ refresh: 'refresh-1' });
        return jsonResponse(200, { access: 'new-access', refresh: 'refresh-2' });
      }
      if (auth === 'Bearer old-access')
        return jsonResponse(401, { code: 'token_not_valid', message: 'expiré' });
      return jsonResponse(200, { id: 'me', token: auth });
    });
    const me = await api.get<{ token: string }>('/me');
    expect(me.token).toBe('Bearer new-access');
    expect(useAuthStore.getState().accessToken).toBe('new-access');
    expect(useAuthStore.getState().refreshToken).toBe('refresh-2');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('déconnecte si le refresh échoue', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input).endsWith('/auth/token/refresh'))
        return jsonResponse(401, { code: 'invalid', message: 'nope' });
      return jsonResponse(401, { code: 'token_not_valid', message: 'expiré' });
    });
    await expect(api.get('/me')).rejects.toBeInstanceOf(ApiError);
    expect(useAuthStore.getState().refreshToken).toBeNull();
  });

  it('typifie les erreurs {code, message, details}', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(402, {
        code: 'insufficient_funds',
        message: 'Solde insuffisant',
        details: { required: '1800.00', available: '500.00' },
      }),
    );
    const err = await api.post('/rides', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    const e = err as ApiError;
    expect(e.status).toBe(402);
    expect(e.code).toBe('insufficient_funds');
    expect(e.details.required).toBe('1800.00');
  });

  it('ajoute Idempotency-Key sur POST /rides, /wallet/deposit et /wallet/payout uniquement', async () => {
    const seen: Array<string | undefined> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      seen.push((init?.headers as Record<string, string>)?.['Idempotency-Key']);
      return jsonResponse(200, {});
    });
    await request('/rides', { method: 'POST', body: {} });
    await request('/wallet/deposit', { method: 'POST', body: {} });
    await request('/wallet/payout', { method: 'POST', body: {} });
    await request('/rides/abc/cancel', { method: 'POST', body: {} });
    await request('/rides', { method: 'GET' });
    expect(seen.slice(0, 3).every((k) => typeof k === 'string' && k.length >= 16)).toBe(true);
    expect(new Set(seen.slice(0, 3)).size).toBe(3);
    expect(seen[3]).toBeUndefined();
    expect(seen[4]).toBeUndefined();
  });
});
