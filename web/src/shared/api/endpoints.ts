import { api, request, requestRaw } from './client';
import type {
  AdminDispute,
  AdminDriver,
  AdminPassenger,
  AdminRide,
  AdminZone,
  Alert,
  AuditLog,
  AutocompleteResult,
  ChatPreset,
  Dashboard,
  Dispute,
  DriverDocument,
  DriverPosition,
  DriverProfile,
  EstimateResponse,
  FinanceSummary,
  Fleet,
  Message,
  MobileOperator,
  Offer,
  OtpVerifyResponse,
  Page,
  PaymentMethod,
  PayoutRequest,
  Place,
  Poi,
  PricingRule,
  PricingRuleInput,
  ReconciliationResult,
  Ride,
  ShareInfo,
  SharedRide,
  SimulationResult,
  TotpSetup,
  Transaction,
  UploadTicket,
  User,
  Vehicle,
  VehicleCategory,
  Wallet,
  Zone,
} from './types';

export const authApi = {
  requestOtp: (phone_number: string) =>
    api.post<{ expires_in: number; debug_code?: string }>(
      '/auth/otp/request',
      { phone_number },
      { auth: false },
    ),
  verifyOtp: (phone_number: string, code: string, role?: 'passenger' | 'driver') =>
    api.post<OtpVerifyResponse>(
      '/auth/otp/verify',
      { phone_number, code, ...(role ? { role } : {}) },
      { auth: false },
    ),
  logout: (refresh: string) => api.post<void>('/auth/logout', { refresh }),
};

export const meApi = {
  get: () => api.get<User>('/me'),
  patch: (body: Partial<Pick<User, 'first_name' | 'last_name' | 'photo_url' | 'language'>>) =>
    api.patch<User>('/me', body),
  delete: () => api.delete<void>('/me'),
  pushSubscribe: (sub: { endpoint: string; keys: { p256dh: string; auth: string }; user_agent?: string }) =>
    api.post<void>('/me/push-subscriptions', sub),
  createUpload: (kind: 'profile_photo' | 'document', content_type: string, filename: string) =>
    api.post<UploadTicket>('/me/uploads', { kind, content_type, filename }),
};

/** Téléverse un fichier via le ticket pré-signé et renvoie l'URL finale. */
export async function uploadFile(kind: 'profile_photo' | 'document', file: File): Promise<string> {
  const ticket = await meApi.createUpload(kind, file.type || 'application/octet-stream', file.name);
  const res = await fetch(ticket.upload_url, {
    method: ticket.method ?? 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream', ...(ticket.headers ?? {}) },
    body: file,
  });
  if (!res.ok) throw new Error(`Téléversement refusé (${res.status})`);
  return ticket.file_url;
}

export const geoApi = {
  autocomplete: (q: string, near?: { lat: number; lng: number }, signal?: AbortSignal) =>
    api.get<{ results: AutocompleteResult[] }>(
      '/geo/autocomplete',
      { q, lat: near?.lat, lng: near?.lng },
      { signal },
    ),
  resolveZone: (lat: number, lng: number) => api.get<Zone>('/geo/zones/resolve', { lat, lng }),
};

export const ridesApi = {
  estimate: (pickup: Place, dropoff: Place) =>
    api.post<EstimateResponse>('/rides/estimate', { pickup, dropoff }),
  create: (body: {
    category: VehicleCategory;
    pricing_rule_id: string;
    payment_method: PaymentMethod;
    pickup: Place;
    dropoff: Place;
  }) => api.post<Ride>('/rides', body, { idempotent: true }),
  get: (id: string) => api.get<Ride>(`/rides/${id}`),
  list: (params: { status?: string; active?: 1; cursor?: string } = {}) =>
    api.get<Page<Ride>>('/rides', params),
  active: async (): Promise<Ride | null> => {
    const page = await api.get<Page<Ride> | Ride | null>('/rides', { active: 1 });
    if (!page) return null;
    if ('results' in page) return page.results[0] ?? null;
    return page;
  },
  cancel: (id: string, reason: string) => api.post<Ride>(`/rides/${id}/cancel`, { reason }),
  retry: (id: string) => api.post<Ride>(`/rides/${id}/retry`),
  accept: (id: string) => api.post<Ride>(`/rides/${id}/accept`),
  decline: (id: string) => api.post<void>(`/rides/${id}/decline`),
  arrive: (id: string, pos: { lat: number; lng: number }) => api.post<Ride>(`/rides/${id}/arrive`, pos),
  start: (id: string, otp_code: string, pos: { lat: number; lng: number }) =>
    api.post<Ride>(`/rides/${id}/start`, { otp_code, ...pos }),
  detour: (id: string, reason: string) => api.post<Ride>(`/rides/${id}/detour`, { reason }),
  complete: (id: string, pos: { lat: number; lng: number }) => api.post<Ride>(`/rides/${id}/complete`, pos),
  confirmArrival: (id: string) => api.post<Ride>(`/rides/${id}/confirm-arrival`),
  rate: (id: string, score: number, comment?: string) =>
    api.post<void>(`/rides/${id}/rate`, { score, ...(comment ? { comment } : {}) }),
  dispute: (id: string, reason: string) => api.post<Dispute>(`/rides/${id}/dispute`, { reason }),
  messages: (id: string) => api.get<{ results: Message[] }>(`/rides/${id}/messages`),
  sendMessage: (id: string, payload: { body: string } | { preset: ChatPreset }) =>
    api.post<Message>(`/rides/${id}/messages`, payload),
  share: (id: string) => api.post<ShareInfo>(`/rides/${id}/share`),
  shared: (token: string) => api.get<SharedRide>(`/share/${token}`, undefined, { auth: false }),
  emergency: (id: string, number_called: string, pos: { lat: number; lng: number } | null) =>
    api.post<void>(`/rides/${id}/emergency`, { number_called, lat: pos?.lat ?? null, lng: pos?.lng ?? null }),
  receipt: (id: string) => requestRaw(`/rides/${id}/receipt`, { headers: { Accept: 'application/pdf' } }),
};

