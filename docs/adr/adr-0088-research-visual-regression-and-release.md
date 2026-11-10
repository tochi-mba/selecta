# ADR-0088: Require observable user, visual and product acceptance before release

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** In progress: 5 Implemented (automated), 1 In progress, 6 need a person only (2026-11-10 reconciliation); 0/12 Verified
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.1 verification-led UI/UX finishing (proposal initially docs-only)
- **Phase:** 6 - integrated release
- **Extends:** ADR-0074, ADR-0075, ADR-0076, ADR-0029. No inherited task is automatically complete.
- **Dependencies:** ADRs 0078–0087 with recorded owner review.
- **Checklist:** S31-0088-01 through S31-0088-12 in [the 3.1 checklist](selecta-3-1-implementation-checklist.md).

## Context and verified source boundary

Relevant current repository surfaces: `docs/adr/selecta-3-verification-matrix.md`, `web/e2e/*`, `.github/workflows/test.yml` (read-only initial gate review), `docs/acceptance.md`, evidence ledgers. Source inspection and the existing 3.0 documentation establish the available controls and contracts; they do **not** establish rendered quality, human usability, screen-reader conformance or subjective audio quality. The source baseline is the 3.0 merge `3b01dc1336aab0f1cb0a4d85be5eba359de81831`. All new work is proposed.

## Proposed decision

Approve polish by demonstrated user outcomes and preserved behaviour, not by checklist volume, a CI green mark, or visual preference alone. Incrementally stage future implementation in separately reviewed PRs with rollback and no changes to source data.

## Non-negotiable preservation

Preserve [Selecta 3.0 invariants INV-01–INV-20](selecta-3-roadmap.md): music and metadata safety; local-first Host/Origin boundaries and accurate LRCLIB disclosure; all routes and old aliases; stable current/draft identity and guarded writes; persisted drafts, corrections and preferences; single-owner playback and previews; explicit atomic bridge consent; truthful seam/readiness; authentic revision-pinned FLAC; keyboard/AT alternatives; and complete behavioural regression assertions. This ADR does not authorize changing the audio engine, backend, schema or runtime code.

## Tasks, observable acceptance and traceable ID

1. **S31-0088-01 - Create deterministic visual snapshot matrix for approved screen/state/theme fixtures.** Acceptance: Include full UI, modal open, empty, loading, error, recovery, 320px and desktop examples. **Status (2026-11-10):** Implemented (automated), not Verified. **Evidence:** `web/e2e/visual.e2e.ts`, `web/e2e/paired-theme.e2e.ts` candidate matrix (`docs/adr/completion/visual-evidence.md`). **Needs a person:** named reviewer approves the baselines.
2. **S31-0088-02 - Require reviewed diffs rather than bulk baseline replacement.** Acceptance: All visual changes have owner approval and intentional reasons; no accidentally hidden content. **Status (2026-11-10):** Not Verified. **Needs a person:** owner approves each visual diff with a reason.
3. **S31-0088-03 - Preserve all existing Python, frontend, audio and E2E assertions.** Acceptance: Selectors can evolve, but regressions in identity, playback, export or privacy remain blocking. **Status (2026-11-10):** Implemented (automated), not Verified. **Evidence:** On 2026-11-10: 56 Vitest files for these surfaces (722 of 726 tests passed; the 4 failures are in `css-ownership.test.ts`, `LinksRating.test.tsx` and `StudioSafety.test.tsx`, all under concurrent edit by other sections), 9 Python files (339 passed), `tests/rollback_check.py` and the finishing/integration Edge specs. **Needs a person:** green exact-head CI and P0/P1 disposition.
4. **S31-0088-04 - Run integrated stale/offline/duplicate/concurrent failure scenarios.** Acceptance: No invented ready/success, wrong mix write, lost draft, partial request or silent unsupported retry. **Status (2026-11-10):** Implemented (automated), not Verified. **Evidence:** `web/e2e/integration.e2e.ts` (all seven scenarios) and `web/e2e/finishing.e2e.ts` passed. **Needs a person:** owner review for Verified.
5. **S31-0088-05 - Conduct unguided listener, creator and expert tasks.** Acceptance: Record actual pass/fail, completion time, hesitation, wrong action and participant quotes without fabricated metrics. **Status (2026-11-10):** Not Verified. **Needs a person:** unguided listener, creator and expert sessions.
6. **S31-0088-06 - Run manual auditory transition and export review.** Acceptance: Evaluate playback continuity separately from perceived mix quality; real FLAC decodes and matches snapshot. **Status (2026-11-10):** Not Verified. **Evidence:** Automated FLAC order check in S31-0083-12. **Needs a person:** manual listening review of transitions and export.
7. **S31-0088-07 - Audit each unresolved P0/P1/P2 issue and written disposition.** Acceptance: P0 always blocks; P1 blocks unless specifically risk-accepted; P2 has reviewed disposition. **Status (2026-11-10):** Not Verified. **Needs a person:** owner dispositions every P0/P1/P2.
8. **S31-0088-08 - Verify rollback compatibility and preservation of local persisted state.** Acceptance: Restored old build sees source files, drafts, settings and prior URLs without migration loss. **Status (2026-11-10):** Implemented (automated), not Verified. **Evidence:** `tests/rollback_check.py` against `main` (`405cf7f`) source: draft, correction, settings, rating and export record identical across new/old/new. **Needs a person:** restore an old build in a browser and confirm prior URLs.
9. **S31-0088-09 - Update ADR decisions, task checklist and evidence ledger per implementing PR.** Acceptance: No status advances from Proposed/Not started without owner decision and evidence. **Status (2026-11-10):** Implemented (automated), not Verified. **Evidence:** ADR-0078-0088, this checklist and `selecta-3-1-evidence.md` updated 2026-11-10 without advancing any Verified count. **Needs a person:** owner review for Verified.
10. **S31-0088-10 - Measure goals against an approved, recorded baseline.** Acceptance: Proposed success targets are calibrated from observed task data, not asserted as achieved. **Status (2026-11-10):** Not Verified. **Needs a person:** measure goals against an approved baseline from observed task data.
11. **S31-0088-11 - Prepare a release-candidate report listing support and known limitations.** Acceptance: Report screenshots, CI SHA, user/AT/audio/performance evidence and excluded environments. **Status (2026-11-10):** In progress, not Verified. **Evidence:** `selecta-3-1-release-readiness.md` (NO-GO template). **Needs a person:** complete the report with real screenshots, CI SHA and human evidence.
12. **S31-0088-12 - Obtain explicit owner go/no-go sign-off.** Acceptance: No automatic merge or release merely from planning PR, green CI or completed cosmetic work. **Status (2026-11-10):** Not Verified. **Needs a person:** owner go/no-go sign-off.

