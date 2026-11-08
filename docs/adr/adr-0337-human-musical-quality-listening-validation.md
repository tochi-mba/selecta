# ADR-0337 — Real-audio musical quality, transition evidence and blind listener acceptance

- **Decision:** Proposed (owner review pending; documentation only).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Lucy agentic Make a Mix (LU); 2026-11-08; main `1b53debedc3d6ef3c8d0cf6302b561b0003e8d78`.
- **Priority / phase:** P0 / Quality. **Owner:** Unassigned. **Implementing PR/SHA:** —.
- **Existing ADR owners:** ADR-0109, ADR-0129, ADR-0211, ADR-0237, ADR-0240, ADR-0294; unchanged.
- **Source touchpoints:** `src/selecta/planner/beam.py`; `src/selecta/planner/choose.py`; `src/selecta/routes/discover.py`; `docs/acceptance.md`.

## Context and evidence boundary

A valid graph, clean rendered seam or confident model explanation is not evidence that an entire proposed DJ mix sounds good. Ready-only mixes especially may be highly constrained by cached edges. This ADR is a new proposal, not source implementation or independently proven usability/audio. Older implementation and verification histories remain unchanged.

## Proposed decision

Evaluate complete rendered mix journeys, local seam quality and instruction adherence via matched real-audio human listening studies; compare Lucy with existing Selecta baseline under controlled conditions. Include failures, fallbacks, repetition and user-refined versions without guessing statistical superiority.

## UI/UX and measurable acceptance contract

Lucy uses measured/previously-rendered/previewed status and candid quality uncertainty. A user can audition actual transition clips and see where subjective quality is not established.

**Required negative cases:** Ready-only path sounds formulaic, clean audit but poor musical arc, missing preview, inaccurate duration, repeated artist, fatigue, blind labels leak method, nonrepresentative listeners.

## Rejected shortcuts and dependencies

Never prioritise chatbot animation over audio continuity or fabricated estimates over measured truth. Reuse the existing Selecta app and WeftAI typed planning. Before implementing, reconcile related accepted ADRs against current source, tests and actual audio evidence; do not retrofit their historical statuses.

## Implementation checklist — 0/8 Implemented; 0/8 independently Verified

1. **LU-337-01 — Set musical evaluation rubric.** **Acceptance:** Quality covers coherent journey, transitions, pacing, variety, intent adherence and readiness. **Required verification:** Reviewer-reviewed scale design. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
2. **LU-337-02 — Build reproducible audio corpus.** **Acceptance:** Source songs, cues, renderer versions and exact proposed revisions frozen. **Required verification:** Audio artifact hash/manifest audit. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
3. **LU-337-03 — Run blind route comparisons.** **Acceptance:** Existing one-tap vs Lucy/refined sets compared without exposing method labels. **Required verification:** Blinded task and response report. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
4. **LU-337-04 — Evaluate ready-only separately.** **Acceptance:** Compare wait-free path utility vs musical trade-offs without misrepresenting availability. **Required verification:** Ready graph paired listening study. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
5. **LU-337-05 — Test actual rendered seams.** **Acceptance:** Listen to transition clips and full context including fallback/near-miss. **Required verification:** Ear-based quality records. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
6. **LU-337-06 — Measure user-revision adherence.** **Acceptance:** Listeners judge whether notes made intended audible improvement. **Required verification:** Before/after blinded comparison. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
7. **LU-337-07 — Report limitations honestly.** **Acceptance:** Sample size, confounds, failed clips and uncertainty published; no fake statistical claims. **Required verification:** Independent methodology review. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
8. **LU-337-08 — Gate quality release.** **Acceptance:** Named audio reviewer signs results for representative genres and constrained libraries. **Required verification:** Exact-SHA real audio GO/NO-GO. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.

## Preservation and release proof

Preserve originals, single audio owner/manual Pause, real current/draft/revision/seam/occurrence identity and scoped Undo, consented atomic bridges, Studio 8 lanes/8–64 cells, correct library and LRCLIB disclosure, neutral blind listening, frozen FLAC export. Test stale/offline/worker crashes, mobile/320px/400% zoom, keyboard/AT/RTL/forced colours/reduced motion and real audio as relevant.

## Governance

Decision Proposed and all eight LU tasks Not started/Not Verified. An implementing PR/test SHA and exact acceptance evidence are distinct from independent named reviewer/date/platform proof. [Roadmap](selecta-lucy-roadmap.md) · [checklist](selecta-lucy-implementation-checklist.md) · [evidence](selecta-lucy-implementation-evidence.md) · [verification](selecta-lucy-verification-matrix.md) · [release](selecta-lucy-release-gates.md).
