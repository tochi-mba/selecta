# ADR-0089: Selecta 4.0 charter, baseline and full feature-preservation governance

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** 1/10 Implemented, 6 In progress, 3 Not started (per-task source and test reconciliation 2026-11-10)
- **Verification status:** Not verified (0/10)
- **Documentation status:** Drafted, documentation-only Selecta 4.0 proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 4.0 complete UI/UX overhaul
- **Phase:** 0 Baseline
- **Extends, does not automatically supersede:** ADR-0047, ADR-0078, ADR-0088
- **Source surfaces to reconcile:** `docs/adr/selecta-3-roadmap.md`; `docs/adr/selecta-3-1-roadmap.md`; `web/src/App.tsx`
- **Tasks:** S4-0089-01 through S4-0089-10 in [the Selecta 4.0 checklist](selecta-4-implementation-checklist.md)
- **Baseline:** `main` `9b663f9f10212619f27ce67ce82f602347065cbd` (after merged PRs #25 and #26)

## Context and evidence boundary

Prior Selecta 3.0 and 3.1 initiatives overlap and contain stale implementation summaries. Current main is 9b663f9f10212619f27ce67ce82f602347065cbd after merged PRs #25 and #26. A third programme must be explicitly additive, not retroactively verify either previous programme.

This is a **proposal**. Source inspection and earlier planning documents establish current contracts and candidate risks; they do not establish verified visual quality, human task success, real audio quality, screen-reader usability or shipped implementation of this ADR. Earlier programme status headings can be stale and are not inherited as verified work.

## Proposed decision

Adopt Selecta 4.0 as a separately tracked, documentation-first full UI/UX redesign. Preserve every operational capability and the current local-server/audio/data contracts, with no application implementation in this PR. Distinguish approved decisions from implementation status and independent verification.

## Experience, frontend and interaction specification

- Establish a pinned current-main baseline; record prior PR and decision history without editing its unverified entries.
- Every preexisting action receives a capability ID, UI destination, authoritative domain owner, preservation test and acceptance evidence.
- Separate listener, creator and expert journeys; prioritize observed errors and work rather than image aesthetics.
- A redesign may change labels and composition but cannot silently remove advanced moves, drafts, requests, audition studies, keyboard access, media integration or FLAC.

## Detailed implementation work

1. **S4-0089-01 - Pin and document baseline SHA, supported Windows/Edge/server version and outstanding previous PR history.** Acceptance: Signed inventory identifies actual merged main head; old plans are called historical rather than verified. Required verification: Check exact commit and previous ADR index at implementation start. **Implementation: In progress (2026-11-10). Evidence: baseline `9b663f9` pinned in `docs/adr/selecta-4-roadmap.md` and this checklist header; PR #29 merge `6638ec2` and later PR history recorded in `docs/adr/implementation-checklist-audit.md`. Verified: No. Needs a person: owner signs the baseline inventory and names the supported Windows/Edge/server versions.**
2. **S4-0089-02 - Inventory routes, overlays, controls, settings, schemas, API side effects and every state.** Acceptance: All capabilities have traceable owners including obscure menus and error branches. Required verification: Source-to-capability crosscheck against router, views, state and API. **Implementation: In progress (2026-11-10). Evidence: `docs/adr/mp-0272-surface-inventory.json` guarded by `web/src/shell/mpSurfaceInventory.test.ts` (covers every router page and tab, nav destination, overlay and flagged surface); API side effects and schemas are not yet in one inventory. Verified: No. Needs a person: owner review of the crosscheck.**
3. **S4-0089-03 - Create feature-to-test-to-ADR parity mapping and blocking invariants.** Acceptance: No old capability is orphaned or dropped. Required verification: Review parity map against existing unit/E2E and Python tests. **Implementation: In progress (2026-11-10). Evidence: `docs/adr/selecta-4-feature-parity.md` maps capabilities to ADRs but has no test column yet. Verified: No. Needs a person: parity-map review against the test suites.**
4. **S4-0089-04 - Record current dark/light responsive baselines with deterministic fixtures.** Acceptance: Every captured image names fixture, browser, theme, viewport and commit. Required verification: 320/375/768/1280/1440 screenshots plus loaded/error states. **Implementation: In progress (2026-11-10). Evidence: `web/e2e/mp-baseline.mp.ts` captures every route at 11 viewports in both themes with fixture names (ADR-0272); not rerun for this ledger. Verified: No. Needs a person: review of the captured set against a named commit.**
5. **S4-0089-05 - Run unassisted listener, creator and expert baseline tasks.** Acceptance: Results separate observations from hypotheses and record failures. Required verification: Music-folder, first mix, request, draft, Studio, export scripts. **Implementation: Not started (2026-11-10). Verified: No. Needs a person: unassisted listener, creator and expert baseline sessions.**
6. **S4-0089-06 - Define P0/P1/P2 triage and evidence owners.** Acceptance: Wrong scope, data loss, audio overlap, bridge consent and bad FLAC are stop-ship. Required verification: Fault/reproduction register and accepted-risk owner. **Implementation: In progress (2026-11-10). Evidence: P0 stop-ship list (wrong mix, data loss, audio overlap, unconsented bridge, bad FLAC) in `docs/adr/selecta-4-release-gates.md`. Verified: No. Needs a person: owner names evidence owners and the accepted-risk owner.**
7. **S4-0089-07 - Require no-runtime-change documentation boundary.** Acceptance: This ADR PR changes only docs; implementation occurs separately. Required verification: PR changed-path audit. **Implementation: Not started (2026-11-10). Verified: No. Needs a person: owner disposition: `git diff --name-only 6812080^1 6812080` shows the PR #28 merge also changed 14 `web/src` files, so the docs-only boundary was not met as recorded.**
8. **S4-0089-08 - Set decision/implementation/verification lifecycle and change log.** Acceptance: Proposed never means accepted; merged docs never means working code. Required verification: Ledger validation and owner sign-off evidence. **Implementation: Implemented (2026-11-10). Evidence: lifecycle defined in this checklist header and each ADR; `src/selecta/audit/checklist_evidence.py` rejects ticks without evidence, `tests/test_checklist_evidence.py` passed 2026-11-10. Verified: No. Needs a person: owner sign-off of the lifecycle.**
9. **S4-0089-09 - Define compatibility and rollback requirements before UI replacement.** Acceptance: Existing paths/preferences/drafts/export jobs remain usable across rollback. Required verification: Upgrade/rollback fixture tests. **Implementation: In progress (2026-11-10). Evidence: harness `tests/rollback_check.py` (new/old/new home round trip) exists; `tests/test_local_backup.py` restore-with-rollback tests passed 2026-11-10; the cross-checkout rollback run has not been done for this ledger. Verified: No. Needs a person: run `tests/rollback_check.py` against the pre-4.0 checkout.**
10. **S4-0089-10 - Approve separately staged implementation PR order with each dependency.** Acceptance: Each PR traces to stable S4 IDs and explicit tests. Required verification: Phase gate review against roadmap. **Implementation: Not started (2026-11-10). Verified: No. Needs a person: owner approves the staged PR order.**

## Required negative cases and regression strategy

- Stale 3.1 documentation describes an already merged PR as open; do not silently 'fix' historical status in this docs-only proposal.
- No inherited S3 or S31 task becomes completed without evidence.
- The release gate remains NO-GO until human, audio, CI, scale, accessibility and rollback evidence exists.
- Exercise light, dark and system themes; empty, loading, partial, ready, stale, failed, offline and recovering states where applicable.
- Exercise 320/375/390/430/768/1024/1280/1440/1920 CSS-pixel widths, short viewports, 200/400% zoom, keyboard, touch, reduced motion, realistic long/missing/duplicate/Unicode/RTL metadata.
- Maintain existing frontend, API, audio and Python assertions; changed markup may require selector updates but never weakened behavioural contracts.

## Preservation and dependencies

Retain the [existing Selecta 3.0 invariants INV-01–INV-20](selecta-3-roadmap.md) and [3.1 preservation contract](selecta-3-1-roadmap.md): no original-file mutation; local-first security and LRCLIB disclosure; no loss of current/draft state, preferences, corrections or ratings; stable old routes; one audio owner; exact request consent and atomic join; truthful requested-versus-rendered state; revision-pinned decodable FLAC; full keyboard alternatives and regression assertions. No backend, schema, audio-engine or dependency rewrite is authorized by this ADR. See [4.0 parity matrix](selecta-4-feature-parity.md) and [verification matrix](selecta-4-verification-matrix.md).

## Alternatives, risks and trade-offs

A broad new programme creates tracking overhead, but avoids treating partial old work as complete or masking regressions.

## Evidence and advancement rules

An owner must separately **Accept** this decision before it becomes policy. Each implementing PR must name the S4-0089 task IDs, actual commit(s), changed files, pre-existing regression tests, new negative/concurrency cases, theme/viewport screenshots and relevant human/audible/AT evidence. **Implemented** requires merged code and applicable automated checks; **Verified** additionally requires independent real acceptance relevant to the change. An unchecked checkbox means not Verified. A docs merge does not advance these statuses.

## Status history

| Date | Decision | Implementation | Verification | Evidence |
|---|---|---|---|---|
| 2026-11-07 | Proposed | Not started | Not verified | Documentation-only specification; no runtime, test or UI changes |
| 2026-11-08 | Accepted | Not started | Not verified | Owner accepted all proposed ADRs ([#37](https://github.com/tochi-mba/selecta/pull/37)) |
| 2026-11-10 | Accepted | 1/10 Implemented, 6 In progress, 3 Not started | Not verified | Per-task source and test reconciliation; each task names the automated checks run on 2026-11-10 and any check that needs a person |

## Related documents

- [Selecta 4.0 roadmap and ADR index](selecta-4-roadmap.md)
- [4.0 implementation checklist](selecta-4-implementation-checklist.md)
- [4.0 per-task evidence ledger](selecta-4-evidence.md)
- [4.0 verification and edge-case matrix](selecta-4-verification-matrix.md)
- [4.0 release readiness criteria](selecta-4-release-gates.md)
- [Earlier 3.1 implementation checklist](selecta-3-1-implementation-checklist.md)
