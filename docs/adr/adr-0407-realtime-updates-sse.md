# ADR-0407 - Real-time updates over server-sent events

- **Decision:** Accepted (owner, 2026-11-09).
- **Implementation:** 3/4 Implemented; 1/4 In progress; 0/4 Not started.
- **Independent verification:** 0/4 Verified.
- **Programme/date/baseline:** Selecta Cloud (SC); 2026-11-09; main `3c2f1eb`.
- **Priority / phase:** P1 / Phase 6. **Owner:** Unassigned. **Implementing PR/SHA:** None yet.
- **Existing ADR owners:** ADR-0394 (outbox); their statuses are unchanged.
- **Source touchpoints:** `web/src/ui/useVisiblePoll.ts`; `web/src/state/jobs.ts`; `web/src/lucy/stream.ts`; `web/src/App.tsx`; new `/api/events`.
- **Proposal chapter:** [docs/saas/11-ui-ux.md](../saas/11-ui-ux.md#113-real-time-updates).

## Context and evidence boundary

The site polls many endpoints every 1.5–5 seconds. At a thousand online users that is hundreds of mostly-unchanged requests per second, and multi-device playback needs pushed state.

The first workspace-scoped `/api/events` endpoint reads the durable job outbox and resumes from `Last-Event-ID`. It currently polls the outbox and streams job events only; Postgres listener fan-out, other event families, browser integration and load measurements remain outstanding.

## Decision

- One server-sent events stream per signed-in tab (`/api/events`) carrying job, upload, entitlement, flag, playback and Lucy events.
- Heartbeat comments every 20 s; resume with `Last-Event-ID`; fan-out across API instances via Postgres `LISTEN/NOTIFY` from the outbox on one direct (non-pooled) connection per instance, catching up by event id after any gap.
- Existing polling stays as the fallback when the stream drops.

## User outcome and acceptance contract

Pages update within a second of real changes, with far less load, and keep working when a proxy cuts the stream.

## Rejected alternatives

- WebSockets at launch (more infrastructure, little gain for one-way updates).
- Polling only.

## Implementation checklist - 3/4 Implemented; 0/4 independently Verified

1. **SC-0407-01 - Event stream.** **Acceptance:** Events arrive in order with ids; reconnect resumes without gaps. **Required verification:** Integration test. **Implementation:** Implemented; the stream sends each workspace's outbox events in commit order with their ids and resumes after `Last-Event-ID`; events carry a commit-order number stamped at commit (migration `7c1e9a4b2f30`), which fixed a real gap where a transaction holding a lower id committed after a reader had passed a higher one. **Evidence:** `tests/test_cloud_outbox_order.py` (in order with ids, resume without gaps, the late-commit case, 200 racing writers with a reader alongside), passing on SQLite and PostgreSQL. **Independently Verified:** No.
2. **SC-0407-02 - Fan-out.** **Acceptance:** An event raised on one instance reaches clients on every instance. **Required verification:** Multi-instance test. **Implementation:** Implemented; outbox writes `pg_notify` on commit and every API instance listens, so an event committed on one instance reaches streams on every other at once, and never another workspace's. **Evidence:** `tests/test_cloud_fanout.py` (instance A to a stream on instance B in under a second; B never hears another workspace), passing on PostgreSQL. **Independently Verified:** No.
3. **SC-0407-03 - Fallback.** **Acceptance:** With the stream blocked, polling keeps pages correct. **Required verification:** Playwright test. **Implementation:** Implemented; with the event stream blocked the Cloud site falls back to polling and stays correct. **Evidence:** `web/e2e-cloud/live.cloud.ts` 'with the event stream blocked, the page falls back to polling and stays correct', passing in `pnpm e2e:cloud`. **Independently Verified:** No.
4. **SC-0407-04 - Load.** **Acceptance:** SSE connection counts meet the L3 targets. **Required verification:** k6 test. **Implementation:** In progress; the k6 script `tests/load/sse_connections.js` ramps to 10,000 concurrent `/api/events` streams (L3: 10,000 active users, one stream per tab) with routine reads alongside, and fails unless 95% of streams get their first frame within 25 s, 99% stay open for the hold and routine p95 stays under 300 ms. `python infra/staging/run.py sse` is the one command (inputs listed in `infra/staging/README.md`; it refuses missing inputs and non-staging URLs). (added 2026-11-12) The Rooms fan-out run is scripted too: `tests/load/room_fanout.py` opens 500 rooms (one per Premium host) with 100 `/api/events` listeners each (docs/saas/15-stress-testing.md line 84), locks and unlocks the rooms at a set rate and fails unless every listener's fan-out p99 is within 1 s (this ADR's line 26, 'Pages update within a second') and no event is dropped (15-stress-testing.md line 76), printing p50/p95/p99 and writing JSON; `python infra/staging/run.py room-fanout` is its one command (`STAGING_BASE_URL`, `HOST_TOKENS_TXT`); `python tests/load/room_fanout.py smoke --port 9401` runs it locally at 5 rooms by 3 listeners against `tests/e2e_cloud_server.py` (2026-11-12: 60 of 60 events, 0 dropped, p50 1037.5 ms, p95 1948.9 ms, p99 2099.6 ms within the SQLite 2.5 s smoke budget, since SQLite polls every 2 s). Needs staging: a k6 build with xk6-sse, run against staging with synthetic users, `python infra/staging/run.py room-fanout` against staging, and both reports filed. **Evidence:** `tests/load/room_fanout.py`; `tests/test_room_fanout_load.py` (5 passed on 2026-11-12, including `test_a_small_smoke_run_passes_against_the_cloud_test_server`); `tests/load/sse_connections.js`; `tests/test_cloud_load_scripts.py` (6 passed on 2026-11-10); `infra/staging/run.py`; `infra/staging/README.md`; `tests/test_staging_runner.py` (22 passed on 2026-11-12, including `test_every_task_runs_files_that_exist_and_its_readme_row_names_every_input`). **Independently Verified:** No.

## Governance

Accepted by the owner on 2026-11-09. Older ADRs keep their statuses; this one only links to them.
