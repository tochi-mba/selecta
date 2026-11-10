# ADR-0393 - PostgreSQL system of record, Alembic migrations and workspace tenancy

- **Decision:** Accepted (owner, 2026-11-09).
- **Implementation:** 3/5 Implemented; 1/5 In progress; 1/5 Not started.
- **Independent verification:** 0/5 Verified.
- **Programme/date/baseline:** Selecta Cloud (SC); 2026-11-09; main `3c2f1eb`.
- **Priority / phase:** P0 / Phase 1. **Owner:** Unassigned. **Implementing PR/SHA:** None yet.
- **Existing ADR owners:** ADR-0338 (staged rollout and data migration); their statuses are unchanged.
- **Source touchpoints:** `src/selecta/db.py`; every route module in `src/selecta/routes/`; `src/selecta/lucy/schema.py`; `src/selecta/backup.py`; new `src/selecta/persistence/`, `migrations/`.
- **Proposal chapter:** [docs/saas/06-data-model.md](../saas/06-data-model.md#61-approach).

## Context and evidence boundary

SQLite runs its whole schema on every connect, migrations are ad hoc `ALTER TABLE`s with no version table, some modules create tables lazily, and songs are keyed by absolute file paths. A multi-tenant service needs real migrations, tenant scoping and a server database.

The branch registers 50 SaaS table declarations and contains four Alembic revisions, including the Stripe workspace-customer mapping. SQLite upgrade, metadata comparison and rollback are covered while preserving the legacy `songs` table. PostgreSQL migration execution, tenant query enforcement and RLS remain incomplete.

## Decision

- PostgreSQL is the system of record in cloud mode; SQLite remains in local mode.
- SQLAlchemy Core and Alembic define one schema for both; raw SQL moves into repository functions module by module.
- Every tenant-owned table gets `workspace_id` (the single local workspace in local mode).
- Postgres Row-Level Security on tenant tables as defence in depth; the app role has no `BYPASSRLS`; admin and maintenance use separate roles.
- Every tenant query runs in an explicit transaction that sets the workspace with `set_config('app.workspace_id', …, true)` (transaction-scoped, safe through a transaction-mode pooler). Request traffic goes through PgBouncer; `LISTEN` and session advisory locks use dedicated direct connections, within a planned connection budget.
- Large feature arrays stay as `.npz` objects in storage; Postgres holds summaries and pointers.

## User outcome and acceptance contract

Local libraries upgrade in place with an automatic backup first; cloud data is isolated per workspace by both the application and the database.

## Rejected alternatives

- An ORM with models everywhere (large rewrite, little gain).
- Keeping SQLite in cloud (no concurrent writers across instances).

## Implementation checklist - 1/5 Implemented; 0/5 independently Verified

1. **SC-0393-01 - Alembic baseline.** **Acceptance:** Baseline migration reproduces today's schema on SQLite and Postgres. **Required verification:** Migration up/down test on both. **Implementation:** In progress; 50 SaaS tables are declared in four revisions and SQLite upgrade/compare/rollback coverage exists; PostgreSQL remains unverified. **Independently Verified:** No.
2. **SC-0393-02 - workspace_id everywhere.** **Acceptance:** All tenant tables carry `workspace_id`; queries go through repositories that require it. **Required verification:** Static check plus cross-tenant suite. **Implementation:** Implemented; every table is tenant data with a non-null, indexed `workspace_id` of one id type, or named as global or mixed with a reason; the static check found and fixed a missing index on `dangerous_actions.workspace_id` (migration `d41a6b2e9c07`). **Evidence:** `tests/test_cloud_workspace_columns.py` (5 tests) plus the cross-tenant matrix `tests/test_cloud_tenant_isolation.py` and `tests/test_cloud_rls.py`, passing on SQLite and PostgreSQL. **Independently Verified:** No.
3. **SC-0393-03 - RLS policies.** **Acceptance:** Postgres policies deny rows from other workspaces even if a query forgets the filter. **Required verification:** Integration test with a deliberately unscoped query. **Implementation:** Implemented; every tenant table has forced row-level security with one `workspace_isolation` policy (migrations `b7e3c91f0a24`, `c5f08d3a71e2`); the only extra policy is a read-only scheduler policy on `fair_heads` (counters keyed by workspace id, read only by `work/`), documented in docs/saas/06-data-model.md 6.1.1; every PostgreSQL test runs as a role the policies bind. **Evidence:** `tests/test_cloud_rls.py`, including deliberately unscoped reads, updates and deletes that spare other workspaces, passing on PostgreSQL. **Independently Verified:** No.
4. **SC-0393-04 - Local upgrade with backup.** **Acceptance:** First start after upgrade backs up the SQLite file, then migrates. **Required verification:** Upgrade test from a copy of a real local database. **Implementation:** Not started; **Independently Verified:** No.
5. **SC-0393-05 - Lazy tables removed.** **Acceptance:** No module creates tables at runtime. **Required verification:** Grep check in CI. **Implementation:** Implemented. **Evidence:** `tests/test_cloud_no_lazy_tables.py`; focused run: 7 passed. **Independently Verified:** No.

## Governance

Accepted by the owner on 2026-11-09. Older ADRs keep their statuses; this one only links to them.