## Required adverse cases and evidence

- Never claim manual user/audio/screen-reader evidence until it exists.
- No P0/P1 release blockers may be dismissed because screenshots look good.
- Automated snapshots need stable fixtures, fonts and clocks.

For each applicable task, capture a fixture/viewport/theme and observable pass/fail, plus keyboard/AT, real audio, performance, security, persistence or backend-contract evidence when relevant. A visual-only improvement cannot weaken prior behaviour. Record untested cases as pending and explicitly justify N/A. Reuse [the 3.1 verification matrix](selecta-3-1-verification-matrix.md) and [the evidence ledger](selecta-3-1-evidence.md).

## Alternatives and trade-offs

A stricter evidence gate slows cosmetic shipping but avoids fragile or inaccessible 'finished' releases.

## Decision and implementation boundary

The owner accepted this decision on 2026-11-08. Only the explicitly identified S31 tasks in the evidence ledger are **In progress**; all other tasks in this ADR remain Not started. A later implementation PR must name the task ID, acceptance, real implementation commit, negative cases, linked old S3 task/parity row and evidence. **Implemented** requires merged code and required automated checks; **Verified** additionally requires the human evidence relevant to that task. The initial proposal was documentation-only. PR #25 now also has limited frontend/test changes in other workstreams. This ADR remains Not started; implementation is tracked by task ID in the evidence ledger and no task is Verified.

## Status history

| Date | Decision | Implementation | Evidence |
|---|---|---|---|
| 2026-11-07 | Proposed | Not started | Initial documentation-only finishing plan | 
| 2026-11-07 | Proposed | In progress | Selected UI/Edge/test or visual-review infrastructure on draft PR #25; no human acceptance or task Verified |
| 2026-11-08 | Accepted | In progress | Owner accepted all proposed ADRs ([#37](https://github.com/tochi-mba/selecta/pull/37)) |
| 2026-11-10 | Accepted | In progress | Every task re-checked against current code; 5 Implemented (automated), 1 In progress, 6 need a person only (2026-11-10 reconciliation); focused Vitest, pytest and Edge runs named per task; 0/12 Verified |

## Related documents

- [Selecta 3.1 roadmap](selecta-3-1-roadmap.md)
- [3.1 implementation checklist](selecta-3-1-implementation-checklist.md)
- [3.1 verification matrix](selecta-3-1-verification-matrix.md)
- [3.1 evidence ledger](selecta-3-1-evidence.md)
- [3.0 roadmap and invariant contract](selecta-3-roadmap.md)
- [3.0 implementation status](selecta-3-evidence.md)
- [Research and confidence boundary](../research/selecta-3-1-polish.md)
