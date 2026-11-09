# Engineering guide

This guide is the starting point for anyone changing Selecta. It covers the working local
application today and the accepted Selecta Cloud design separately. The Cloud proposal is a
design programme: the presence of a package or directory with a future-oriented name does not by
itself mean that cloud behavior is wired into the running app.

## Start here

1. Read the root [README](../../README.md) and [acceptance notes](../acceptance.md) to understand
   what Selecta currently does and what remains under evaluation.
2. Read [the architecture proposal](../saas/README.md) before changing anything that affects
   Cloud. It is the navigation page for the queue, storage, identity, billing, devices, Rooms,
   flags, operations and implementation roadmap.
3. Find the relevant decision in [the ADR index](../adr/README.md). An accepted ADR records an
   intended contract; its checklist and implementation evidence show whether code and independent
   verification exist yet.
4. Keep changes focused. Preserve local mode behavior unless the task explicitly changes it, and
   record cross-cutting contract changes in an ADR.

## Current application map

| Area | Current location | Responsibility |
|---|---|---|
| Python application | `src/selecta/` | FastAPI server, local data, library, analysis, planning, rendering and CLI |
| Cloud API bootstrap | `src/selecta/api_cloud.py` | Cloud readiness, account onboarding, account entitlements and session revocation |
| Shared Cloud schema | `src/selecta/persistence/` | SQLAlchemy metadata, Alembic revisions and database operations |
| Web application | `web/src/` | React and TypeScript UI, state, playback and feature surfaces |
| Python tests | `tests/` | API, domain, audio, persistence and worker behavior |
| Web tests | `web/src/` and `web/e2e/` | Component/state tests and browser workflows |
| Decisions and evidence | `docs/adr/` | ADRs, programmes, checklists, verification matrices and status evidence |
| SaaS design | `docs/saas/` | Cloud architecture proposal, not a runtime specification by implication |

The local application is single-user and runs on the user's machine. Its local database and audio
files live outside the checkout. Keep that boundary clear: never put a real music library, secrets,
or generated user data into the repository.

The accepted Cloud design adds two runtime modes in one codebase. The Cloud path is not complete
until its ADR checklists have implementation and verification evidence. When in doubt, inspect the
actual route, caller, tests and ADR status rather than inferring behavior from a module name.

The branch has a working Cloud API foundation, but it is not a complete SaaS product. It supports
readiness, account onboarding, Free storage initialization, account/entitlement reads, targeted
feature snapshots, Labs opt-ins, sign-out-everywhere, Stripe Checkout and portal sessions, and a
signature-verified webhook receiver. Checkout prices are selected from `SELECTA_STRIPE_PRICES`; the
client cannot choose a Stripe price id. The webhook stores events idempotently and re-fetches Stripe
state before applying entitlements and storage limits. Cloud uploads use workspace-scoped multipart
sessions, plan limits and atomic quota reservations, with server-side metadata validation and
acceptance. The authenticated Cloud asset API lists, reads and soft-deletes workspace assets. The web
app selects Cloud mode from API status and has WorkOS sign-in, onboarding, account, plan, billing,
upload, private library and original audio preview screens. The standalone `selecta gateway` process authenticates workers, claims fenced jobs,
and signs scoped R2 URLs; `RemoteWorkerClient` and the cooperative runner handle scoped tokens,
leases, progress and signed input/output transfer, but worker images and Cloud audio handlers are
still needed. Cloud `/api/events` streams job outbox
updates; the UI is not yet consuming it. `DELETE /api/account` hides accounts and revokes sessions
immediately, then enqueues a durable retryable workflow. Its effect adapter handles job/Stripe
cancellation, membership cleanup and account tombstones; the offsite ledger writer, scheduled
workflow and R2 purge runners, and restore replay remain outstanding. Full Cloud mixing,
scheduled billing reconciliation/webhook retries and Stripe tax setup also remain incomplete. Schema
migrations are exercised on SQLite; production PostgreSQL and row-level security still need
implementation and verification.

