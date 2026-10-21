// Types du contrat d'API v1 (docs/api-contract.md). Montants : chaînes décimales XAF.

export type Role = 'passenger' | 'driver' | 'admin' | 'finance' | 'support';
export type LatLng = { lat: number; lng: number };
export type LatLngHeading = LatLng & { heading?: number | null };
export type Place = LatLng & { address: string };
export type LngLatTuple = [number, number];

export interface Page<T> {
  results: T[];
  next: string | null;
  previous: string | null;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface Zone {
  id: string;
  name: string;
  city: string;
  emergency_police: string;
  emergency_fire: string;
  cash_enabled: boolean;
  deviation_threshold_m: number;
  deviation_hits: number;
  is_active: boolean;
}

export type DocumentType =
  'license' | 'registration' | 'insurance' | 'taxi_card' | 'id_card' | 'vehicle_photo' | 'profile_photo';
export type DocumentStatus = 'pending' | 'approved' | 'rejected';
export type DocumentSummaryStatus = 'missing' | DocumentStatus;

export interface DriverDocument {
  id: string;
  type: DocumentType;
  file_url: string;
  status: DocumentStatus;
  review_note: string | null;
  expires_at: string | null;
  created_at: string;
}

export type VehicleCategory = 'taxi' | 'standard' | 'vip' | 'wedding' | 'moving';

export interface Vehicle {
  id: string;
  brand: string;
  model: string;
  color: string;
  license_plate: string;
  taxi_number: string | null;
  category: VehicleCategory;
  seats: number;
  is_verified: boolean;
  is_active: boolean;
}

export interface DriverProfile {
  id: string;
  status: 'pending' | 'approved' | 'suspended' | 'rejected';
  license_number: string | null;
  rating_avg: number | null;
  rating_count: number;
  is_online: boolean;
  is_available: boolean;
  active_vehicle_id: string | null;
  consecutive_declines: number;
  paused_until: string | null;
  zone: Zone | null;
  documents_summary: Partial<Record<DocumentType, DocumentSummaryStatus>>;
  can_go_online: boolean;
  blocking_reason: string | null;
}

export interface User {
  id: string;
  phone_number: string;
  first_name: string;
  last_name: string;
  role: Role;
  photo_url: string | null;
  language: string;
  is_active: boolean;
  created_at: string;
  driver: DriverProfile | null;
  totp_enabled: boolean;
}

export interface AuthTokens {
  access: string;
  refresh: string;
}

export interface OtpVerifyResponse extends AuthTokens {
  user: User;
  /** true si le compte vient d'être créé (le rôle choisi ne s'applique qu'à ce moment) */
  created?: boolean;
}

export interface UploadTicket {
  upload_url: string;
  file_url: string;
  method: 'PUT' | 'POST';
  headers: Record<string, string>;
}

export interface AutocompleteResult {
  label: string;
  secondary: string;
  lat: number;
  lng: number;
  source: 'poi' | 'photon';
}

export interface Estimate {
  category: VehicleCategory;
  label: string;
  price_min: string;
  price_max: string;
  pricing_rule_id: string;
  cash_enabled: boolean;
  eta_pickup_s: number | null;
  available_drivers: number;
  on_quote: boolean;
}

export interface EstimateResponse {
  zone: Zone;
  distance_m: number;
  duration_s: number;
  route: LngLatTuple[];
  estimates: Estimate[];
}

export type RideStatus =
  | 'requested'
  | 'dispatching'
  | 'accepted'
  | 'arrived'
  | 'in_progress'
  | 'completed'
  | 'cancelled_by_passenger'
  | 'cancelled_by_driver'
  | 'no_driver';

export type PaymentMethod = 'wallet' | 'cash';

export interface RideDriver {
  id: string;
  first_name: string;
  photo_url: string | null;
  rating: number | null;
  rating_count: number;
  vehicle: {
    brand: string;
    model: string;
    color: string;
    license_plate: string;
    taxi_number: string | null;
    category: VehicleCategory;
  } | null;
  location: LatLngHeading | null;
}

export interface RidePassenger {
  id: string;
  first_name: string;
  last_initial: string;
  rating: number | null;
}

export interface Dispute {
  id: string;
  ride_id: string;
  reason: string;
  status: 'open' | 'resolved' | 'rejected';
  resolution: string | null;
  refund_amount: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface Ride {
  id: string;
  status: RideStatus;
  category: VehicleCategory;
  payment_method: PaymentMethod;
  type: 'immediate';
  pickup: Place;
  dropoff: Place;
  planned_route: LngLatTuple[] | null;
  planned_distance_m: number | null;
  planned_duration_s: number | null;
  estimated_price_min: string;
  estimated_price_max: string;
  reserved_amount: string;
  final_price: string | null;
  commission_amount: string | null;
  driver_earning: string | null;
  waiting_seconds: number;
  ride_seconds: number;
  otp_code?: string;
  otp_locked: boolean;
  driver: RideDriver | null;
  passenger?: RidePassenger | null;
  zone: Zone;
  cancellation_fee_preview: string | null;
  cancellation_fee?: string | null;
  requested_at: string;
  accepted_at: string | null;
  arrived_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  dispute_deadline_at: string | null;
  my_rating: { score: number; comment: string | null } | null;
  dispute: Dispute | null;
  deviation: { active: boolean; distance_off_m: number; since: string } | null;
  detour_until: string | null;
  share_token: string | null;
}

export interface Message {
  id: string;
  ride_id: string;
  sender_role: 'passenger' | 'driver' | 'support';
  body: string;
  sent_at: string;
  read_at: string | null;
}

export type ChatPreset = 'arriving' | 'waiting' | 'where' | 'coming' | 'traffic' | 'ok';

export interface ShareInfo {
  token: string;
  url: string;
  expires_at: string;
}

export interface SharedRide {
  status: RideStatus;
  driver_position: LatLngHeading | null;
  eta_s: number | null;
  dropoff: LatLng;
  vehicle: { brand: string; model: string; color: string; license_plate: string } | null;
}

export interface Wallet {
  balance: string;
  reserved_balance: string;
  available: string;
  currency: string;
  cash_debt_limit?: string;
  payout_min?: string;
  payout_daily_cap?: string;
}

export type TransactionType =
  | 'deposit'
  | 'ride_payment'
  | 'ride_earning'
  | 'commission'
  | 'payout'
  | 'refund'
  | 'cancellation_fee'
  | 'adjustment';
export type TransactionStatus = 'pending' | 'completed' | 'failed' | 'expired';
export type MobileOperator = 'mtn' | 'airtel';

export interface Transaction {
  id: string;
  type: TransactionType;
  status: TransactionStatus;
  amount: string;
  operator: MobileOperator | null;
  external_reference: string | null;
  ride_id: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface Offer {
  /** Durée de l'offre en secondes (serveur) */
  ttl_s?: number;
  /** Échéance calculée côté client (ms epoch) : évite les écarts d'horloge */
  deadline?: number;
  ride_id: string;
  category: VehicleCategory;
  pickup: Place & { distance_m: number };
  dropoff: Place;
  estimated_earning: string;
  expires_at: string;
}

export interface DriverPosition {
  lat: number;
  lng: number;
  heading: number | null;
  speed_kmh: number | null;
  accuracy_m: number | null;
  recorded_at: string;
  ride_id?: string;
}

// ---- Back-office ----

export interface Dashboard {
  rides_in_progress: number;
  drivers_online: number;
  drivers_available: number;
  rides_waiting: number;
  revenue_today: string;
  commission_today: string;
  cancellation_rate: number;
  alerts_open: number;
  rides_today: number;
}

export interface FleetDriver {
  id: string;
  first_name: string;
  last_initial: string;
  status: 'available' | 'busy' | 'offline';
  location: LatLngHeading | null;
  ride_id: string | null;
  category: VehicleCategory;
  last_location_at: string | null;
}

export interface FleetRide {
  id: string;
  status: RideStatus;
  pickup: LatLng;
  dropoff: LatLng;
  driver_position: LatLng | null;
}

export interface Fleet {
  drivers: FleetDriver[];
  rides: FleetRide[];
}

export type AlertType =
  'deviation' | 'emergency' | 'otp_locked' | 'detour' | 'position_lost' | 'price_capped';

export interface Alert {
  id: string;
  type: AlertType;
  ride_id: string | null;
  driver: { first_name: string } | null;
  passenger: { first_name: string } | null;
  payload: Record<string, unknown>;
  status: 'open' | 'acknowledged';
  acknowledged_by: string | null;
  created_at: string;
}

export interface RideEvent {
  id?: string;
  event_type: string;
  actor_id?: string | null;
  payload?: Record<string, unknown>;
  occurred_at: string;
}

export interface AdminRide extends Ride {
  passenger_phone: string | null;
  driver_phone: string | null;
  events: RideEvent[];
  positions: DriverPosition[];
  messages: Message[];
  actual_route: LngLatTuple[] | null;
}

export interface AdminDriver extends User {
  driver: DriverProfile;
  documents: DriverDocument[];
  vehicles: Vehicle[];
}

export interface AdminPassenger extends User {
  rides_count: number;
  wallet_balance: string;
  is_blocked: boolean;
}

export interface PricingRule {
  id: string;
  zone_id: string;
  category: VehicleCategory;
  base_fare: string;
  per_km: string;
  per_minute: string;
  minimum_fare: string;
  free_waiting_seconds: number;
  waiting_per_minute: string;
  cancellation_fee: string;
  driver_cancellation_share: string;
  commission_rate: string;
  surge_multiplier: string;
  cash_enabled: boolean;
  effective_from: string;
  effective_to: string | null;
}

export type PricingRuleInput = Omit<PricingRule, 'id'>;

export interface SimulationResult {
  price: string;
  rule: PricingRule;
  breakdown: Record<string, string | number>;
}

export interface GeoJsonPolygon {
  type: 'Polygon' | 'MultiPolygon';
  coordinates: number[][][] | number[][][][];
}

export interface AdminZone extends Zone {
  polygon: GeoJsonPolygon | null;
  cash_debt_limit: string;
  min_driver_rating: number | null;
  payout_min: string;
  payout_daily_cap: string;
  payout_manual_threshold: string | null;
}

export interface Poi {
  id: string;
  name: string;
  aliases: string[];
  lat: number;
  lng: number;
  zone_id: string;
}

export interface AdminDispute extends Dispute {
  ride: AdminRide;
}

export interface FinanceSummary {
  wallets_total: string;
  reserved_total: string;
  payouts_pending: string;
  deposits_today: string;
  commission_today: string;
}

export interface PayoutRequest {
  id: string;
  driver: { id: string; first_name: string; last_name: string } | null;
  driver_id?: string;
  amount: string;
  operator: MobileOperator;
  phone_number: string;
  status: 'pending' | 'approved' | 'rejected' | 'completed' | 'failed';
  created_at: string;
  processed_at: string | null;
}

export interface ReconciliationResult {
  matched: number;
  mismatched: Array<Record<string, unknown>>;
  missing: Array<Record<string, unknown>>;
}

export interface AuditLog {
  id: string;
  actor: { id: string; first_name: string; last_name: string } | string | null;
  action: string;
  target_type: string;
  target_id: string;
  diff: Record<string, unknown> | null;
  created_at: string;
}

export interface TotpSetup {
  secret: string;
  otpauth_url: string;
}
