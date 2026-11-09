*Part of the [Selecta Cloud proposal](README.md). Proposed, for owner review.*

## 17. Roadmap

Durations assume one developer working with AI agents and are ranges, not promises. Each phase ends with evidence (tests, measurements, a short demo) and an updated ADR status.

| Phase | Weeks | Deliverables | Exit criteria |
|---|---|---|---|
| **0. Decide and measure** | 2–3 | ADRs 0391–0416 drafted; Linux container benchmarks of CPU-seconds, RAM and output bytes (egress) per stage; Modal CPU and GPU timing, cold starts and egress for stem windows and playback files; cost model filled with real numbers; legal kickoff (copyright, lyrics, S-KEY replacement, terms, privacy); threat model; licence register | You approve the ADRs; cost per song and per seam measured; legal questions listed with owners |
| **1. Durable jobs in local mode** | 4–6 | SQLAlchemy Core + Alembic schema with `workspace_id`; `jobs`/attempts/artifacts tables; runner replacing the seam-worker pipe, analysis subprocess and JSON export jobs; idempotency in DB; `ArtifactStore` (local); mode switch scaffold | Local app behaves the same (all existing tests + Playwright pass); jobs survive restarts and kills; you listen and confirm transitions are unchanged |
| **2. Fair scheduler and simulator** | 4–6 | Lanes, per-account weighted fair share, admission control, leases/fencing, retries, DAG release, cancellation; simulator; Hypothesis state-machine tests | Simulator invariants green over millions of decisions; fairness and starvation thresholds met; local mode uses the same policy |
| **3. Cloud data plane** | 4–6 | Postgres + RLS; R2 adapter; upload pipeline (multipart, reservations, validation sandbox); lazy playback files; gateway service; PgBouncer plus direct listener and leader connections; outbox and SSE fan-out; Linux worker images on Modal (CPU and GPU, EU region) with the autoscaler; staging environment; IaC; Linux CI | A synthetic user can upload, analyse, mix, play and export end to end on staging; L1–L2 load passes; chaos subset passes |
| **4. Identity, tenancy, billing, flag targeting** | 4–5 | AuthKit sign-in; workspaces; staff RBAC core and audit; Stripe Checkout/Portal/webhooks/reconciliation; plan catalogue; quotas; over-quota state; layered flag resolver with context, rules, propagation and the new registry fields (local mode untouched) | Cross-tenant suite 0 successes; billing scramble test passes; entitlement changes reach the queue at next dispatch; flag property tests and propagation targets met |
| **5. Lucy gateway** | 2–3 | Tier routing, registry, allowance ledger, spend guards, fallbacks, settings split, evaluation set | Lucy eval passes on each tier's deployment; spend ceilings proven with the fake provider |
| **6. SaaS UX and admin v1** | 5–7 | Onboarding, upload manager, library states, SSE events, account, plan & billing, data export, deletion, copy layer, help/legal pages; devices and the playback session (remotes, transfer); admin console's six pages including Flags | Playwright state matrix green on both modes; axe checks pass; you walk through onboarding on a phone and a laptop; transfer and offline-speaker tests pass on real devices |
| **6B. Rooms (Premium)** | 3–4 | Room panel, codes and QR, guest page bundle, votes, moderation, big-screen display, room request ordering on top of the request planner, guest privacy notice | Rooms stress scenarios pass; you run a real party test with a few phones and a laptop speaker |
| **7. Hardening** | 3–4 | Security review, dependency and secret scanning, L3–L4 and catastrophe runs, DR drill, runbooks, alerting, status page; S-KEY replaced; legal sign-off; ICO fee; DMCA agent; terms and privacy notice live | All [§15.6](15-stress-testing.md#156-passfail-thresholds-normal-supported-load) thresholds met; restore drill under 60 min; no open blockers |
| **8. Private beta** | 8–12 | Invite 50 → 150 → 300 users; measure costs, waits, conversion, Lucy usage; tune weights and allowances; pricing test | Unit economics known; no data-loss or isolation incidents; go/no-go for public launch |

**What to cut if time is short**: team workspaces, Stem Studio in cloud (keep stem-assisted transitions), discovery sweeps, annual plans, EU/US payments, admin pages beyond the first six, v2 segment streaming, Room votes and the big-screen display (Rooms can launch with requests and moderation only), experiments in the flag system.

**What not to cut**: leases and fencing, quota reservations, tenant isolation tests, Stripe reconciliation, the simulator, spend ceilings, the S-KEY replacement, legal review, the device lease (no double playback), flag kill switches.

---

## 18. Risks and open questions

| Risk | Impact | Mitigation |
|---|---|---|
| Copyright/legal exposure in the UK (no private copying exception) | Could block launch | Legal advice in Phase 0; private-locker design; takedown and repeat-infringer process |
| S-KEY replacement accuracy | Worse key detection → worse mixes | Benchmark candidates against S-KEY on your library; you listen-test |
| Lyrics licensing | Wordplay/lyric display limited | Decide in Phase 0; design features to work without displayed lines |
| Refactor breaks the local app you use daily | Lost trust, lost work | Phase 1 is local-first with your listening gate; main-checkout workflow with care around the running dev server |
| Lucy costs exceed revenue | Losses per user | Allowances, cheap Free model, cost KPIs per tier, emergency controls |
| Big-library imports spike compute | Cost spikes, slow queues | Daily caps, per-pool worker and spend ceilings, paced Free imports |
| Solo operator on call | Slow incident response | Strong alerts, runbooks, safe emergency controls, honest status page, beta-sized blast radius |
| Vendor changes (pricing, deprecations like Fly GPUs) | Re-platforming | Containers everywhere, S3 API for storage, worker gateway decouples compute vendors |
| EU VAT burden | Admin overhead | UK-only payments in beta; OSS registration or merchant of record before EU sales |

**Open questions for you** (none block approving this proposal):
1. Pricing: test the £6.99 / £12.99 hypothesis, or something else?
2. Should Free get Lucy at all at launch (cheap on Haiku), or is Lucy a paid hook?
3. Keep the cloud control plane in the public repo, or split it into a private repo later?
4. Offer a 14-day Premium trial in beta?
5. Product name for the cloud edition ("Selecta Cloud" is a placeholder).
6. Rooms: is 100 guests the right beta cap, and should Standard get one trial room?
7. ADR-0390 says flags are developer-only with no switch page. The cloud Flags page reverses that for cloud mode only; ADR-0414 records it, but it's your call to accept.

---

## 19. Repository layout (target)

```
src/selecta/
  (existing engine modules stay where they are)
  modes/            # local vs cloud wiring, adapter selection
  storage/          # ArtifactStore: local + R2 implementations, upload sessions
  persistence/      # SQLAlchemy Core tables, repositories, Alembic env
  jobs/             # job model, state machine, producers, outbox
  scheduling/       # fair policy (shared with simulator), lanes, admission
  workers/          # runner loop, gateway client, pool configs
  gateway/          # worker gateway routes (/internal/workers)
  identity/         # AuthKit verification, sessions, workspaces
  authz/            # permission registry, roles, scopes, checks, audit
  billing/          # Stripe client, webhook processing, plan catalogue, entitlements
  usage/            # ledger, quotas, allowances
  ai/               # Lucy gateway: registry, routing, spend guards (wraps lucy/providers.py)
  admin/            # admin API routes and read models
  flags/            # existing registry + guard; adds context, rules, layered resolver, snapshot cache
  playback/         # devices, playback sessions, leases, remote commands
  rooms/            # rooms, guests, codes, votes, moderation, display pairing
  maintenance/      # leader election, reaper, reconcilers, GC
migrations/         # Alembic versions (SQLite + Postgres)
services/           # Dockerfiles: api, worker-cpu, worker-gpu; Modal app definitions
infra/              # OpenTofu (Cloudflare), render.yaml, compose for local cloud-mode dev
tests/sim/          # scheduler simulator
tests/integration/  # Postgres/MinIO tests (Linux CI)
tests/load/         # k6 + Locust
tests/chaos/        # fault injection scripts
web/src/uploads/  web/src/account/  web/src/billing/  web/src/activity/  web/src/admin/  web/src/copy/
web/src/devices/  web/src/rooms/    web/guest/  (separate tiny bundle for /r/{code} and /display)
docs/saas/          # this proposal, split into chapters
docs/operations/    # runbooks
```

Every new file stays under the 1,000-line CI limit.

---

## 20. ADRs to add (all start as Proposed; you decide acceptance)

Format follows the repo's later ADRs (Decision / Implementation / Independent verification header bullets, context, decision, user outcome, numbered checklist with acceptance and evidence).

ADR-0390 (feature flags) already exists; the new set starts at 0391.

| ADR | Title |
|---|---|
| [0391](../adr/adr-0391-selecta-cloud-goal-and-local-guarantees.md) | Selecta Cloud becomes a goal; local-only guarantees (ADR-0025, ADR-0072 and the repeated SaaS non-goals) are scoped to local mode |
| [0392](../adr/adr-0392-two-runtime-modes.md) | Two runtime modes, one codebase |
| [0393](../adr/adr-0393-postgres-alembic-and-tenancy.md) | PostgreSQL system of record; SQLAlchemy Core + Alembic for SQLite and Postgres; `workspace_id` tenancy and RLS |
| [0394](../adr/adr-0394-durable-jobs-leases-and-fencing.md) | Durable job model, lifecycle, leases and fencing; retire the seam-worker pipe, analysis subprocess and JSON export jobs |
| [0395](../adr/adr-0395-fair-scheduling-policy.md) | Scheduling policy: lanes, per-account weighted fair share by tier, server-assigned urgency, admission control |
| [0396](../adr/adr-0396-worker-gateway-and-pools.md) | Worker gateway and pools; workers hold no database or storage credentials; gateway as its own service; Modal workers at beta, reserved Hetzner pool later, never Render; autoscaling signals |
| [0397](../adr/adr-0397-object-storage-layout.md) | Object storage layout on R2; attempt-scoped writes; artifact provenance; no cross-account dedupe |
| [0398](../adr/adr-0398-upload-protocol-and-quota-reservations.md) | Upload protocol: always multipart, server-side completion, quota reservations, validation sandbox |
| [0399](../adr/adr-0399-cloud-playback-proxies.md) | Cloud playback: FLAC playback proxies, signed URLs, CORS; segment streaming later |
| [0400](../adr/adr-0400-identity-with-workos-authkit.md) | Identity with WorkOS AuthKit; session model; minimum age |
| [0401](../adr/adr-0401-authorization-rbac-and-audit.md) | Authorization: permission registry, roles, scopes, step-up, delayed dangerous actions, audit log |
| [0402](../adr/adr-0402-plans-entitlements-and-quotas.md) | Plans, entitlements, quotas and allowances; over-quota read-only |
| [0403](../adr/adr-0403-stripe-billing-and-uk-vat.md) | Stripe billing, webhook reconciliation, UK VAT approach, consumer cancellation consent |
| [0404](../adr/adr-0404-lucy-ai-gateway.md) | Lucy AI gateway: server-owned routing by tier, allowance ledger, spend guards, settings split per mode |
| [0405](../adr/adr-0405-licence-register-and-s-key-replacement.md) | Model and dependency licence register; replace S-KEY for commercial use |
| [0406](../adr/adr-0406-lyrics-in-cloud-mode.md) | Lyrics in cloud mode |
| [0407](../adr/adr-0407-realtime-updates-sse.md) | Real-time updates via SSE with polling fallback |
| [0408](../adr/adr-0408-admin-console-v1.md) | Admin console v1 scope; read and command path separation |
| [0409](../adr/adr-0409-hosting-topology-and-environments.md) | Hosting topology, regions, environments, IaC and deploys |
| [0410](../adr/adr-0410-observability-slos-and-emergency-controls.md) | Observability, SLOs, alerts, emergency controls and incident process |
| [0411](../adr/adr-0411-stress-chaos-and-release-gates.md) | Stress, chaos and release-gate testing programme; Linux CI for the cloud path |
| [0412](../adr/adr-0412-privacy-retention-and-deletion.md) | Privacy, retention, deletion ledger and data export |
| [0413](../adr/adr-0413-copyright-takedown-and-repeat-infringers.md) | Copyright terms, takedown and repeat-infringer policy |
| [0414](../adr/adr-0414-feature-flag-targeting-in-cloud-mode.md) | Feature-flag targeting in cloud mode: layered decisions (build, mode, plan, rules), contexts, kill switches, rollouts, admin Flags page; extends ADR-0390 and reverses its "no switch page" for cloud mode only |
| [0415](../adr/adr-0415-playback-devices-and-sessions.md) | Playback devices: one playback session per account, device lease, remotes, transfer, offline speaker rules |
| [0416](../adr/adr-0416-rooms-guest-requests.md) | Rooms: Premium guest requests by QR code, guest identity, moderation, display pairing, no audio to guests |

---

[← 16-edge-cases.md](16-edge-cases.md) · [Contents](README.md#chapters) · [sources.md →](sources.md)
