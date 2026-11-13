*Part of the [Selecta Cloud proposal](README.md). Accepted by the owner on 2026-11-09.*

> **Local-first architecture supersession (accepted 2026-11-13; implementation not started).** Keep PostgreSQL tenant isolation, subscriptions, audit and immutable metadata; replace hosted asset/object references with workspace-scoped canonical track IDs and device-private file bindings. Existing schema is historical and must be migrated, not erased without backfill. See [ADR-0458](../adr/adr-0458-canonical-recording-identity-and-local-media-bindings.md) and [migration model](../adr/selecta-local-first-data-migration.md). Historical plan details and past implementation evidence below are retained; this documentation PR does not change running software.


## 6. Data model

### 6.1 Approach

- **SQLAlchemy Core + Alembic**, one schema definition targeting both SQLite (local) and Postgres (cloud). Raw SQL in routes is migrated module by module to repository functions; dialect differences (JSON, upsert, placeholders) live in one place.
- **Every tenant-owned table gets `workspace_id`**. In local mode it is always the single local workspace, so local behaviour doesn't change.
- **Postgres Row-Level Security** on tenant tables as defence in depth (see 6.1.1).
- **Large arrays stay out of Postgres**: per-song features remain `.npz` objects in R2; Postgres holds summaries and pointers.

#### 6.1.1 Row-level security as built

