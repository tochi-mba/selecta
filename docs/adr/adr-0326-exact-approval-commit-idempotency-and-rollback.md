# ADR-0326 — Exact revision approval, durable idempotent commit and reversible outcomes

- **Decision:** Proposed (owner review pending; documentation only).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Lucy agentic Make a Mix (LU); 2026-11-08; main `1b53debedc3d6ef3c8d0cf6302b561b0003e8d78`.
- **Priority / phase:** P0 / Permissions. **Owner:** Unassigned. **Implementing PR/SHA:** —.
- **Related existing ADRs:** ADR-0005, ADR-0095, ADR-0199, ADR-0219, ADR-0228, ADR-0237; statuses and scope unchanged.
- **Source touchpoints:** `src/selecta/api.py`; `src/selecta/mix.py`; `src/selecta/routes/mixes.py`; `src/selecta/db.py`.

## Context and source evidence boundary

Current vibe build can regenerate an order and optionally replace the current mix. Lucy must instead persist exactly the song order and seam intentions a user reviewed, without trusting a model-generated 'user approved' claim. Existing code is not credited as implementing new Lucy acceptance; revalidate at source SHA before work starts. This ADR defines a new feature proposal only.

## Proposed decision

Approval is a host-controlled, explicit user gesture bound to immutable proposal revision/hash, destination scope, expected library/mix state, authorised action and durable idempotency key. Atomic server-side preflight and commit create an exact draft; Build & play/replace require separate playback confirmation.

## UI/UX, interaction and truth contract

Confirmation displays exact revision, number of songs, whether playback changes and render consequence. Success appears only after durable commit, followed by Open in Edit/see progress.

**Negative cases:** Double click, response lost, restart after DB commit, stale revision, removed song, source rewrite, a future branch superseding approved one, storage full and current playback changing in another tab.

## Alternatives and safeguards

Prefer existing Selecta authoritative models, route/worker APIs and host-controlled permissions over duplicate agent-side audio/mix state. Reject model prose as proof of a write, transition render or real music quality. No SaaS/accounts/remote music/cloud sync/telemetry scope is implied by this ADR; remote model usage requires informed consent.

## Implementation checklist — 0/8 Implemented; 0/8 independently Verified

1. **LU-326-01 — Create exact approved commit API.** **Acceptance:** Commit consumes frozen order/settings from revision, not vibe regeneration. **Required verification:** Exact input/output integration test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
2. **LU-326-02 — Require host-origin approval.** **Acceptance:** User gesture and signed/token-bound action gate write; model cannot self-authorise. **Required verification:** Prompt injection/forced tool call tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
3. **LU-326-03 — Validate preflight atomically.** **Acceptance:** Library/source/scope/revision/hash/hard constraints checked under safe transaction policy. **Required verification:** Concurrent library/current mix mutation tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
4. **LU-326-04 — Implement durable idempotency ledger.** **Acceptance:** Identical retried approval yields original outcome across server restart. **Required verification:** Crash-after-commit replay tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
5. **LU-326-05 — Distinguish draft and play.** **Acceptance:** Build draft leaves current audio untouched; Build & play gets separate confirmation. **Required verification:** Playing/paused/idle real-audio E2E. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
6. **LU-326-06 — Preserve exact seam settings.** **Acceptance:** Saved draft uses reviewed settings; no hidden different replan or fallback. **Required verification:** Rendered request key parity test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
7. **LU-326-07 — Reconcile uncertain outcome.** **Acceptance:** Client queries commit status instead of issuing new write after network failure. **Required verification:** Lost-ACK/timeout tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
8. **LU-326-08 — Document recovery and Undo scope.** **Acceptance:** Old drafts/current mixes only restored through actual available scoped Undo. **Required verification:** Undo/rollback/backup test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.

## Existing product preservation

No original music edits, autoplay or audio-focus theft; preserve current/draft separation, exact occurrence/seam/revision and Undo, consented request bridges, Studio 8 lanes/8–64 cells, honest readiness, LRCLIB disclosure, blind audio-study neutrality and frozen FLAC revision identity. Negative tests include stale/offline/failed/duplicate/multi-tab/320px/high zoom/forced-colours/Still/RTL and real audio as appropriate.

## Decision and proof governance

Decision Proposed; all tasks Not started and unverified. A later accepted decision must record owner/date; code-level implementation requires concrete PR/SHA and passing relevant tests, and independent verification requires named reviewer/date/device/real audio. [Roadmap](selecta-lucy-roadmap.md) · [checklist](selecta-lucy-implementation-checklist.md) · [evidence](selecta-lucy-implementation-evidence.md) · [verification](selecta-lucy-verification-matrix.md) · [gates](selecta-lucy-release-gates.md).
