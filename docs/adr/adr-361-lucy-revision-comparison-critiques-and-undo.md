# ADR-361 — Lucy proposal revisions, musical diff, critique and safe restoration

- **Decision:** Proposed (owner review pending; this PR does not record approval).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Selecta Library + Lucy experience redesign (LX); 2026-11-08; `main` `da942863e9f57e45653cfc2fda35fe463477b8be`.
- **Priority / phase:** P1 / Lucy proposal. **Owner:** Unassigned. **Implementing PR/SHA:** —.
- **Existing ADR owners:** ADR-0323, ADR-0324, ADR-0325, ADR-0306; their decisions and statuses remain unchanged.
- **Source touchpoints (inspection, not implementation):** `web/src/views/LucyProposal.tsx`; `web/src/lucy/reducer.ts`; `web/src/views/LucySongs.tsx`.

## Context and source/evidence boundary

Current revisions have immutable identifiers and a menu for history, comparison, restore and make-current. Summaries must reveal meaningful musical deltas without confusing old revisions with the approved current one. Current features observed at the planning baseline must be revalidated at the later implementing SHA. These are proposed new design acceptance requirements, not evidence of a defect, missing feature, user-study result or completed implementation.

## Proposed decision

Provide a legible current/previous revision comparison focused on changed tracks, order, constraints and seam readiness; older versions remain inspectable but cannot silently replace active work.

## User outcome and interaction contract

A user understands Lucy's changes and can restore a previous arrangement without losing locked songs or committing unintended content.

**Required negative cases:** Parallel turn, stale revision, same song repeated, zero-change critique, branch, deleted source, cache changed and reviewer opening old revision.

**Preservation and trade-offs:** Preserve original local audio files, a single authoritative player/audio-focus owner and intentional Pause; exact recording IDs and mix/draft/revision/occurrence/seam identity, scoped Undo and guarded commits; explicit permission and consented atomic request bridges; eight-lane Studio with 8–64 cells; canonical Library readiness and LRCLIB disclosure; unbiased human listening studies; frozen-revision decodable FLAC. Never imply readiness from historical memory, fabricated artwork or AI prose. No SaaS, accounts, launcher, native folder bridge, telemetry, unsolicited remote upload or audio-engine rewrite in this redesign.

## Implementation checklist — 0/8 Implemented; 0/8 independently Verified

1. **LX-361-01 — Identify current versus historical.** **Acceptance:** Old revision viewing is clearly labelled read-only and not approvable. **Required verification:** History/current action gating fixture. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
2. **LX-361-02 — Create compact musical diff.** **Acceptance:** Added, removed, reordered and changed constraint facts appear in plain language. **Required verification:** Synthetic revision-pair accuracy fixture. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
3. **LX-361-03 — Highlight readiness impact.** **Acceptance:** Revision comparison identifies changes to verified transitions, not merely song counts. **Required verification:** Before/after seam proof test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
4. **LX-361-04 — Explain user critiques.** **Acceptance:** Direct feedback shows which instruction was honoured, unmet or infeasible. **Required verification:** Constraint-preservation comprehension test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
5. **LX-361-05 — Preserve locked occurrences.** **Acceptance:** Locked tracks are not silently changed by replanning and always use exact occurrence IDs. **Required verification:** Lock + critique regression. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
6. **LX-361-06 — Make restore safe.** **Acceptance:** Restore/make-current actions require correct revision guard and preserve ancestor immutability. **Required verification:** Stale and branch restoration E2E. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
7. **LX-361-07 — Keep selection and focus stable.** **Acceptance:** Viewing diff/revision never switches scope to a same-title recording. **Required verification:** Multi-occurrence + focus tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
8. **LX-361-08 — Validate revision decision making.** **Acceptance:** Users choose the intended version and can state consequences before commit. **Required verification:** Uncoached compare-and-restore study. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.

## Evidence and release boundaries

Compare baseline and candidate at the same route, data, theme, viewport, scroll, player and revision state. Record screenshots and measured DOM geometry where pertinent, plus tests for keyboard, touch, 320px, 200/400% zoom, Light/Dark/System, forced colours, Still/reduced motion, long and RTL/CJK names, offline, stale, cancelled, failed and multitab conditions. Use actual local audio and independent listening review for playback-affecting changes; screenshots or green CI alone do not prove musical quality or user comprehension.

## Status governance and cross-links

**Decision remains Proposed** until a named owner records date and rationale. Only an exact implementing source/test PR and SHA with item-specific proof can advance Not started → In progress → Implemented. Independent verification requires different named reviewer/date/device/environment and relevant visual, accessibility, performance, user or real-audio evidence. Do not reclassify overlapping older tasks or existing features because this doc was merged.

[Roadmap](selecta-library-lucy-experience-roadmap.md) · [208-task checklist](selecta-library-lucy-experience-implementation-checklist.md) · [evidence ledger](selecta-library-lucy-experience-implementation-evidence.md) · [status JSON](selecta-library-lucy-experience-code-status.json) · [overlap/parity](selecta-library-lucy-experience-overlap-and-parity.md) · [interaction contract](selecta-library-lucy-experience-interaction-contract.md) · [verification](selecta-library-lucy-experience-verification-matrix.md) · [status reconciliation](selecta-library-lucy-experience-status-reconciliation.md) · [release gates](selecta-library-lucy-experience-release-gates.md)
