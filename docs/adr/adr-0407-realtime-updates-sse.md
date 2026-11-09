# ADR-0407 - Real-time updates over server-sent events

- **Decision:** Accepted (owner, 2026-11-09).
- **Implementation:** 0/4 Implemented; 1/4 In progress; 3/4 Not started.
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

## Implementation checklist - 0/4 Implemented; 0/4 independently Verified

1. **SC-0407-01 - Event stream.** **Acceptance:** Events arrive in order with ids; reconnect resumes without gaps. **Required verification:** Integration test. **Implementation:** In progress; `/api/events` emits ordered workspace job-outbox events, resumes from `Last-Event-ID`, and stops when the token expires or the client disconnects. Other event families and integration verification remain; **Independently Verified:** No.
2. **SC-0407-02 - Fan-out.** **Acceptance:** An event raised on one instance reaches clients on every instance. **Required verification:** Multi-instance test. **Implementation:** Not started; **Independently Verified:** No.
3. **SC-0407-03 - Fallback.** **Acceptance:** With the stream blocked, polling keeps pages correct. **Required verification:** Playwright test. **Implementation:** Not started; **Independently Verified:** No.
4. **SC-0407-04 - Load.** **Acceptance:** SSE connection counts meet the L3 targets. **Required verification:** k6 test. **Implementation:** Not started; **Independently Verified:** No.

## Governance

Accepted by the owner on 2026-11-09. Older ADRs keep their statuses; this one only links to them.