## Set up and run locally

Install Python dependencies with `uv`, web dependencies with `pnpm`, and make sure `ffmpeg` is on
`PATH`. The repository targets Python 3.12. On Windows, double-click `dev.cmd` or run it from a
terminal; it starts the API and web development server. Set `SELECTA_HOME` to a disposable data
directory before launching if you want to keep development data separate from your normal library.

Useful commands from the repository root:

```powershell
uv sync
cd web
pnpm install
pnpm build
cd ..
dev.cmd
```

`dev.cmd test` runs the repository's standard checks. Individual checks are:

```powershell
uv run pytest
uv run ruff check src tests
cd web
pnpm test
pnpm build
pnpm e2e
pnpm e2e:flags
```

To run the Cloud API locally, set `SELECTA_MODE=cloud` and configure
`SELECTA_DATABASE_URL`, `SELECTA_WORKOS_CLIENT_ID`, `SELECTA_AUTH_ISSUER`,
`SELECTA_AUTH_AUDIENCE`, `SELECTA_ALLOWED_HOSTS`, and `SELECTA_ALLOWED_ORIGINS`. Apply migrations
with `uv run selecta db upgrade`, then run `uv run selecta web --no-open`. Cloud mode binds to
`0.0.0.0` by default for container hosting and serves the API only; the React app is hosted
separately. Keep local development on the default `SELECTA_MODE=local` unless you have a disposable
Cloud test database and AuthKit test credentials.

Deploy the worker gateway as its own process with `uv run selecta gateway`. Set
`SELECTA_GATEWAY_DATABASE_URL` or `SELECTA_DATABASE_URL`, `SELECTA_GATEWAY_ALLOWED_HOSTS`,
`SELECTA_WORKER_TOKEN_SECRET`, and `SELECTA_WORKER_BOOTSTRAP_TOKEN`; configure the shared R2
environment for object URL signing. The gateway refuses wildcard host allowlists and short secrets.
Run `uv run selecta billing-maintenance` from a scheduled Cloud maintenance process to drain stored
Stripe webhook events; use `uv run selecta billing-maintenance --reconcile` for the slower full
subscription sweep. The repository provides the command, but deployment scheduling remains an
operations task.

Schedule `uv run selecta account-deletion-maintenance` with `SELECTA_WORKOS_API_KEY`,
`SELECTA_STRIPE_SECRET_KEY`, `SELECTA_R2_BUCKET_DELETION_LEDGER` (a dedicated private bucket), and
the Cloud PostgreSQL/R2 settings to advance account deletion. Schedule
`uv run selecta storage-maintenance` to purge due storage tombstones after their recovery window.
These maintenance commands require an appropriately privileged database role; the restore replay
helper `uv run selecta replay-deletions-after-restore` must run successfully before customer
traffic is reopened after a database restore. Keep the restored API and workers out of service
until storage tombstones are re-applied and account workflows are requeued.

