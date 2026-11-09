# Architecture map

How the code is laid out, and how a request and a job travel through it. The full design, with its reasons, is in [docs/saas](../saas/README.md); this page is the map to keep open while coding. Start from the [engineering guide](README.md) if you haven't.

## Two runtime modes, one codebase

`SELECTA_MODE` picks the mode at start ([ADR-0392](../adr/adr-0392-two-runtime-modes.md)):

| | `local` (default) | `cloud` |
|---|---|---|
| App | `selecta.api:create_app` (`selecta web`) | `selecta.api_cloud:create_cloud_app`; workers talk to `selecta.gateway_cloud` (`selecta gateway`) |
| People | One, no sign-in | AuthKit accounts, personal workspaces, staff roles |
| Database | SQLite in `SELECTA_HOME` | PostgreSQL (`SELECTA_DATABASE_URL`) |
| Music | Folders on disk | Uploads to private R2 buckets |
| Work | In-process runner threads | Remote workers through the gateway |
| Flags | `SELECTA_FLAGS` and the JSON defaults | The same, plus targeting rules, plans and Labs opt-ins |

Local mode keeps every guarantee it had before the cloud work ([ADR-0391](../adr/adr-0391-selecta-cloud-goal-and-local-guarantees.md)).

## The packages

Everything lives in `src/selecta/`. The audio engine predates the cloud work and is shared by both modes; the cloud packages sit around it.

| Package | What it owns | Decision |
|---|---|---|
| `analysis/`, `render/`, `planner/`, `discovery/`, `lyrics/`, `seams.py`, `mix.py`, `stems.py` | The audio engine: analysis, mix planning, transitions, stems, exports | Earlier ADRs |
| `routes/`, `api.py`, `api_common.py` | The local app's FastAPI routes | Earlier ADRs |
| `api_cloud.py`, `gateway_cloud.py` | The cloud API app and the worker gateway app | ADR-0392, ADR-0396 |
| `lucy/` | Lucy, the mix assistant | ADR-0340 onwards |
| `flags/` | The flag registry (`*.json`), the route guard, and cloud targeting rules | ADR-0390, ADR-0414 |
| `persistence/` | One schema for SQLite and PostgreSQL, transactions, database time, ids, migrations | ADR-0393 |
| `modes/` | Local vs cloud, and picking the adapter for each | ADR-0392 |
| `work/` | Durable jobs: lifecycle, leases, fencing, dependencies, outbox, maintenance, the gateway API | ADR-0394, ADR-0396 |
| `scheduling/` | Who runs next: lanes, per-account fair share by plan, admission, the simulator | ADR-0395 |
| `workers/` | Runners that claim and execute jobs: in-process, and the remote gateway client | ADR-0394, ADR-0396 |
| `storage/` | Object keys, artifacts, the R2 client and SigV4, uploads, deletion | ADR-0397, ADR-0398, ADR-0412 |
| `usage/` | Usage ledger, storage quotas and reservations, allowances | ADR-0402 |
| `billing/` | Plan catalogue, Stripe client, webhooks, entitlement snapshots | ADR-0402, ADR-0403 |
| `identity/` | AuthKit tokens, users, workspaces, sessions, account deletion | ADR-0400, ADR-0412 |
| `authz/` | Permissions, staff roles, scopes, delayed dangerous actions, the audit log | ADR-0401 |
| `ai/` | The Lucy gateway: model routing per plan, allowances, spend guards, pinned runs | ADR-0404 |
| `playback/` | Devices and the one playback session per account | ADR-0415 |
| `rooms/` | Rooms: codes, guests, requests, votes, moderation, display pairing | ADR-0416 |

Packages talk across boundaries through small **ports** (Python `Protocol`s in each package's `ports.py`). `rooms` asks a `RequestPlannerPort` to plan a song rather than importing the planner; `storage.uploads` asks a `QuotaPort` to reserve bytes rather than importing `usage`. The app factories plug real implementations into those ports; tests plug in fakes.

## A cloud request, start to finish

1. **Edge**: Cloudflare terminates TLS, applies WAF and rate limits.
2. **Host and origin**: the app accepts only configured hosts; CORS only the app's origins.
3. **Feature flags**: `flags/guard.py` refuses a route whose owning flag is off for this request (403 `flag_off`) before the database is touched. Every cloud route must be owned by a flag; a test fails otherwise.
4. **Authentication**: the bearer token is checked by `identity.tokens` (RS256, issuer, expiry, JWKS), then the session and account checks in [§7A.3](../saas/07a-authentication.md#7a3-what-the-server-checks-on-every-request).
5. **Authorization**: customer routes check the workspace role; staff routes call `authz.check.authorize()`, which denies by default and audits.
6. **Work**: inside `persistence.transaction(engine, workspace_id)`, which also sets row-level security on PostgreSQL. Anything slow becomes a job.
7. **Response**, and an outbox event that reaches open pages over `/api/events` (SSE).

## A job, start to finish

1. A producer **enqueues** (idempotent: the same work twice is one job). Lane and urgency come from the server, never the client.
2. The job waits in its **pool** until its dependencies are done.
3. A worker **claims** it through the gateway: the scheduler picks the lane, then the account with the smallest virtual time (fair share weighted by plan), then the best job inside that account. The claim returns a **lease**, a **fencing token** and signed URLs for its inputs and outputs.
4. The worker runs the engine, **heart-beats** every 10 s, and stops at the engine's `check_in()` points if cancelled.
5. It uploads outputs under its own attempt prefix and calls **complete**. Only the current lease holder can publish; results are applied in the same transaction that marks the job done.
6. The **reaper** returns jobs whose leases expired, so a crashed worker never loses work.

In local mode the same tables live in SQLite and the workers are threads in the app.

## Where things are written down

| Question | Look in |
|---|---|
| Why is it built this way? | The ADR in the package table |
| What exactly should it do, including edge cases? | The matching [docs/saas](../saas/README.md) chapter |
| What must be tested? | [Test plan](../saas/18-test-plan.md) |
| Is it done, and what proves it? | [Implementation checklist](../adr/selecta-cloud-implementation-checklist.md) |
| Which features can be switched off? | [docs/flags.md](../flags.md) |
| How do I do X? | [How-to recipes](how-to.md) |