export const walletApi = {
  get: () => api.get<Wallet>('/wallet'),
  transactions: (cursor?: string) => api.get<Page<Transaction>>('/wallet/transactions', { cursor }),
  deposit: (amount: string, operator: MobileOperator, phone_number: string) =>
    api.post<Transaction>('/wallet/deposit', { amount, operator, phone_number }, { idempotent: true }),
  payout: (amount: string, operator: MobileOperator, phone_number: string) =>
    api.post<Transaction>('/wallet/payout', { amount, operator, phone_number }, { idempotent: true }),
};

export const driversApi = {
  me: () => api.get<DriverProfile>('/drivers/me'),
  setStatus: (is_online: boolean) => api.patch<DriverProfile>('/drivers/me/status', { is_online }),
  sendPositions: (positions: DriverPosition[]) =>
    api.post<{ accepted: number }>('/drivers/me/location', { positions }),
  vehicles: () => api.get<Vehicle[]>('/drivers/me/vehicles'),
  addVehicle: (body: Omit<Vehicle, 'id' | 'is_verified' | 'is_active'>) =>
    api.post<Vehicle>('/drivers/me/vehicles', body),
  activateVehicle: (id: string) => api.patch<Vehicle>(`/drivers/me/vehicles/${id}`, { is_active: true }),
  documents: () => api.get<DriverDocument[]>('/drivers/me/documents'),
  addDocument: (body: { type: string; file_url: string; expires_at?: string }) =>
    api.post<DriverDocument>('/drivers/me/documents', body),
  currentOffer: async (): Promise<Offer | null> => {
    const res = await requestRaw('/drivers/me/offers/current');
    if (res.status === 204) return null;
    return (await res.json()) as Offer;
  },
};

