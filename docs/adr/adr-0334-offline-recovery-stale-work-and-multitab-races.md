# ADR-0334 — Offline/provider outage, crash recovery, stale revisions and multi-tab concurrency

- **Decision:** Accepted (owner approval recorded 2026-11-08; docs only, implementation pending).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Lucy agentic Make a Mix (LU); 2026-11-08; main `1b53debedc3d6ef3c8d0cf6302b561b0003e8d78`.
- **Priority / phase:** P0 / Reliability. **Owner:** Unassigned. **Implementing PR/SHA:** —.
- **Existing ADR owners:** ADR-0095, ADR-0232, ADR-0237, ADR-0255, ADR-0270, ADR-0297; unchanged.
- **Source touchpoints:** `src/selecta/api.py`; `src/selecta/db.py`; `web/src/App.tsx`; `web/src/state/async.ts`.

## Context and evidence boundary

Lost server responses, browser suspension and concurrent tabs make agent state appear uncertain. Durable writes must not be replayed to mask a connection error; stale results must never replace newer revisions. This ADR is a new proposal, not source implementation or independently proven usability/audio. Older implementation and verification histories remain unchanged.

## Proposed decision

Treat run lifecycle, event replay, proposal compare-and-swap and durable commit outcome as separate recovery protocols. Reconcile unknown writes by idempotency key; never assume failure means no effect. Preserve existing audio ownership on any Lucy/network failure.

## UI/UX and measurable acceptance contract

Clear 'reconnecting', 'still working', 'stopped', 'outcome unknown' and 'saved' states. Offer retry for safe reads only until write outcome is known; preserve composer text and proposal selection.

**Required negative cases:** Kill server between DB write/event emit, cache evicted mid-approval, token stream broken, device sleeps, two tabs approve same revision, draft deleted elsewhere, local server offline while remote model still reachable.

## Rejected shortcuts and dependencies

Never prioritise chatbot animation over audio continuity or fabricated estimates over measured truth. Reuse the existing Selecta app and WeftAI typed planning. Before implementing, reconcile related accepted ADRs against current source, tests and actual audio evidence; do not retrofit their historical statuses.

## Implementation checklist — 0/8 Implemented; 0/8 independently Verified

1. **LU-334-01 — Enumerate failure states.** **Acceptance:** Offline, provider down, run interrupted, partial read, unknown write and stale proposal distinct. **Required verification:** Fault taxonomy/state-machine test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
2. **LU-334-02 — Implement event replay recovery.** **Acceptance:** Reconnect after missed IDs rebuilds canonical cards/transcript once. **Required verification:** SSE gap/restart E2E. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
3. **LU-334-03 — Reconcile unknown commits.** **Acceptance:** Look up durable action outcome before retrying approval or replacing mix. **Required verification:** Kill-after-commit test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
4. **LU-334-04 — Use compare-and-swap on proposals.** **Acceptance:** Old generation cannot publish over later user edits or another tab. **Required verification:** High-concurrency revision test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
5. **LU-334-05 — Handle data invalidation.** **Acceptance:** Missing recording, changed analysis, evicted ready seam invalidate eligibility. **Required verification:** Stale library/cached audio tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
6. **LU-334-06 — Preserve active audio on failures.** **Acceptance:** Network/model errors do not play, pause, seek or change audio focus. **Required verification:** Real-audio outage test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
7. **LU-334-07 — Provide truthful recovery UI.** **Acceptance:** Retry, Resume, Keep current and Review change match actual safe operations. **Required verification:** Mobile/AT error task test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
8. **LU-334-08 — Verify migration/backup recovery.** **Acceptance:** Conversation histories and approvals consistent after app restore/version changes. **Required verification:** Schema migration and restore fixture. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.

## Preservation and release proof

Preserve originals, single audio owner/manual Pause, real current/draft/revision/seam/occurrence identity and scoped Undo, consented atomic bridges, Studio 8 lanes/8–64 cells, correct library and LRCLIB disclosure, neutral blind listening, frozen FLAC export. Test stale/offline/worker crashes, mobile/320px/400% zoom, keyboard/AT/RTL/forced colours/reduced motion and real audio as relevant.

## Governance

Decision Accepted and all eight LU tasks Not started/Not Verified. An implementing PR/test SHA and exact acceptance evidence are distinct from independent named reviewer/date/platform proof. [Roadmap](selecta-lucy-roadmap.md) · [checklist](selecta-lucy-implementation-checklist.md) · [evidence](selecta-lucy-implementation-evidence.md) · [verification](selecta-lucy-verification-matrix.md) · [release](selecta-lucy-release-gates.md).
