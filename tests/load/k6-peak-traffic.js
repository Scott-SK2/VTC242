// Test de charge k6 (https://k6.io) — heures de pointe sur l'API VTC 242.
//
//   k6 run -e BASE_URL=https://staging.vtc242.cg -e PASSENGER_TOKEN=<jwt> tests/load/k6-peak-traffic.js
//
// Ne JAMAIS lancer contre la production : chaque itération crée puis annule une commande
// (annulation gratuite avant acceptation, les fonds réservés sont libérés).
// Le jeton est celui d'un passager de test disposant d'un solde suffisant.
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  scenarios: {
    peak: {
      executor: 'ramping-vus',
      startVUs: 5,
      stages: [
        { duration: '2m', target: 50 }, // montée progressive
        { duration: '5m', target: 50 }, // plateau
        { duration: '1m', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500'], // objectif V1 (Render) : p95 < 500 ms
    'http_req_duration{name:estimate}': ['p(99)<800'],
    http_req_failed: ['rate<0.01'],
  },
};

const BASE = (__ENV.BASE_URL || 'http://localhost:8000') + '/api/v1';
const TOKEN = __ENV.PASSENGER_TOKEN;
const PICKUP = { lat: -4.265, lng: 15.28, address: 'Marché Total' };
const DROPOFF = { lat: -4.2517, lng: 15.2531, address: 'Aéroport Maya-Maya' };

export default function () {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` };

  const est = http.post(`${BASE}/rides/estimate`, JSON.stringify({ pickup: PICKUP, dropoff: DROPOFF }), {
    headers,
    tags: { name: 'estimate' },
  });
  check(est, { 'estimation 200': (r) => r.status === 200 });
  if (est.status !== 200) {
    sleep(2);
    return;
  }
  const taxi = est.json('estimates').find((e) => e.category === 'taxi');

  const created = http.post(
    `${BASE}/rides`,
    JSON.stringify({
      category: 'taxi',
      pricing_rule_id: taxi.pricing_rule_id,
      payment_method: 'wallet',
      pickup: PICKUP,
      dropoff: DROPOFF,
    }),
    { headers: { ...headers, 'Idempotency-Key': `k6-${__VU}-${__ITER}` }, tags: { name: 'create_ride' } },
  );
  // 409 = une commande est déjà active pour ce passager (itération précédente) : acceptable
  check(created, { 'commande 201/409': (r) => r.status === 201 || r.status === 409 });
  if (created.status === 201) {
    sleep(Math.random() * 2 + 1);
    const cancel = http.post(
      `${BASE}/rides/${created.json('id')}/cancel`,
      JSON.stringify({ reason: 'k6' }),
      { headers, tags: { name: 'cancel_ride' } },
    );
    check(cancel, { 'annulation 200': (r) => r.status === 200 });
  }
  sleep(Math.random() * 3 + 2);
}
