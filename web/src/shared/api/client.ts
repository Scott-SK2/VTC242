import { useAuthStore } from '@/shared/store/auth';
import type { ApiErrorBody, AuthTokens } from './types';

export const API_BASE = `${(import.meta.env.VITE_API_URL ?? 'http://localhost:8000').replace(/\/$/, '')}/api/v1`;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;
  constructor(status: number, body: Partial<ApiErrorBody> | null, fallback = 'Erreur réseau') {
    super(body?.message ?? fallback);
    this.name = 'ApiError';
    this.status = status;
    this.code = body?.code ?? (status === 0 ? 'network_error' : `http_${status}`);
    this.details = body?.details ?? {};
  }
}

export const isApiError = (e: unknown): e is ApiError => e instanceof ApiError;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Corps déjà encodé (FormData…) : pas de sérialisation JSON. */
  rawBody?: BodyInit;
  headers?: Record<string, string>;
  auth?: boolean;
  /** Ajoute un en-tête Idempotency-Key (POST financiers et création de course). */
  idempotent?: boolean;
  signal?: AbortSignal;
  query?: Record<string, string | number | boolean | null | undefined>;
}

const IDEMPOTENT_PATHS = [/^\/rides$/, /^\/wallet\/deposit$/, /^\/wallet\/payout$/];

export function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(
    path.startsWith('http') ? path : `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`,
  );
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

let refreshInFlight: Promise<string | null> | null = null;

/** Rafraîchit l'access token (rotation du refresh). Une seule requête à la fois. */
export function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;
  const { refreshToken } = useAuthStore.getState();
  if (!refreshToken) return Promise.resolve(null);
  refreshInFlight = (async () => {
    try {
      const res = await fetch(buildUrl('/auth/token/refresh'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ refresh: refreshToken }),
      });
      if (!res.ok) {
        useAuthStore.getState().logout();
        return null;
      }
      const data = (await res.json()) as AuthTokens;
      useAuthStore.getState().setTokens(data.access, data.refresh ?? refreshToken);
      return data.access;
    } catch {
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

async function doFetch(path: string, opts: RequestOptions, token: string | null, idemKey: string | null) {
  const headers: Record<string, string> = { Accept: 'application/json', ...(opts.headers ?? {}) };
  if (opts.body !== undefined && !opts.rawBody) headers['Content-Type'] = 'application/json';
  if (token && opts.auth !== false) headers.Authorization = `Bearer ${token}`;
  if (idemKey) headers['Idempotency-Key'] = idemKey;
  return fetch(buildUrl(path, opts.query), {
    method: opts.method ?? 'GET',
    headers,
    body: opts.rawBody ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    signal: opts.signal,
  });
}

/** Requête JSON typée contre l'API. Refresh automatique sur 401 puis nouvelle tentative. */
export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const res = await requestRaw(path, opts);
  if (res.status === 204) return undefined as T;
  return (await parseBody(res)) as T;
}

/** Idem `request` mais renvoie la Response (PDF, CSV…). */
export async function requestRaw(path: string, opts: RequestOptions = {}): Promise<Response> {
  const method = opts.method ?? 'GET';
  const needsKey =
    opts.idempotent ??
    (method === 'POST' && IDEMPOTENT_PATHS.some((re) => re.test(path.split('?')[0] ?? '')));
  const idemKey = needsKey ? newIdempotencyKey() : null;
  let token = useAuthStore.getState().accessToken;
  if (!token && opts.auth !== false && useAuthStore.getState().refreshToken) {
    token = await refreshAccessToken();
  }
  let res: Response;
  try {
    res = await doFetch(path, opts, token, idemKey);
  } catch (e) {
    throw new ApiError(0, { code: 'network_error', message: (e as Error).message });
  }
  if (res.status === 401 && opts.auth !== false) {
    const fresh = await refreshAccessToken();
    if (fresh) {
      try {
        res = await doFetch(path, opts, fresh, idemKey);
      } catch (e) {
        throw new ApiError(0, { code: 'network_error', message: (e as Error).message });
      }
    } else {
      useAuthStore.getState().logout();
    }
  }
  if (!res.ok) {
    const body = (await parseBody(res)) as Partial<ApiErrorBody> | null;
    if (res.status === 403 && body?.code === 'totp_required') {
      useAuthStore.getState().setTotpVerified(false);
      window.dispatchEvent(new CustomEvent('vtc:totp_required'));
    }
    throw new ApiError(res.status, body, res.statusText);
  }
  return res;
}

export const api = {
  get: <T>(path: string, query?: RequestOptions['query'], opts: RequestOptions = {}) =>
    request<T>(path, { ...opts, method: 'GET', query }),
  post: <T>(path: string, body?: unknown, opts: RequestOptions = {}) =>
    request<T>(path, { ...opts, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, opts: RequestOptions = {}) =>
    request<T>(path, { ...opts, method: 'PATCH', body }),
  delete: <T>(path: string, opts: RequestOptions = {}) => request<T>(path, { ...opts, method: 'DELETE' }),
};
