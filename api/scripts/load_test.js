// k6 (A-16) : 300 chauffeurs envoyant une position toutes les 4 s + 50 commandes / min pendant 15 min.
// k6 run -e API=https://staging-api.vtc242.cg -e DRIVER_TOKENS=tokens.json -e PASSENGER_TOKENS=ptokens.json scripts/load_test.js
import http from "k6/http";
import { check, sleep } from "k6";
import { SharedArray } from "k6/data";

const API = __ENV.API || "http://localhost:8000";
const driverTokens = new SharedArray("drivers", () => JSON.parse(open(__ENV.DRIVER_TOKENS || "./tokens.json")));
const passengerTokens = new SharedArray("passengers", () => JSON.parse(open(__ENV.PASSENGER_TOKENS || "./ptokens.json")));

export const options = {
  scenarios: {
    drivers: { executor: "constant-vus", vus: 300, duration: "15m", exec: "driverLoop" },
    passengers: { executor: "constant-arrival-rate", rate: 50, timeUnit: "1m", duration: "15m", preAllocatedVUs: 20, exec: "order" },
  },
  thresholds: { http_req_failed: ["rate<0.001"], http_req_duration: ["p(95)<400"] },
};

export function driverLoop() {
  const token = driverTokens[__VU % driverTokens.length];
  const lat = -4.26 + Math.random() * 0.04, lng = 15.25 + Math.random() * 0.05;
  const res = http.post(`${API}/api/v1/drivers/me/location`, JSON.stringify({ positions: [{ lat, lng, accuracy_m: 10, recorded_at: new Date().toISOString() }] }),
    { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
  check(res, { "position 202": (r) => r.status === 202 });
  sleep(4);
}

export function order() {
  const token = passengerTokens[Math.floor(Math.random() * passengerTokens.length)];
  const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const pickup = { lat: -4.265, lng: 15.28, address: "Marché Total" }, dropoff = { lat: -4.2517, lng: 15.2531, address: "Aéroport" };
  const est = http.post(`${API}/api/v1/rides/estimate`, JSON.stringify({ pickup, dropoff }), { headers: h });
  check(est, { "estimate 200": (r) => r.status === 200 });
  if (est.status !== 200) return;
  const rule = est.json("estimates.0.pricing_rule_id");
  const ride = http.post(`${API}/api/v1/rides`, JSON.stringify({ category: "taxi", pricing_rule_id: rule, payment_method: "cash", pickup, dropoff }), { headers: h });
  check(ride, { "ride 201/409": (r) => r.status === 201 || r.status === 409 });
}
