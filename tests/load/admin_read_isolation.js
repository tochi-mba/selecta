// Admin read-path isolation (SC-0408-03, ADR-0408): twenty admin viewers don't change customer
// API latency, because admin pages read metrics and small refreshed aggregates, never the live
// jobs table.
//
// Two phases of eight minutes each with the same customer load: `baseline` (no admins), then
// `with_admins` (20 staff browsers polling the admin pages every 5 s, as the console does).
// It fails when customer p95 with admins is over 300 ms or more than 10% above the baseline.
//
// Staging only:
//   k6 run -e API=https://api.staging.example -e TOKENS=tokens.json -e STAFF=staff.json \
//     tests/load/admin_read_isolation.js
// TOKENS: [{"token", "workspace"}] synthetic customers. STAFF: [{"token", "admin_session"}]
// synthetic staff with a read-only role. tests/test_cloud_load_scripts.py checks it.
import http from "k6/http";
import { check, sleep } from "k6";
import { SharedArray } from "k6/data";
import { Trend } from "k6/metrics";

const API = __ENV.API;
const PHASE = "8m";
const customers = new SharedArray("customers", () => JSON.parse(open(__ENV.TOKENS || "tokens.json")));
const staff = new SharedArray("staff", () => JSON.parse(open(__ENV.STAFF || "staff.json")));
const customerLatency = Trend("customer_latency_ms", true);

const ADMIN_PAGES = [
  "/api/admin/overview",
  "/api/admin/jobs",
  "/api/admin/workers",
  "/api/admin/accounts",
  "/api/admin/ai",
  "/api/admin/security",
  "/api/admin/flags",
];
const CUSTOMER_READS = ["/api/account", "/api/assets", "/api/jobs"];

export const options = {
  scenarios: {
    baseline: {
      executor: "constant-arrival-rate",
      exec: "customer",
      rate: 100,
      timeUnit: "1s",
      duration: PHASE,
      preAllocatedVUs: 100,
      tags: { phase: "baseline" },
    },
    with_admins: {
      executor: "constant-arrival-rate",
      exec: "customer",
      rate: 100,
      timeUnit: "1s",
      duration: PHASE,
      startTime: PHASE,
      preAllocatedVUs: 100,
      tags: { phase: "with_admins" },
    },
    admins: {
      executor: "constant-vus",
      exec: "admin",
      vus: 20,
      duration: PHASE,
      startTime: PHASE,
      tags: { phase: "with_admins" },
    },
  },
  thresholds: {
    "customer_latency_ms{phase:baseline}": ["p(95)<300"],
    "customer_latency_ms{phase:with_admins}": ["p(95)<300"],
    "http_req_failed{scenario:with_admins}": ["rate<0.005"],
    "http_req_failed{scenario:admins}": ["rate<0.01"],
  },
};

export function customer() {
  const who = customers[Math.floor(Math.random() * customers.length)];
  const path = CUSTOMER_READS[Math.floor(Math.random() * CUSTOMER_READS.length)];
  const response = http.get(`${API}${path}`, {
    headers: { Authorization: `Bearer ${who.token}`, "X-Workspace-ID": who.workspace },
    tags: { name: `GET ${path}` },
  });
  customerLatency.add(response.timings.duration);
  check(response, { "customer read ok": (r) => r.status === 200 });
}

export function admin() {
  const who = staff[(__VU - 1) % staff.length];
  for (const page of ADMIN_PAGES) {
    const response = http.get(`${API}${page}`, {
      headers: { Authorization: `Bearer ${who.token}`, "X-Admin-Session": who.admin_session },
      tags: { name: `GET ${page}` },
    });
    check(response, { "admin page ok": (r) => r.status === 200 });
  }
  sleep(5);
}

export function handleSummary(data) {
  const p95 = (phase) => {
    const metric = data.metrics[`customer_latency_ms{phase:${phase}}`];
    return metric ? metric.values["p(95)"] : null;
  };
  const before = p95("baseline");
  const during = p95("with_admins");
  const isolated = before !== null && during !== null && during <= Math.max(before * 1.1, before + 10);
  const verdict = { baseline_p95_ms: before, with_admins_p95_ms: during, isolated };
  return {
    stdout: `admin read isolation: ${JSON.stringify(verdict)}\n`,
    "admin_read_isolation.json": JSON.stringify(verdict, null, 2),
  };
}
