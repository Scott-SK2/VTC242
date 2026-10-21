import type {
  Alert,
  CarpoolTrip,
  Dashboard,
  DriverPosition,
  Fleet,
  Message,
  Offer,
  RentalBooking,
  Ride,
} from '@/shared/api/types';

/** Trames serveur → client, typées par nom d'événement. */
export interface ServerEvents {
  pong: Record<string, never>;
  'ride.offer': Offer;
  'ride.status_updated': Ride;
  'ride.driver_position': {
    ride_id: string;
    lat: number;
    lng: number;
    heading: number | null;
    eta_s: number | null;
  };
  'ride.deviation_alert': {
    ride_id: string;
    distance_off_m: number;
    emergency_numbers: { police: string; fire: string };
  };
  'ride.deviation_cleared': { ride_id: string; distance_off_m?: number };
  'ride.position_lost': { ride_id: string; since: string };
  'ride.position_restored': { ride_id: string; since?: string };
  'chat.message': Message;
  'ride.cancelled': { ride_id: string; by: string; reason: string | null; fee: string | null };
  'wallet.updated': { balance: string; reserved_balance: string; available: string };
  'admin.dashboard': { kpis: Dashboard; alerts: Alert[] };
  'admin.fleet': Fleet;
  'admin.alert': Alert;
  'rental.booking_updated': RentalBooking;
  'carpool.trip_updated': CarpoolTrip;
  /** Événements internes du client. */
  'ws.open': { reconnected: boolean };
  'ws.close': { code: number };
}

/** Trames client → serveur. */
export interface ClientEvents {
  ping: Record<string, never>;
  'driver.location': DriverPosition;
  'ride.offer_response': { ride_id: string; accepted: boolean };
  'chat.message': { ride_id: string; body: string } | { ride_id: string; preset: string };
}

export interface Frame<E extends string = string, D = unknown> {
  event: E;
  ts: number;
  data: D;
}
