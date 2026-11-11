# ADR-0389 - Independent visual, human, performance, real-audio and release GO/NO-GO

- **Decision:** Accepted (requester approved all 24 UF ADRs on 2026-11-08; implementation and independent acceptance remain separate).
- **Implementation:** 7/8 Not started; 0/8 In progress; 1/8 Implemented (1/8 ticked in the checklist with automated evidence, 2026-11-11).
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Selecta Unified Experience Finish (UF); 2026-11-08; `main` `f17944530d54203e49baebdabc08a57ee9f40526`.
- **Priority / phase:** P0 / 08 Verification. **Owner:** Unassigned. **Implementing PR/SHA:** -.
- **Existing ADR owners:** ADR-0239, ADR-0240, ADR-0247, ADR-0271, ADR-0299, ADR-0336, ADR-0365; unchanged.
- **Source touchpoints (review, not implementation):** `web/e2e/paired-theme.e2e.ts`; `web/e2e/visual.e2e.ts`; `web/bench/scale.bench.ts`.

## Context and evidence boundary

The current app already contains major parts of this workflow. New UF tasks are additive integration and verification acceptance, not claims that existing features are missing. Nothing in this documentation PR changes app code, tests, server, audio or prior ADR histories. Current capabilities must be inspected again at the exact implementing SHA before any change or status advancement.

## Proposed decision

Existing synthetic visual captures are review candidates and muted E2E cannot prove musical quality or user comprehension.

## User outcome and interaction contract

Users understand what is actually available, which exact music object they are affecting and what action will occur. Every screen includes meaningful loading, empty, stale, failed, recovery, mobile, zoom, long-metadata and relevant audio-interruption states, tested rather than assumed.

**Preservation and trade-offs:** Preserve local original music, one authoritative player and deliberate Pause; exact recording/draft/mix/revision/occurrence/seam IDs; revision-guarded mutations and scoped Undo; explicit consent and atomic bridges; actual on-disk valid ready-only seams (K songs need K−1 edges); eight Studio lanes and 8–64-cell arrangement; truthful source/readiness; frozen-revision decodable FLAC; unbiased human listening. No accounts, SaaS, telemetry, remote audio upload or engine rewrite.

## Implementation checklist - 1/8 Implemented; 0/8 independently Verified

1. **UF-0389-01 - Approve paired visual baselines.** **Acceptance:** Same fixture/route/state/player/revision/size in Light and Dark, human reviewed. **Required verification:** Signed screenshot manifest. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-11, coordinator commits); **Evidence:** Needs a person: human review of paired Light and Dark screenshots of the same fixture, route, state and size (2026-11-11); **Evidence/reviewer:** -.
2. **UF-0389-02 - Run responsive and AT acceptance.** **Acceptance:** Mobile, 400%, forced colours, physical keyboard and screen readers cover core routes. **Required verification:** Independent platform report. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-11, coordinator commits); **Evidence:** Needs a person: independent platform report covering mobile, 400% zoom, forced colours, physical keyboard and screen readers (2026-11-11); **Evidence/reviewer:** -.
3. **UF-0389-03 - Measure realistic performance.** **Acceptance:** 20k Library, long Lucy, 40+ editor and active spectrum with named devices and budgets. **Required verification:** Benchmark report. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-11, coordinator commits); **Evidence:** Needs a person: benchmark report on named devices for a 20k Library, long Lucy, a 40+ song editor and an active spectrum (2026-11-11); **Evidence/reviewer:** -.
4. **UF-0389-04 - Publish human success evidence.** **Acceptance:** Uncoached novice/expert tasks with approved threshold and sample-size caveats. **Required verification:** Researcher-reviewed results. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-11, coordinator commits); **Evidence:** Needs a person: researcher-reviewed uncoached novice and expert task results (2026-11-11); **Evidence/reviewer:** -.
5. **UF-0389-05 - Listen to real transitions.** **Acceptance:** Actual seams, stems, audio focus and output judged separately from synthetic UI tests. **Required verification:** Independent real-audio log. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-11, coordinator commits); **Evidence:** Needs a person: listening to real transitions, stems and audio focus, logged separately from synthetic tests (2026-11-11); **Evidence/reviewer:** -.
6. **UF-0389-06 - Verify functional preservation.** **Acceptance:** No unsolicited Pause, wrong exact IDs, consent breach, false ready-only or bad frozen FLAC. **Required verification:** Regression and manual review. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-11, coordinator commits); **Evidence:** Needs a person: manual review of functional preservation; the automated regressions are in CI (2026-11-11); **Evidence/reviewer:** -.
7. **UF-0389-07 - Keep per-task status provenance.** **Acceptance:** ADR, checklist, evidence and JSON updated together only on proven SHA/review. **Required verification:** Consistency validator and negative cases. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-11, coordinator commits); **Evidence:** tests/test_uf_status.py, all seven including test_an_adr_that_moved_alone_is_caught, test_a_ledger_or_json_that_lags_is_caught, test_a_tick_needs_implemented_and_evidence and test_a_wrong_summary_count_is_caught (passed in a 200/200 server run); validator src/selecta/audit/uf_status.py (2026-11-11); **Evidence/reviewer:** -.
8. **UF-0389-08 - Require documented release verdict.** **Acceptance:** Zero unresolved P0; P1 decisions, rollback, named owner and independent GO sign-off. **Required verification:** Gate dry run. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-11, coordinator commits); **Evidence:** Needs a person: release verdict with zero unresolved P0, P1 decisions, rollback, a named owner and independent GO sign-off (2026-11-11); **Evidence/reviewer:** -.

## Verification and release boundaries

Use matched baseline and candidate with same route/data/player/revision/scroll/theme/viewport, plus keyboard, touch, assisted technologies, 320–3840px, 200/400% zoom, short landscape, Light/Dark/System/forced-colours and reduced motion where meaningful. Real music and independent human accessibility/visual/usability evidence are mandatory where relevant: synthetic muted browser automation and candidate screenshots are not proof.

**Research:** [Existing UI/UX research](../research/ui-ux.md) · [Polish research](../research/ui-ux-polish.md) · [WCAG 2.2](https://www.w3.org/TR/WCAG22/) · [ARIA APG](https://www.w3.org/WAI/ARIA/apg/patterns/) · [NN/g progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) · [Microsoft human-AI](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/) · [web.dev Web Vitals](https://web.dev/articles/vitals).

## Decision, implementation and independent verification

Decision remains **Proposed** until named owner/date/rationale accepts/rejects/supersedes. Implementation Not started → In progress → Implemented needs exact matching source/test PR+SHA. Independent verification No → Yes needs separate reviewer/date/platform/device/AT and appropriate visual/human/performance/real-audio evidence. All four tracking representations must update together and existing histories remain untouched.

[Roadmap](selecta-unified-finish-roadmap.md) · [192-task checklist](selecta-unified-finish-implementation-checklist.md) · [evidence](selecta-unified-finish-implementation-evidence.md) · [JSON](selecta-unified-finish-code-status.json) · [parity](selecta-unified-finish-overlap-and-parity.md) · [interaction contract](selecta-unified-finish-experience-contract.md) · [verification](selecta-unified-finish-verification-matrix.md) · [reconciliation](selecta-unified-finish-status-reconciliation.md) · [release](selecta-unified-finish-release-gates.md)
