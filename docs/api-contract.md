# VTC 242 — Contrat d'API v1 (référence frontend ↔ backend)

Base : `{VITE_API_URL}/api/v1` (local : `http://localhost:8000/api/v1`).
JSON partout. `Authorization: Bearer <access JWT>`. Erreurs : `{ "code": "...", "message": "...", "details": {...} }`.
Pagination par curseur : `{ "results": [...], "next": "<cursor|null>", "previous": "<cursor|null>" }` (paramètre `?cursor=`).
Montants : chaînes décimales en XAF (`"12500.00"`). Dates : ISO 8601 UTC. Coordonnées : `{ "lat": -4.26, "lng": 15.28 }`.
Les POST financiers et `POST /rides` acceptent `Idempotency-Key: <uuid>`.

Jamais de numéro de téléphone de l'autre partie dans aucune réponse ni trame WebSocket.

## Auth (F-01, F-02)

| Route | Body | Réponse |
|---|---|---|
| `POST /auth/otp/request` | `{ "phone_number": "+242061234567" }` | `202 { "expires_in": 300 }` · `429` au-delà de 3 envois / 15 min |
| `POST /auth/otp/verify` | `{ "phone_number", "code": "123456", "role": "passenger"\|"driver" (optionnel, création seulement) }` | `200 { "access", "refresh", "user": User }` · `400 code invalide` · `423 bloqué 15 min` |
| `POST /auth/token/refresh` | `{ "refresh" }` | `200 { "access", "refresh" }` (rotation) |
| `POST /auth/logout` | `{ "refresh" }` | `204` |

En local (`SMS_BACKEND=console`), l'OTP est affiché dans les logs de l'API et, si `DEBUG_OTP_IN_RESPONSE=1`, renvoyé dans `POST /auth/otp/request` sous `"debug_code"`.

### User
```json
{ "id": "uuid", "phone_number": "+242…", "first_name": "Scott", "last_name": "K.", "role": "passenger|driver|admin|finance|support",
  "photo_url": null, "language": "fr", "is_active": true, "created_at": "…",
  "driver": DriverProfile|null, "totp_enabled": false }
```

## Profil

