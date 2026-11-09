*Part of the [Selecta Cloud proposal](README.md). Accepted by the owner on 2026-11-09.*

## 6. Data model

### 6.1 Approach

- **SQLAlchemy Core + Alembic**, one schema definition targeting both SQLite (local) and Postgres (cloud). Raw SQL in routes is migrated module by module to repository functions; dialect differences (JSON, upsert, placeholders) live in one place.
- **Every tenant-owned table gets `workspace_id`**. In local mode it is always the single local workspace, so local behaviour doesn't change.
- **Postgres Row-Level Security** on tenant tables as defence in depth: the API sets `SET LOCAL app.workspace_id` per transaction from the verified session; the app role has no `BYPASSRLS`; admin and maintenance use separate roles and code paths.
- **Large arrays stay out of Postgres**: per-song features remain `.npz` objects in R2; Postgres holds summaries and pointers.

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

Local users keep their SQLite file; Alembic upgrades it in place (with an automatic backup first, reusing `backup.py`). A one-way "move my local library to Selecta Cloud" tool is a later feature (it would upload files through the normal pipeline, not copy databases).

---

[← 05-storage-uploads-playback.md](05-storage-uploads-playback.md) · [Contents](README.md#chapters) · [07-identity-rbac-admin.md →](07-identity-rbac-admin.md)