- **Which tables.** Every table on the shared metadata with a `workspace_id` column has row-level security enabled and forced, with one policy, `workspace_isolation`, for reads and writes alike (migrations `b7e3c91f0a24` and `c5f08d3a71e2`). Global tables (people, staff, providers' webhook inboxes, platform configuration, the worker fleet) have none; each is named with its reason in `tests/test_cloud_workspace_columns.py`. Four tables allow an empty `workspace_id` for platform rows (`audit_events`, `dangerous_actions`, `display_pairings`, `outbox_events`).
- **The rule.** `persistence.transaction(engine, workspace_id)` sets `app.workspace_id` for that transaction only (`set_config(..., true)`, safe through a transaction-mode pooler). While it is set, a row is visible, and can be written, only if its `workspace_id` equals it. So a query that forgets `WHERE workspace_id = ...` still sees only its own workspace, an unfiltered `UPDATE` or `DELETE` touches only its own rows, and inserting or moving a row into another workspace fails with `42501`. Rows with an empty `workspace_id` are invisible to a workspace transaction.
- **One read-only exception: `fair_heads`.** The scheduler's index (per pool, lane and workspace: a virtual time and queue counters, no customer content) has a second policy, `scheduler_reads_across_workspaces`, for `SELECT` only. Enqueueing places a workspace's work relative to the smallest active virtual time, and admission sums the pool's backlog, inside that workspace's transaction and under the lane locks; moving those reads to a separate transaction would lose the fairness guarantees. Writes to `fair_heads` stay held to the workspace. `tests/test_cloud_rls.py` fails if any other extra policy appears.
- **System transactions.** A transaction that names no workspace (`transaction(engine)`, or a plain connection) leaves the setting empty, and the policy lets it through. This is how maintenance, the scheduler's claims, webhooks, sign-in and staff tools cross workspaces today; they all run through the same database role as the API. `transaction(engine, "")` is refused, so an empty id can never widen a workspace transaction into a system one.
- **Roles.** No role needs `BYPASSRLS`, and none is given it. `FORCE ROW LEVEL SECURITY` makes the policy bind the table owner too, so the migration role, the app role and the test suite all run under one rule. The audit table additionally has its own append-only grants (`authz.audit.append_only_sql`).
- **The limit, on purpose.** The database guarantees isolation for workspace transactions, not for system ones: code that should have named a workspace and didn't is caught by the repository functions' filters and the tenant isolation matrix, not by the database. Splitting system work onto a separate role, with the app role refused rows outside a named workspace, needs the API's cross-workspace paths (sign-in, webhooks, onboarding) moved behind that role first; it is not built.
- **Tests.** `tests/test_cloud_rls.py` proves the rule on PostgreSQL with deliberately unfiltered queries, and fails when a new tenant table lacks the policy. The PostgreSQL test fixture connects as a schema owner that is neither a superuser nor `BYPASSRLS` (superusers skip every policy, forced or not), so the whole cloud suite runs with the policies in force.

### 6.2 Tables by domain

| Domain | Tables |
|---|---|
| Identity & tenancy | `users`, `workspaces`, `workspace_members`, `sessions_revocations` |
| Staff & authorization | `staff_roles`, `role_assignments`, `access_grants`, `approval_requests`, `privileged_sessions` |
| Plans & billing | `plans` (versioned catalogue), `subscriptions`, `entitlement_snapshots`, `stripe_events`, `entitlement_overrides` |
| Usage | `usage_ledger` (append-only: storage deltas, compute seconds, AI tokens/cost), `usage_daily` rollups, `quota_state` |
| Library | `assets`, `songs` (today's table + `workspace_id`, `asset_id` replaces `path` in cloud), `analysis`, `lyrics`, `song_overrides`, `preferences`, `ratings` |
| Uploads | `upload_sessions`, `storage_reservations` |
| Mixes | `mixes`, `mix_revisions` (immutable), `queue` (current mix order, as today), `drafts`, `seam_book`, `pair_book` |
| Requests & discovery | `song_requests` (+ existing request tables), `discovery_comparisons` |
| Jobs | `jobs`, `job_dependencies`, `job_attempts`, `fair_heads`, `lane_clock`, `workers`, `artifacts`, `jobs_history` (partitioned) |
| Lucy | existing 12 `lucy_*` tables + `workspace_id`; `ai_runs`, `ai_usage`, `model_deployments`, `model_routing_versions` |
| Devices & playback | `devices`, `playback_sessions` (one per account: revision, position anchor, state, active device, lease, sequence), `playback_commands` (short retention) |
| Rooms | `rooms` (code hash, settings, status, expiry), `room_guests`, `room_requests` (links to `song_requests`), `room_votes`, `room_bans`, `display_pairings` |
| Feature flags | `flag_rules`, `flag_rule_versions` (immutable, audited), `flag_previews` (staff self-preview), `experiment_exposures`; the flag registry itself stays in the JSON files |
| Platform | `outbox_events`, `idempotency_keys`, `audit_events` (append-only, separate role), `config_versions`, `deletions`, `notifications` |

### 6.3 Migration of existing local data

Local users keep their SQLite file; Alembic upgrades it in place (with an automatic backup first, reusing `backup.py`).

**Built for the local schema.** The local app keeps its own hand-made SQLite schema (`db.SCHEMA` and the start-up steps in `db.connect` that add columns and move old rows). Each library file records the local schema it is on in SQLite's `user_version`. The first time a newer Selecta opens an older library, `local_upgrade.backup_before_migrating` copies the file (SQLite's online backup, so the WAL is included) to `upgrade-backups/` beside it and checks the copy's integrity, and only then do the start-up steps change it; if the copy fails, the file is left untouched and the start stops. The last five copies are kept. Flag: `core.upgrade_backup`. Test: `tests/test_local_upgrade.py`, from a library built with the schema of commit 7b51a70.

The shared Alembic migrations still don't run on local files (`selecta db upgrade` refuses anything but PostgreSQL): that would add the shared tables and an `alembic_version` table to every local library, so it waits for the local modules to move onto the shared schema, and will reuse this backup step when it does.

A one-way "move my local library to Selecta Cloud" tool is a later feature (it would upload files through the normal pipeline, not copy databases).

---

[← 05-storage-uploads-playback.md](05-storage-uploads-playback.md) · [Contents](README.md#chapters) · [07-identity-rbac-admin.md →](07-identity-rbac-admin.md)