The Cloud web build also needs `VITE_SELECTA_API_ORIGIN` when the API is hosted on another origin,
`VITE_WORKOS_CLIENT_ID`, and `VITE_CHECKOUT_CONSENT_VERSION`. The API needs Stripe settings described
in [billing](../saas/08-billing.md#current-api-implementation) and R2 settings described in
[uploads](../saas/05-storage-uploads-playback.md#current-api-implementation). Configure the R2
bucket's CORS policy to allow the Cloud web origin to `PUT` signed upload parts.

Browser tests run against synthetic data and are muted; they should not need a personal music
library. Do not run stress, destructive recovery or real-account flows against production services.

## Make a change

Before editing, trace the feature through its UI entry, API route, domain/service function, storage
and background work. For an audio change, also trace its planning/rendering path and listen to the
result when the acceptance contract requires it. Prefer small domain modules over a new all-purpose
service. Keep API response and error behavior deliberate, and update the relevant tests and docs
with the behavior change.

For any change that affects an ADR contract:

- Update the ADR checklist only when the stated acceptance criteria are met.
- Link implementation evidence to concrete files, commits or CI runs.
- Keep independent verification separate from implementation status.
- Do not describe a proposal, stub, smoke check or passing unit test as a complete release gate.

Every repository file must remain below 1,000 lines; `tests/test_file_length.py` enforces this.
Split large material by responsibility before it approaches that limit.

## Feature flags

The existing local feature flag system is implemented in `src/selecta/flags/`. The JSON files are
the registry; `docs/flags.md` is generated from them. Flags are developer controls, read when the
process starts. There is no local user-facing flag administration page.

When adding or changing a feature:

1. Find its owning flag and dependencies in `src/selecta/flags/*.json`.
2. Add or update its ownership metadata (routes, CLI commands and UI surfaces) in the registry.
3. Enforce the flag at the feature's entry points, including background work where relevant; hiding
   a button alone does not disable a feature.
4. Make the UI disappear cleanly when disabled, including navigation, tabs, shortcuts and empty
   layout space.
5. Regenerate the catalogue with `uv run selecta flags --markdown docs/flags.md` and run the flag
   tests and browser sweep (`uv run pytest tests/test_flags.py tests/test_flag_server.py`; from
   `web/`, `pnpm e2e:flags`).

Cloud targeting is a separate layer described in [§11B](../saas/11b-feature-flags.md). It must
compose with the existing registry, mode and plan entitlements. Flags may disable or roll out an
entitled capability; they must not grant a paid entitlement. The proposal's staff roles, targeting
rules and Cloud Flags page are not implied by the local developer flag controls.

## Cloud implementation guardrails

Use the accepted [proposal](../saas/README.md) and its [roadmap](../saas/17-roadmap-and-risks.md)
to sequence Cloud work. The core contracts are:

- Keep local mode's privacy and single-user guarantees intact.
- Persist accepted work durably; retries, cancellation and worker loss must have explicit states.
- Enforce workspace ownership at every API, storage and worker boundary.
- Make quota reservations and billing entitlements authoritative on the server.
- Bound processing and AI spend; do not trust client-supplied plan or priority values.
- Use leases and fencing so stale workers cannot publish results.
- Treat user uploads and generated artifacts as private, tenant-scoped data with deletion paths.
- Put every new Cloud feature behind its registry flag and enforce it in the API, job claim path
  and UI as applicable.
- Keep staff permissions, audit records and emergency controls distinct from feature availability.
- Treat Rooms as guest request access; guests do not receive audio or account access.

These are design constraints, not claims that Cloud is already production-ready. Read the matching
chapter and ADR before implementing a subsystem; update its acceptance evidence as the work lands.

## Working safely with data and services

- Use synthetic fixtures and disposable local data for development and tests.
- Never commit credentials, signed URLs, personal data, uploaded audio or generated media.
- Keep external service calls behind replaceable interfaces and use fakes in unit tests.
- For future Cloud integration tests, use isolated test databases and object storage; do not point
  test cleanup at a shared or production account.
- Keep logs useful for diagnosis while excluding audio contents, tokens, secrets and unnecessary
  personal information.
- Do not perform actions on customer accounts or send messages to users as part of routine code
  changes.

## Review checklist

Before handing off a change, check that:

- The user-visible behavior and failure states are clear.
- Local behavior remains intact where the change is Cloud-only.
- Server-side authorization and feature gates cover the same capability as the UI.
- Retries, duplicate requests, cancellation and partial failure have been considered for async work.
- Tests cover the changed contract and no personal data is required to run them.
- Generated docs, links and ADR evidence are current.
- New files are under the 1,000-line limit.

## Further reading

- [Selecta Cloud proposal](../saas/README.md)
- [Feature flag catalogue](../flags.md)
- [ADR index and implementation programmes](../adr/README.md)
- [Acceptance notes](../acceptance.md)
- [Development and verification instructions](../../README.md#working-on-selecta)