export const adminApi = {
  dashboard: () => api.get<Dashboard>('/admin/dashboard'),
  fleet: () => api.get<Fleet>('/admin/fleet'),
  alerts: (status?: string, cursor?: string) => api.get<Page<Alert>>('/admin/alerts', { status, cursor }),
  ackAlert: (id: string) => api.post<Alert>(`/admin/alerts/${id}/ack`),
  rides: (params: Record<string, string | undefined>) => api.get<Page<AdminRide>>('/admin/rides', params),
  ride: (id: string) => api.get<AdminRide>(`/admin/rides/${id}`),
  rideMessages: (id: string) => api.get<{ results: Message[] }>(`/admin/rides/${id}/messages`),
  sendRideMessage: (id: string, body: string) => api.post<Message>(`/admin/rides/${id}/messages`, { body }),
  drivers: (params: { status?: string; q?: string; cursor?: string }) =>
    api.get<Page<AdminDriver>>('/admin/drivers', params),
  driver: (id: string) => api.get<AdminDriver>(`/admin/drivers/${id}`),
  approveDriver: (id: string) => api.post<AdminDriver>(`/admin/drivers/${id}/approve`),
  rejectDriver: (id: string, reason: string) =>
    api.post<AdminDriver>(`/admin/drivers/${id}/reject`, { reason }),
  suspendDriver: (id: string, reason: string) =>
    api.post<AdminDriver>(`/admin/drivers/${id}/suspend`, { reason }),
  reinstateDriver: (id: string) => api.post<AdminDriver>(`/admin/drivers/${id}/reinstate`),
  reviewDocument: (id: string, status: 'approved' | 'rejected', note?: string) =>
    api.post<DriverDocument>(`/admin/documents/${id}/review`, { status, note: note ?? '' }),
  passengers: (params: { q?: string; cursor?: string }) =>
    api.get<Page<AdminPassenger>>('/admin/passengers', params),
  blockPassenger: (id: string, reason: string) => api.post<User>(`/admin/passengers/${id}/block`, { reason }),
  unblockPassenger: (id: string) => api.post<User>(`/admin/passengers/${id}/unblock`),
  logoutAll: (id: string) => api.post<User>(`/admin/passengers/${id}/logout-all`),
  pricingRules: (params: Record<string, string | undefined> = {}) =>
    api.get<Page<PricingRule> | PricingRule[]>('/admin/pricing-rules', params),
  createPricingRule: (body: PricingRuleInput) => api.post<PricingRule>('/admin/pricing-rules', body),
  patchPricingRule: (id: string, body: Partial<PricingRuleInput>) =>
    api.patch<PricingRule>(`/admin/pricing-rules/${id}`, body),
  simulate: (body: {
    zone_id: string;
    category: VehicleCategory;
    distance_m: number;
    duration_s: number;
    waiting_seconds: number;
    at?: string;
  }) => api.post<SimulationResult>('/admin/pricing-rules/simulate', body),
  zones: () => api.get<Page<AdminZone> | AdminZone[]>('/admin/zones'),
  createZone: (body: Partial<AdminZone>) => api.post<AdminZone>('/admin/zones', body),
  patchZone: (id: string, body: Partial<AdminZone>) => api.patch<AdminZone>(`/admin/zones/${id}`, body),
  pois: (params: Record<string, string | undefined> = {}) =>
    api.get<Page<Poi> | Poi[]>('/admin/pois', params),
  createPoi: (body: Omit<Poi, 'id'>) => api.post<Poi>('/admin/pois', body),
  patchPoi: (id: string, body: Partial<Omit<Poi, 'id'>>) => api.patch<Poi>(`/admin/pois/${id}`, body),
  deletePoi: (id: string) => api.delete<void>(`/admin/pois/${id}`),
  disputes: (status?: string, cursor?: string) =>
    api.get<Page<AdminDispute>>('/admin/disputes', { status, cursor }),
  dispute: (id: string) => api.get<AdminDispute>(`/admin/disputes/${id}`),
  resolveDispute: (id: string, refund_amount: string, resolution: string) =>
    api.post<Dispute>(`/admin/disputes/${id}/resolve`, { refund_amount, resolution }),
  rejectDispute: (id: string, resolution: string) =>
    api.post<Dispute>(`/admin/disputes/${id}/reject`, { resolution }),
  financeSummary: () => api.get<FinanceSummary>('/admin/finance/summary'),
  financeTransactions: (params: Record<string, string | undefined>) =>
    api.get<Page<Transaction & { user?: { first_name: string; last_name: string; role: string } }>>(
      '/admin/finance/transactions',
      params,
    ),
  payouts: (status = 'pending') => api.get<Page<PayoutRequest>>('/admin/finance/payouts', { status }),
  approvePayout: (id: string) => api.post<PayoutRequest>(`/admin/finance/payouts/${id}/approve`),
  rejectPayout: (id: string, reason?: string) =>
    api.post<PayoutRequest>(`/admin/finance/payouts/${id}/reject`, reason ? { reason } : undefined),
  importReconciliation: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return request<ReconciliationResult>('/admin/finance/reconciliation/import', {
      method: 'POST',
      rawBody: fd,
    });
  },
  exportCsv: (type: 'transactions' | 'rides', from?: string, to?: string) =>
    requestRaw('/admin/finance/export', { query: { type, from, to }, headers: { Accept: 'text/csv' } }),
  auditLogs: (cursor?: string) => api.get<Page<AuditLog>>('/admin/audit-logs', { cursor }),
  users: (role?: string) => api.get<Page<User> | User[]>('/admin/users', { role }),
  createUser: (body: { phone_number: string; first_name: string; last_name: string; role: string }) =>
    api.post<User>('/admin/users', body),
  totpSetup: () => api.post<TotpSetup>('/admin/totp/setup'),
  totpVerify: (code: string) => api.post<{ access: string }>('/admin/totp/verify', { code }),
};

/** Certaines listes admin peuvent être paginées ou non : normalise en tableau. */
export function asList<T>(data: Page<T> | T[] | null | undefined): T[] {
  if (!data) return [];
  return Array.isArray(data) ? data : data.results;
}
