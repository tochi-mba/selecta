// Gateway isolation load test (ADR-0396 SC-0396-06, docs/saas/15-stress-testing.md 15.3 Database).
//
// Customers browse the Cloud API while, in the storm run, a worker storm hammers the separate
// worker gateway with registrations and long-poll claims. Run it twice against staging:
//
//   k6 run -e STORM=0 --summary-export=baseline.json tests/load/k6/gateway_storm.js
//   k6 run -e STORM=1 --summary-export=storm.json tests/load/k6/gateway_storm.js
//   python tests/load/compare_p95.py baseline.json storm.json
//
// The compare step fails if the customers' p95 under the storm is more than 10% (and 20 ms)
// worse than the baseline. Settings come from the environment, never from this file:
//   API_URL, GATEWAY_URL, CUSTOMER_TOKEN, WORKER_BOOTSTRAP_TOKEN, CUSTOMERS (default 200),
//   WORKERS (default 1000), DURATION (default 10m), POOL (default cpu-light).
import http from 'k6/http';
import { check, sleep } from 'k6';

const API = __ENV.API_URL;
const GATEWAY = __ENV.GATEWAY_URL;
const STORM = __ENV.STORM === '1';
const DURATION = __ENV.DURATION || '10m';
const POOL = __ENV.POOL || 'cpu-light';

const scenarios = {
  customers: {
    executor: 'constant-vus',
    vus: Number(__ENV.CUSTOMERS || 200),
    duration: DURATION,
    exec: 'browse',
  },
};
if (STORM) {
  scenarios.worker_storm = {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '30s', target: Number(__ENV.WORKERS || 1000) },
      { duration: DURATION, target: Number(__ENV.WORKERS || 1000) },
    ],
    exec: 'storm',
  };
}

export const options = {
  scenarios,
  thresholds: {
    // docs/saas/15-stress-testing.md 15.5: routine API p95 under 300 ms.
    'http_req_duration{scenario:customers}': ['p(95)<300'],
    'http_req_failed{scenario:customers}': ['rate<0.01'],
  },
};

const customer = { headers: { authorization: `Bearer ${__ENV.CUSTOMER_TOKEN}` } };
const ROUTES = ['/api/status', '/api/account', '/api/account/labs'];

export function browse() {
  const route = ROUTES[Math.floor(Math.random() * ROUTES.length)];
  const response = http.get(`${API}${route}`, customer);
  check(response, { 'customer request ok': (r) => r.status === 200 });
  sleep(1 + Math.random());
}

let workerToken = null;

export function storm() {
  if (workerToken === null) {
    const registered = http.post(
      `${GATEWAY}/internal/workers/register`,
      JSON.stringify({ pool: POOL, slots: 1 }),
      { headers: {
        authorization: `Bearer ${__ENV.WORKER_BOOTSTRAP_TOKEN}`,
        'content-type': 'application/json',
      } },
    );
    if (registered.status !== 201) {
      sleep(1);
      return;
    }
    workerToken = registered.json('token');
  }
  // Claim as fast as the gateway answers: an empty queue is the worst case for wake-ups.
  http.post(`${GATEWAY}/internal/workers/claim`, null, {
    headers: { authorization: `Bearer ${workerToken}` },
  });
}