| Route | Body | Réponse |
|---|---|---|
| `GET /me` | | `User` |
| `PATCH /me` | `{ first_name?, last_name?, photo_url?, language? }` | `User` |
| `DELETE /me` | | `204` (anonymisation) |
| `POST /me/push-subscriptions` | `{ endpoint, keys: { p256dh, auth }, user_agent? }` | `201` |
| `POST /me/uploads` | `{ "kind": "profile_photo"\|"document", "content_type": "image/jpeg", "filename" }` | `{ "upload_url", "file_url", "method": "PUT", "headers": {} }` (URL pré-signée ; en local, l'API accepte le PUT elle-même) |

## Géo (F-11, F-56)

| Route | Réponse |
|---|---|
| `GET /geo/autocomplete?q=&lat=&lng=` | `{ "results": [ { "label": "Marché Total", "secondary": "Bacongo, Brazzaville", "lat", "lng", "source": "poi"\|"photon" } ] }` |
| `GET /geo/zones/resolve?lat=&lng=` | `Zone` ou `404` |

### Zone (public)
```json
{ "id", "name": "Brazzaville", "city": "Brazzaville", "emergency_police": "117", "emergency_fire": "118",
  "cash_enabled": true, "deviation_threshold_m": 300, "deviation_hits": 3, "is_active": true }
```

## Courses (section 7.1)

### Estimation — `POST /rides/estimate`
Body : `{ "pickup": { "lat", "lng", "address" }, "dropoff": { "lat", "lng", "address" } }`
```json
{ "zone": Zone, "distance_m": 6400, "duration_s": 1080, "route": [[lng,lat], ...],
  "estimates": [ { "category": "taxi", "label": "Taxi conventionné", "price_min": "1500.00", "price_max": "1800.00",
                   "pricing_rule_id": "uuid", "cash_enabled": true, "eta_pickup_s": 240, "available_drivers": 3, "on_quote": false } ] }
```
Catégories : `taxi`, `standard`, `vip`, `wedding` (sur devis : `on_quote: true`), `moving`.
`422` hors zone.

### Création — `POST /rides`
Body : `{ "category", "pricing_rule_id", "payment_method": "wallet"|"cash", "pickup": {...}, "dropoff": {...} }`
`201 Ride` · `402 solde insuffisant` (`{ code: "insufficient_funds", details: { required, available } }`) · `409 course déjà active` · `422 hors zone`.

### Ride (vue passager ; vue chauffeur identique sauf `otp_code` absent et `passenger` présent)
```json
{ "id", "status": "requested|dispatching|accepted|arrived|in_progress|completed|cancelled_by_passenger|cancelled_by_driver|no_driver",
  "category", "payment_method", "type": "immediate",
  "pickup": { "lat", "lng", "address" }, "dropoff": { "lat", "lng", "address" },
  "planned_route": [[lng,lat], ...] | null, "planned_distance_m", "planned_duration_s",
  "estimated_price_min": "1500.00", "estimated_price_max": "1800.00", "reserved_amount": "1800.00",
  "final_price": null, "commission_amount": null, "driver_earning": null,
  "waiting_seconds": 0, "ride_seconds": 0,
  "otp_code": "4821",            // passager uniquement
  "otp_locked": false,
  "driver": { "id", "first_name": "Jean", "photo_url", "rating": 4.8, "rating_count": 120,
              "vehicle": { "brand", "model", "color", "license_plate", "taxi_number", "category" },
              "location": { "lat", "lng", "heading" } | null } | null,
  "passenger": { "id", "first_name": "Scott", "last_initial": "K", "rating": 4.9 } | null,   // chauffeur uniquement
  "zone": Zone,
  "cancellation_fee_preview": "500.00",   // frais si le demandeur annule maintenant
  "requested_at", "accepted_at", "arrived_at", "started_at", "completed_at", "cancelled_at", "cancel_reason",
  "dispute_deadline_at", "my_rating": null | { "score", "comment" }, "dispute": null | Dispute,
  "deviation": null | { "active": true, "distance_off_m": 420, "since": "…" },
  "detour_until": null, "share_token": null }
```

| Route | Acteur | Body | Réponse |
|---|---|---|---|
| `GET /rides/{id}` | passager, chauffeur | | `Ride` (404 si autrui) |
| `GET /rides?status=` | | `status` = liste séparée par virgules ; `?active=1` renvoie la course active | page de `Ride` |
| `POST /rides/{id}/cancel` | | `{ "reason" }` | `Ride` (`fee` dans `Ride.cancellation_fee` après) |
| `POST /rides/{id}/retry` | passager | — | `Ride` (`dispatching`) : relance la recherche après `no_driver`, fonds toujours réservés |
| `POST /rides/{id}/accept` | chauffeur | | `Ride` · `409` |
| `POST /rides/{id}/decline` | chauffeur | | `204` |
| `POST /rides/{id}/arrive` | chauffeur | `{ "lat", "lng" }` | `Ride` · `422 trop loin` |
| `POST /rides/{id}/start` | chauffeur | `{ "otp_code": "4821", "lat", "lng" }` | `Ride` · `400 { code: "invalid_otp", details: { attempts_left } }` · `423 locked` |
| `POST /rides/{id}/detour` | chauffeur | `{ "reason" }` | `Ride` |
| `POST /rides/{id}/complete` | chauffeur | `{ "lat", "lng" }` | `Ride` · `422 trop loin` |
| `POST /rides/{id}/confirm-arrival` | passager | | `Ride` |
| `POST /rides/{id}/rate` | | `{ "score": 1-5, "comment"? }` | `201` |
| `POST /rides/{id}/dispute` | passager | `{ "reason" }` | `201 Dispute` |
| `GET /rides/{id}/messages` | | | `{ "results": [Message] }` |
| `POST /rides/{id}/messages` | | `{ "body" }` ou `{ "preset": "arriving" }` | `201 Message` |
| `POST /rides/{id}/share` | passager | | `{ "token", "url", "expires_at" }` |
| `GET /share/{token}` | public | | `{ "status", "driver_position": {lat,lng,heading}, "eta_s", "dropoff": {lat,lng}, "vehicle": {brand,model,color,license_plate} }` |
| `POST /rides/{id}/emergency` | | `{ "number_called": "117", "lat", "lng" }` | `201` |
| `GET /rides/{id}/receipt` | passager | | PDF (`application/pdf`) |

Message : `{ "id", "ride_id", "sender_role": "passenger"|"driver"|"support", "body", "sent_at", "read_at" }`.
Messages prédéfinis (`preset`) : `arriving` (« J'arrive dans 2 minutes »), `waiting` (« Je vous attends au point de prise en charge »), `where` (« Où êtes-vous exactement ? »), `coming` (« J'arrive »), `traffic` (« Il y a des embouteillages, je serai en retard »), `ok` (« D'accord »).

Dispute : `{ "id", "ride_id", "reason", "status": "open|resolved|rejected", "resolution", "refund_amount", "created_at", "resolved_at" }`.

## Wallet (F-24, F-40, section 8)

| Route | Body | Réponse |
|---|---|---|
| `GET /wallet` | | `{ "balance": "12500.00", "reserved_balance": "1800.00", "available": "10700.00", "currency": "XAF", "cash_debt_limit": "-5000.00" (chauffeur) , "payout_min": "2000.00", "payout_daily_cap": "200000.00" }` |
| `GET /wallet/transactions` | | page de `Transaction` |
| `POST /wallet/deposit` | `{ "amount": "5000", "operator": "mtn"|"airtel", "phone_number" }` | `202 Transaction (pending)` |
| `POST /wallet/payout` | `{ "amount", "operator", "phone_number" }` | `202 Transaction` · `422` |

Transaction : `{ "id", "type": "deposit|ride_payment|ride_earning|commission|payout|refund|cancellation_fee|adjustment", "status": "pending|completed|failed|expired", "amount": "-1800.00", "operator": "mtn"|null, "external_reference", "ride_id", "created_at", "completed_at" }`.

En sandbox (`PAYMENT_PROVIDER_MODE=sandbox`), le dépôt aboutit automatiquement après ~3 s ; un montant se terminant par `1` est refusé, par `2` expire (pour la recette).

## Chauffeur (F-30 à F-41)

| Route | Body | Réponse |
|---|---|---|
| `GET /drivers/me` | | `DriverProfile` |
| `PATCH /drivers/me/status` | `{ "is_online": true }` | `DriverProfile` · `422` si non validé / dette dépassée / pas de véhicule actif |
| `POST /drivers/me/location` | `{ "positions": [ { lat, lng, heading, speed_kmh, accuracy_m, recorded_at, ride_id? } ] }` | `202 { "accepted": n }` |
| `GET /drivers/me/vehicles` | | `[Vehicle]` |
| `POST /drivers/me/vehicles` | `{ brand, model, color, license_plate, taxi_number?, category, seats }` | `201 Vehicle` |
| `PATCH /drivers/me/vehicles/{id}` | `{ is_active: true }` | `Vehicle` |
| `GET /drivers/me/documents` | | `[Document]` |
| `POST /drivers/me/documents` | `{ "type", "file_url", "expires_at"? }` | `201 Document` |
| `GET /drivers/me/offers/current` | | `Offer` ou `204` (fallback REST) |

DriverProfile : `{ "id", "status": "pending|approved|suspended|rejected", "license_number", "rating_avg", "rating_count", "is_online", "is_available", "active_vehicle_id", "consecutive_declines", "paused_until", "zone": Zone|null, "documents_summary": { "license": "missing|pending|approved|rejected", ... }, "can_go_online": bool, "blocking_reason": string|null }`.
Vehicle : `{ "id", "brand", "model", "color", "license_plate", "taxi_number", "category", "seats", "is_verified", "is_active" }`.
Document : `{ "id", "type": "license|registration|insurance|taxi_card|id_card|vehicle_photo|profile_photo", "file_url", "status": "pending|approved|rejected", "review_note", "expires_at", "created_at" }`.
Offer : `{ "ride_id", "category", "pickup": { address, lat, lng, distance_m }, "dropoff": { address, lat, lng }, "estimated_earning": "1500.00", "expires_at" }`.

## Back-office (`/admin/*`, rôles admin / finance / support)

| Route | Rôle | Réponse |
|---|---|---|
| `GET /admin/dashboard` | tous | `{ "rides_in_progress", "drivers_online", "drivers_available", "rides_waiting", "revenue_today", "commission_today", "cancellation_rate", "alerts_open", "rides_today" }` |
| `GET /admin/fleet` | tous | `{ "drivers": [ { "id", "first_name", "last_initial", "status": "available|busy|offline", "location": {lat,lng,heading}, "ride_id", "category", "last_location_at" } ], "rides": [ { "id", "status", "pickup": {lat,lng}, "dropoff": {lat,lng}, "driver_position": {lat,lng}|null } ] }` |
| `GET /admin/alerts?status=open` | tous | page de `Alert` |
| `POST /admin/alerts/{id}/ack` | tous | `Alert` |
| `GET /admin/rides` · `GET /admin/rides/{id}` | tous | page de `AdminRide` (Ride + `passenger_phone`, `driver_phone`, `events[]`, `positions[]`, `messages[]`, `actual_route`) |
| `GET/POST /admin/rides/{id}/messages` | support | chat côté support |
| `GET /admin/drivers?status=pending&q=` | tous | page de `AdminDriver` (User + DriverProfile + `documents[]` + `vehicles[]`) |
| `POST /admin/drivers/{id}/approve` · `/reject { reason }` · `/suspend { reason }` · `/reinstate` | admin, support | `AdminDriver` |
| `POST /admin/documents/{id}/review` `{ "status": "approved"|"rejected", "note" }` | admin, support | `Document` |
| `GET /admin/passengers?q=` | tous | page (User + `rides_count`, `wallet_balance`, `is_blocked`) |
| `POST /admin/passengers/{id}/block { reason }` · `/unblock` · `/logout-all` | admin, support | User |
| `GET/POST /admin/pricing-rules` · `PATCH /admin/pricing-rules/{id}` | admin, finance | `PricingRule` |
| `POST /admin/pricing-rules/simulate` `{ zone_id, category, distance_m, duration_s, waiting_seconds, at? }` | admin, finance | `{ "price", "rule": PricingRule, "breakdown": {...} }` |
| `GET/POST /admin/zones` · `PATCH /admin/zones/{id}` | admin | `AdminZone` (Zone + `polygon` GeoJSON + `cash_debt_limit`, `min_driver_rating`, `payout_min`, `payout_daily_cap`, `payout_manual_threshold`) |
| `GET/POST/PATCH/DELETE /admin/pois` | admin, support | `{ id, name, aliases[], lat, lng, zone_id }` |
| `GET /admin/disputes?status=open` · `GET /admin/disputes/{id}` | tous | Dispute + `ride: AdminRide` |
| `POST /admin/disputes/{id}/resolve` `{ "refund_amount", "resolution" }` · `/reject { "resolution" }` | admin, finance | Dispute |
| `GET /admin/finance/summary` | admin, finance | `{ "wallets_total", "reserved_total", "payouts_pending", "deposits_today", "commission_today" }` |
| `GET /admin/finance/transactions?type=&status=&operator=` | admin, finance | page |
| `GET /admin/finance/payouts?status=pending` · `POST /admin/finance/payouts/{id}/approve` · `/reject` | admin, finance | PayoutRequest |
| `POST /admin/finance/reconciliation/import` (multipart CSV `operator,external_reference,amount,status`) | admin, finance | `{ "matched", "mismatched": [...], "missing": [...] }` |
| `GET /admin/finance/export?type=transactions|rides&from=&to=` | admin, finance | CSV |
| `GET /admin/audit-logs` | admin | page `{ id, actor, action, target_type, target_id, diff, created_at }` |
| `GET /admin/users?role=` · `POST /admin/users` `{ phone_number, first_name, last_name, role }` | admin | User |
| `POST /admin/totp/setup` → `{ secret, otpauth_url }` · `POST /admin/totp/verify { code }` | admin, finance | 2FA obligatoire : sans TOTP validé sur la session, `/admin/*` répond `403 { code: "totp_required" }` ; `POST /admin/totp/verify` renvoie un nouveau `access` |

PricingRule : `{ "id", "zone_id", "category", "base_fare", "per_km", "per_minute", "minimum_fare", "free_waiting_seconds", "waiting_per_minute", "cancellation_fee", "driver_cancellation_share": "0.50", "commission_rate": "0.15", "surge_multiplier": "1.00", "cash_enabled", "effective_from", "effective_to" }`.
Alert : `{ "id", "type": "deviation|emergency|otp_locked|detour|position_lost|price_capped", "ride_id", "driver": {first_name}, "passenger": {first_name}, "payload", "status": "open|acknowledged", "acknowledged_by", "created_at" }`.

## WebSocket

URL : `{VITE_WS_URL}/ws/?token=<access>`. Trame : `{ "event", "ts", "data" }`. Ping client toutes les 20 s (`{ "event": "ping" }` → `{ "event": "pong" }`).

| Événement | Sens | data |
|---|---|---|
| `driver.location` | chauffeur → serveur | `{ lat, lng, heading, speed_kmh, accuracy_m, recorded_at, ride_id? }` |
| `ride.offer` | serveur → chauffeur | `Offer` |
| `ride.offer_response` | chauffeur → serveur | `{ ride_id, accepted }` |
| `ride.status_updated` | serveur → passager, chauffeur | `Ride` (vue selon rôle) |
| `ride.driver_position` | serveur → passager | `{ ride_id, lat, lng, heading, eta_s }` |
| `ride.deviation_alert` / `ride.deviation_cleared` | serveur → passager, back-office | `{ ride_id, distance_off_m, emergency_numbers: { police, fire } }` |
| `ride.position_lost` / `ride.position_restored` | serveur → passager | `{ ride_id, since }` |
| `chat.message` | bidirectionnel | `Message` (envoi : `{ ride_id, body }` ou `{ ride_id, preset }`) |
| `ride.cancelled` | serveur → concerné | `{ ride_id, by, reason, fee }` |
| `wallet.updated` | serveur → utilisateur | `{ balance, reserved_balance, available }` |
| `admin.dashboard` | serveur → back-office | `{ kpis: Dashboard, alerts: [Alert] }` toutes les 5 s |
| `admin.fleet` | serveur → back-office | `Fleet` toutes les 5 s |
| `admin.alert` | serveur → back-office | `Alert` |
