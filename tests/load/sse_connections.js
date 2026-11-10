// SSE connection counts at L3 (SC-0407-04, ADR-0407; docs/saas/15-stress-testing.md).
//
// L3 is 10,000 active users. Each holds one `/api/events` stream (one signed-in tab), so the
// target is 10,000 concurrent streams across the API instances, each getting its first frame
// (a heartbeat comment or an event) within 25 s, none dropped early, while routine API reads
// keep p95 under 300 ms. Pass/fail is the thresholds below.
//
// Run against staging only, never production, with the xk6-sse extension:
//   xk6 build v1.4.0 --with github.com/phymbert/xk6-sse@v0.1.12 --output ./k6
//   ./k6 run -e API=https://api.staging.example -e TOKENS=tokens.json tests/load/sse_connections.js
// TOKENS is a JSON list of {"token", "workspace"} for synthetic staging users (Stripe test mode,
// capped AI keys). Smaller runs: -e STREAMS=1000. tests/test_cloud_load_scripts.py checks it.
import http from "k6/http";
import sse from "k6/x/sse";
import { check } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";
import { SharedArray } from "k6/data";

const API = __ENV.API;
const STREAMS = Number(__ENV.STREAMS || 10000);
const HOLD_S = Number(__ENV.HOLD_S || 120);
const users = new SharedArray("users", () => JSON.parse(open(__ENV.TOKENS || "tokens.json")));

const firstFrame = Trend("sse_first_frame_ms", true);
const heldOpen = Rate("sse_held_open");
const frames = Counter("sse_frames");

export const options = {
  scenarios: {
    streams: {
      executor: "ramping-vus",
      exec: "stream",
      startVUs: 0,
      stages: [
        { duration: "5m", target: STREAMS },
        { duration: "10m", target: STREAMS },
        { duration: "1m", target: 0 },
      ],
      gracefulRampDown: "30s",
    },
    routine: {
      executor: "constant-arrival-rate",
      exec: "routine",
      rate: 50,
      timeUnit: "1s",
      duration: "16m",
      preAllocatedVUs: 100,
    },
  },
  thresholds: {
    sse_first_frame_ms: ["p(95)<25000"],
    sse_held_open: ["rate>0.99"],
    "http_req_duration{scenario:routine}": ["p(95)<300"],
    "http_req_failed{scenario:routine}": ["rate<0.005"],
    checks: ["rate>0.99"],
  },
};

function user() {
  return users[(__VU - 1) % users.length];
}

function headers(who) {
  return { Authorization: `Bearer ${who.token}`, "X-Workspace-ID": who.workspace };
}

export function stream() {
  const who = user();
  const opened = Date.now();
  let first = 0;
  const response = sse.open(
    `${API}/api/events`,
    { headers: headers(who), tags: { name: "GET /api/events" } },
    (client) => {
      client.on("event", () => {
        frames.add(1);
        if (!first) {
          first = Date.now();
          firstFrame.add(first - opened);
        }
      });
      client.on("error", () => client.close());
      // Heartbeats come every 20 s; hold for HOLD_S then hang up ourselves.
      setTimeout(() => client.close(), HOLD_S * 1000);
    },
  );
  const lasted = (Date.now() - opened) / 1000;
  heldOpen.add(lasted >= HOLD_S - 1);
  check(response, { "stream opened": (r) => r && r.status === 200 });
}

export function routine() {
  const who = user();
  const response = http.get(`${API}/api/account`, {
    headers: headers(who),
    tags: { name: "GET /api/account" },
  });
  check(response, { "routine read ok": (r) => r.status === 200 });
}
