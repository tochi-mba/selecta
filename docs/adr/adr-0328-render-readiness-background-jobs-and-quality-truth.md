# ADR-0328 — Rendering lifecycle, real job streaming and musical readiness truth

- **Decision:** Proposed (owner review pending; documentation only).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Lucy agentic Make a Mix (LU); 2026-11-08; main `1b53debedc3d6ef3c8d0cf6302b561b0003e8d78`.
- **Priority / phase:** P0 / Integration. **Owner:** Unassigned. **Implementing PR/SHA:** —.
- **Related existing ADRs:** ADR-0065, ADR-0108, ADR-0170, ADR-0221, ADR-0228, ADR-0237; statuses and scope unchanged.
- **Source touchpoints:** `src/selecta/seams.py`; `src/selecta/routes/system.py`; `src/selecta/routes/edit.py`; `web/src/views/CurrentMix.tsx`.

## Context and source evidence boundary

Generating a track order does not mean its transitions have rendered; worker jobs can take minutes, fail or fall back. Lucy's chat text may finish while Selecta continues processing. Existing code is not credited as implementing new Lucy acceptance; revalidate at source SHA before work starts. This ADR defines a new feature proposal only.

## Proposed decision

Keep proposal, persisted draft, render request, worker status, playable clip and actual playback as independent state layers. Tool mini cards and ongoing job subscriptions derive from real statuses. A current ready-only guarantee must be revalidated as its cache changes.

## UI/UX, interaction and truth contract

Lucy says Draft saved before Rendering; reports completed N of N-1 transitions only from actual statuses; a failed seam offers Inspect/repair without fabricated quality claim.

**Negative cases:** Worker crash, render queued behind current mix, cache eviction, failed audit, fallback move, failed FLAC, user manually edits order while rendering, offline server and export snapshot.

## Alternatives and safeguards

Prefer existing Selecta authoritative models, route/worker APIs and host-controlled permissions over duplicate agent-side audio/mix state. Reject model prose as proof of a write, transition render or real music quality. No SaaS/accounts/remote music/cloud sync/telemetry scope is implied by this ADR; remote model usage requires informed consent.

## Implementation checklist — 0/8 Implemented; 0/8 independently Verified

1. **LU-328-01 — Define readiness lattice.** **Acceptance:** Proposed/planned/queued/rendering/ready/failed/fallback/playing are separate. **Required verification:** Schema-state truth table. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
2. **LU-328-02 — Subscribe real job updates.** **Acceptance:** Chat progress follows canonical job service even after agent turn finished. **Required verification:** Background process and reconnect E2E. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
3. **LU-328-03 — Show per-seam statuses.** **Acceptance:** Exact request key and readiness count N-1 exclude the first song. **Required verification:** One/two/many/failed fixtures. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
4. **LU-328-04 — Represent fallback honestly.** **Acceptance:** Requested vs actual move and passed/near miss/warnings shown. **Required verification:** Rendered fallback audit fixture. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
5. **LU-328-05 — Preserve worker priorities.** **Acceptance:** Lucy optional jobs yield to current playback and urgent requests. **Required verification:** CPU/audio scheduler regression. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
6. **LU-328-06 — Handle invalidated renders.** **Acceptance:** Changed song/analysis or evicted clip updates real readiness, not cached UI success. **Required verification:** Eviction/rules version tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
7. **LU-328-07 — Handoff to editor/export.** **Acceptance:** Existing render line, inspector and frozen-revision export used unchanged. **Required verification:** Draft/export regression tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
8. **LU-328-08 — Confirm human listening quality.** **Acceptance:** Automated checks are distinct from real ear-based evaluation. **Required verification:** Human review with exact rendered artifact. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.

## Existing product preservation

No original music edits, autoplay or audio-focus theft; preserve current/draft separation, exact occurrence/seam/revision and Undo, consented request bridges, Studio 8 lanes/8–64 cells, honest readiness, LRCLIB disclosure, blind audio-study neutrality and frozen FLAC revision identity. Negative tests include stale/offline/failed/duplicate/multi-tab/320px/high zoom/forced-colours/Still/RTL and real audio as appropriate.

## Decision and proof governance

Decision Proposed; all tasks Not started and unverified. A later accepted decision must record owner/date; code-level implementation requires concrete PR/SHA and passing relevant tests, and independent verification requires named reviewer/date/device/real audio. [Roadmap](selecta-lucy-roadmap.md) · [checklist](selecta-lucy-implementation-checklist.md) · [evidence](selecta-lucy-implementation-evidence.md) · [verification](selecta-lucy-verification-matrix.md) · [gates](selecta-lucy-release-gates.md).
