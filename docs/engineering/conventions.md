# Conventions

The rules every change follows. Most are enforced by CI; the rest by review. If a rule gets in your way, change it in the open (an ADR or a PR that edits this page), not quietly in one place.

## Database

- **One schema for both databases.** Declare tables with SQLAlchemy Core on `selecta.persistence.metadata`, in the owning package's `schema.py`, and register that module in `persistence/registry.py`.
- **Every schema change has a migration.** Generate it, rewrite it in the house style, and check `migrate.pending_changes()` is empty at head ([recipe](how-to.md#add-or-change-a-table)). CI fails when the tables and migrations disagree.
- **Migrations never touch the original local tables** (`songs`, `analysis`, `queue`, `lucy_*`, ...). They aren't on the shared metadata, and `registry.include_object` keeps Alembic away from them.
- **Tenant data has `workspace_id`**, non-null and indexed. Queries filter by it; on PostgreSQL row-level security backs that up.
- **Writes happen inside `persistence.transaction(engine, workspace_id)`.** It commits or rolls back as one, and sets the row-level-security workspace on PostgreSQL.
- **Locks.** `persistence.lock_rows()` is `FOR UPDATE SKIP LOCKED`: right for "take the next free thing" (job claims), wrong for "this exact row" (a quota, a session), where a skipped row looks missing. Use a waiting `with_for_update()` there, and say why in a comment.
- **Ids** are `persistence.new_id()` (time-ordered UUIDv7 strings).
- **Times that get compared** (leases, expiries, deadlines) are epoch seconds from `persistence.db_now(conn)`: the database's clock on PostgreSQL, `persistence.wall_clock()` on SQLite. Never compare against a worker's or client's clock.

## Feature flags

Every feature has a registry flag, and the flag is enforced everywhere the feature lives:
- the routes it owns are listed on the flag (a test fails on any unowned `/api` route, in either app);
- the job types it owns name it, and are refused at claim;
- the site closes up around it (the reflow sweep checks this);
- background work stops at its source.

Core flags can't be switched off, and are core only in the modes they exist in. Cloud features live in `flags/cloud.json` with `"modes": ["cloud"]`. Regenerate `docs/flags.md` whenever a flag file changes. Full rules: [§11B](../saas/11b-feature-flags.md).

## Errors and API answers

- Refusals carry a stable machine `code` and a plain sentence (`{"code": "plan_required", "message": "..."}`), so the site can show the right thing.
- A feature that's off is 403 `flag_off`, never 404 (the site reads 404 as "older server").
- Auth refusals use the codes in [§7A.3](../saas/07a-authentication.md#7a3-what-the-server-checks-on-every-request).
- Retryable outside failures (rate limits, 5xx) are typed as retryable; callers decide whether to retry.

## Secrets and personal data

- Never log or put in an exception: tokens, API keys, signed URLs, webhook secrets, room codes, guest tokens, prompts or lyrics. Audit metadata is scrubbed by `authz.audit.scrub`. Tests check logs with `caplog`.
- Secrets come from the environment or the host's secret store; nothing secret is committed.
- Never commit real music, user data or generated media. Tests use synthetic data.

## Code style

- Python 3.12, `from __future__ import annotations`, type hints, dataclasses and enums.
- Ruff with line length 100 (`E,F,I,UP,B`). CI runs `ruff check .`.
- **No file over 1,000 lines**, docs included (`tests/test_file_length.py`). Aim for modules under 500.
- Docstrings and comments in plain English: what something is for and why, in short sentences. Match the voice of `selecta/persistence/__init__.py`.
- **No em dashes** in code, comments, docs or commit messages. Use a hyphen or rephrase.
- Prefer a small module with one job over a large service.

## Git

- Branch off `main`; never push to `main` directly. Auto-merge is off: a person merges once CI is green.
- Commit and push work in progress often, so nothing lives only on one machine.
- Commit messages say what changed and why, in plain sentences.
