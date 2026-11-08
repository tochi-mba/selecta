# ADR-0327 — Scope-safe handoff to current mix, drafts, Seam Inspector, Studio and requests

- **Decision:** Accepted (owner approval recorded 2026-11-08; docs only, implementation pending).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Lucy agentic Make a Mix (LU); 2026-11-08; main `1b53debedc3d6ef3c8d0cf6302b561b0003e8d78`.
- **Priority / phase:** P0 / Integration. **Owner:** Unassigned. **Implementing PR/SHA:** —.
- **Related existing ADRs:** ADR-0101, ADR-0103, ADR-0174, ADR-0219, ADR-0221, ADR-0223, ADR-0225; statuses and scope unchanged.
- **Source touchpoints:** `web/src/views/Mix.tsx`; `web/src/views/SeamInspector.tsx`; `web/src/views/Studio.tsx`; `src/selecta/routes/song_requests.py`.

## Context and source evidence boundary

Selecta already has authoritative Story/Arrange/Detail, Seam Inspector, Studio and requests/bridge consent. Lucy must not invent a second independent edit pipeline or alter an active player by discussing a proposal. Existing code is not credited as implementing new Lucy acceptance; revalidate at source SHA before work starts. This ADR defines a new feature proposal only.

## Proposed decision

Enable deep-linked read-only contextual questions and explicitly approved exact-scope edits. Returning from Lucy preserves editor mode, selected occurrence/seam and draft identity. Studio retains all manual cell authority and rendering/apply stages; request bridges retain user consent.

## UI/UX, interaction and truth contract

From 'Why this transition?' show actual directed seam evidence; 'Inspect in editor' navigates precisely. A manual change made while Lucy plans invalidates stale proposed draft edits.

**Negative cases:** Deleted draft, song moved to different position, selection removed, request still pending, bridge route consent, Studio cell edited after proposal, paused player and simultaneous browser edits.

## Alternatives and safeguards

Prefer existing Selecta authoritative models, route/worker APIs and host-controlled permissions over duplicate agent-side audio/mix state. Reject model prose as proof of a write, transition render or real music quality. No SaaS/accounts/remote music/cloud sync/telemetry scope is implied by this ADR; remote model usage requires informed consent.

## Implementation checklist — 0/8 Implemented; 0/8 independently Verified

1. **LU-327-01 — Capture source selection/context.** **Acceptance:** Song occurrence/seam key, draft/current scope and editor mode are stable. **Required verification:** Deep-link duplicate song tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
2. **LU-327-02 — Return without focus theft.** **Acceptance:** Back returns to exact selectable musical object or explains removal. **Required verification:** Navigation/scroll/focus E2E. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
3. **LU-327-03 — Use authoritative editing APIs.** **Acceptance:** Lucy never mutates parallel copy of current mix and draft state. **Required verification:** API integration and data parity. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
4. **LU-327-04 — Protect manual edits from stale AI.** **Acceptance:** Expected revision prevents overwrite of newer editor actions. **Required verification:** Multi-tab and Studio diff race test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
5. **LU-327-05 — Preserve full Studio UX.** **Acceptance:** AI arrangement is a diff preview; eight lanes/8–64 cells and local recovery untouched. **Required verification:** Studio regression and independent audio. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
6. **LU-327-06 — Preserve request/bridge consent.** **Acceptance:** No implicit request insertion or unapproved bridge render/play route. **Required verification:** Atomic bridge E2E. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
7. **LU-327-07 — Expose song/library detail routes.** **Acceptance:** Song correction, readiness and alternatives hand off to existing Library. **Required verification:** Cross-route context restoration. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
8. **LU-327-08 — Verify scope and player invariants.** **Acceptance:** Questions, navigation and plan failures never change playback/audio focus. **Required verification:** Real-audio scope/Undo matrix. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.

## Existing product preservation

No original music edits, autoplay or audio-focus theft; preserve current/draft separation, exact occurrence/seam/revision and Undo, consented request bridges, Studio 8 lanes/8–64 cells, honest readiness, LRCLIB disclosure, blind audio-study neutrality and frozen FLAC revision identity. Negative tests include stale/offline/failed/duplicate/multi-tab/320px/high zoom/forced-colours/Still/RTL and real audio as appropriate.

## Decision and proof governance

Decision Accepted; all tasks Not started and unverified. A later accepted decision must record owner/date; code-level implementation requires concrete PR/SHA and passing relevant tests, and independent verification requires named reviewer/date/device/real audio. [Roadmap](selecta-lucy-roadmap.md) · [checklist](selecta-lucy-implementation-checklist.md) · [evidence](selecta-lucy-implementation-evidence.md) · [verification](selecta-lucy-verification-matrix.md) · [gates](selecta-lucy-release-gates.md).
