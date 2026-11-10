// The load ladder L1 to L4 on staging (ADR-0411 SC-0411-04, docs/saas/15-stress-testing.md §15.4
// and §15.6). Levels and thresholds come from ../ladder.json, written by
// `python tests/load/ladder.py json`; tests/test_load_ladder.py checks they never drift.
//
//   k6 run -e LEVEL=L1 -e BASE_URL=https://staging.example -e TOKENS=tokens.txt tests/load/k6/ladder.js
//
// TOKENS is a file of bearer tokens for synthetic staging accounts, one per line. Never point this
// at production. A run fails (k6 exits non-zero) when any threshold is missed.

import http from 'k6/http';
import { check } from 'k6';
import { Counter, Trend, Rate } from 'k6/metrics';

const ladder = JSON.parse(open('../ladder.json'));
const level = ladder.levels[__ENV.LEVEL || 'L1'];
if (!level) throw new Error(`Unknown LEVEL ${__ENV.LEVEL}`);
const BASE = __ENV.BASE_URL;
if (!BASE) throw new Error('Set BASE_URL to a staging origin');
const tokens = open(__ENV.TOKENS || 'tokens.txt').split('\n').map((t) => t.trim()).filter(Boolean);
const t = ladder.thresholds;

const routine = new Trend('routine_duration', true);
const routineFailed = new Rate('routine_failed');
const duplicateResults = new Counter('duplicate_results');
const crossTenant = new Counter('cross_tenant_successes');

export const options = {
  scenarios: {
    journeys: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: level.active_users },
        { duration: `${level.duration_s}s`, target: level.active_users },
        { duration: '1m', target: 0 },
      ],
    },
  },
  thresholds: {
    routine_duration: [`p(95)<${t.routine_p95_ms}`],
    routine_failed: [`rate<${t.routine_error_rate}`],
    duplicate_results: [`count<=${t.duplicate_results}`],
    cross_tenant_successes: [`count<=${t.cross_tenant_successes}`],
  },
};

function headers(token) {
  return { headers: { Authorization: `Bearer ${token}`, Origin: BASE, 'Content-Type': 'application/json' } };
}

export default function () {
  const token = tokens[(__VU - 1) % tokens.length];
  const h = headers(token);
  for (const path of ladder.routine) {
    const r = http.get(`${BASE}${path}`, h);
    if (r.status !== 429) {
      routine.add(r.timings.duration);
      routineFailed.add(r.status >= 400);
    }
  }
  // A made-up asset id from someone else's workspace must look missing.
  const probe = http.get(`${BASE}/api/assets/00000000-0000-4000-8000-${String(__VU).padStart(12, '0')}`, h);
  if (probe.status < 400) crossTenant.add(1);

  const made = http.post(`${BASE}/api/devices`, JSON.stringify({ name: `k6 ${__VU}`, kind: 'laptop' }), h);
  if (!check(made, { 'device registered': (r) => r.status === 200 || r.status === 201 })) return;
  const deviceId = made.json('device.id');
  const taken = http.post(`${BASE}/api/playback/take-over`, JSON.stringify({ device_id: deviceId, start_playing: true }), h);
  if (taken.status !== 200) return;
  const body = JSON.stringify({ device_id: deviceId, command: 'pause', args: {}, based_on_seq: taken.json('session.seq'), idempotency_key: `k6-${__VU}-${__ITER}` });
  const first = http.post(`${BASE}/api/playback/commands`, body, h);
  const again = http.post(`${BASE}/api/playback/commands`, body, h);
  if (first.status === 200 && again.status === 200 && first.json('applied_seq') !== again.json('applied_seq')) duplicateResults.add(1);
}
