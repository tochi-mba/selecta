# ADR-0113: User research, phased migration, evidence ledger, rollback and explicit go/no-go

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** In progress (2/10 implemented, 5 in progress; source reconciliation 2026-11-10, branch feat/finish-checklists)
- **Verification status:** Not verified (0/10)
- **Documentation status:** Drafted, documentation-only Selecta 4.0 proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 4.0 complete UI/UX overhaul
- **Phase:** 0–13 Governance/release
- **Extends, does not automatically supersede:** ADR-0030, ADR-0075, ADR-0076, ADR-0078, ADR-0088
- **Source surfaces to reconcile:** `docs/adr/selecta-3-1-release-readiness.md`; `docs/adr/selecta-3-1-evidence.md`; `docs/acceptance.md`
- **Tasks:** S4-0113-01 through S4-0113-10 in [the Selecta 4.0 checklist](selecta-4-implementation-checklist.md)
- **Baseline:** `main` `9b663f9f10212619f27ce67ce82f602347065cbd` (after merged PRs #25 and #26)

## Context and evidence boundary

Previous programmes include unfinished verification and stale status summaries. A design-document merge must not be treated as code completion, and a green CI build must not substitute for usability, accessibility and audible approval.

This is a **proposal**. Source inspection and earlier planning documents establish current contracts and candidate risks; they do not establish verified visual quality, human task success, real audio quality, screen-reader usability or shipped implementation of this ADR. Earlier programme status headings can be stale and are not inherited as verified work.

## Proposed decision

Use reversible, feature-flagged, staged implementation PRs and a strict evidence-led release gate. Require observed listener/creator/expert tasks, dark/light visual review, WCAG/human AT, real music/FLAC, large-scale performance and explicit owner go/no-go.

## Experience, frontend and interaction specification

- Phases: baseline → tokens/components → shell → consistency → onboarding/Explore → Listen → Mixes → Editor → Inspector/Studio → Requests/discovery → Library → Workspace/Export → cross-cutting verification.
- Keep old shell temporarily behind a development-controlled flag; retire it only after verified new shell and rollback demonstration.
- Decision Accepted, implementation Implemented and verification Verified require different recorded artifacts.
- PR merge of this plan only publishes Proposed decisions and Not started tasks.

## Detailed implementation work

1. **S4-0113-01 - Approve baseline, explicit feature parity and release-owner responsibilities.** Acceptance: Every invariant/test has named owner and no inherited status guesses. Required verification: Recorded baseline signature and task mapping. **Implementation: In progress (2026-11-10, source-reconciled); Verified: No.** Evidence: docs/adr/completion/baseline.md. Needs a person: owner approval of baseline and release-owner responsibilities.
2. **S4-0113-02 - Conduct initial qualitative listener/creator/expert tasks.** Acceptance: Observed findings logged with no fabricated usability success. Required verification: Participant tasks and reproducible notes. **Implementation: Not started (2026-11-10); Verified: No.** Evidence: not a code task. Needs a person: participant listener/creator/expert sessions.
3. **S4-0113-03 - Approve dark/light visual design and content hierarchy separately.** Acceptance: Both themes independently inspected across devices and states. Required verification: Reviewed screenshot sets and contrast report. **Implementation: In progress (2026-11-10, source-reconciled); Verified: No.** Evidence: web/e2e/paired-theme.e2e.ts and docs/adr/completion/visual-evidence.md capture both themes. Needs a person: owner design approval of both themes.
4. **S4-0113-04 - Sequence implementing PRs behind reversible dev feature flag.** Acceptance: Each PR isolated, roll-backable and names S4 task IDs. Required verification: Feature flag and route compatibility smoke. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: src/selecta/flags/*.json, tests/test_flags.py, web/e2e/flags.e2e.ts sweep, docs/flags.md. Needs a person: independent review.
5. **S4-0113-05 - Define operational migration for preferences and local working copies.** Acceptance: No lost drafts, corrections, ratings, settings or Studio recoveries. Required verification: Old→new→old fixture migration tests. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: tests/test_upgrade.py, tests/test_local_upgrade.py, tests/test_recovery.py; prefs.test.ts and StudioSafety.test.tsx recovery cases. Needs a person: old to new to old exercise on a real home.
6. **S4-0113-06 - Review new dependencies, backend needs and PWA compatibility separately.** Acceptance: No unapproved engine/data/network change hidden in UI work. Required verification: API/dependency/security PR checklist. **Implementation: Not started (2026-11-10); Verified: No.** Evidence: not a code task. Needs a person: owner API/dependency/security review.
7. **S4-0113-07 - Require critical cross-feature and real audio acceptance.** Acceptance: Playback, requests, revisions and FLAC verified end-to-end. Required verification: Windows/Edge and decodable export session. **Implementation: In progress (2026-11-10, source-reconciled); Verified: No.** Evidence: listen.e2e.ts real audio; flows.e2e.ts 'saving a mix as an audio file makes a real FLAC'. Needs a person: Windows/Edge real audio session.
8. **S4-0113-08 - Require WCAG/human AT, viewport and performance evidence.** Acceptance: No inaccessible core workflow and measured scale regression. Required verification: NVDA/Edge and recorded profiler results. **Implementation: In progress (2026-11-10, source-reconciled); Verified: No.** Evidence: pages.e2e.ts axe and reflow. Needs a person: NVDA/Edge and recorded profiler results.
9. **S4-0113-09 - Reconcile P0/P1/P2 defects and acceptance exceptions.** Acceptance: P0 blocks; P1 owner risk approval documented; P2 disposition. Required verification: Issue register, exact SHA and owner signoff. **Implementation: Not started (2026-11-10); Verified: No.** Evidence: not a code task. Needs a person: issue register, exact SHA and owner sign-off.
10. **S4-0113-10 - Prepare exact-head release report and demonstrate rollback.** Acceptance: Final verdict explicitly GO/NO-GO with linked proof. Required verification: Release runbook and rollback exercise. **Implementation: In progress (2026-11-10, source-reconciled); Verified: No.** Evidence: tests/rollback_check.py, tests/test_local_backup.py. Needs a person: release report and rollback exercise.

## Required negative cases and regression strategy

- Old 3.1 release-readiness NO-GO pertains to its historic candidate and is not overwritten by this programme; latest head needs new evidence.
- No automation should mark tasks Verified by checking boxes after docs merge.
- A release with good screenshots but wrong FLAC or inaccessible editor must remain NO-GO.
- Exercise light, dark and system themes; empty, loading, partial, ready, stale, failed, offline and recovering states where applicable.
- Exercise 320/375/390/430/768/1024/1280/1440/1920 CSS-pixel widths, short viewports, 200/400% zoom, keyboard, touch, reduced motion, realistic long/missing/duplicate/Unicode/RTL metadata.
- Maintain existing frontend, API, audio and Python assertions; changed markup may require selector updates but never weakened behavioural contracts.

## Preservation and dependencies

Retain the [existing Selecta 3.0 invariants INV-01–INV-20](selecta-3-roadmap.md) and [3.1 preservation contract](selecta-3-1-roadmap.md): no original-file mutation; local-first security and LRCLIB disclosure; no loss of current/draft state, preferences, corrections or ratings; stable old routes; one audio owner; exact request consent and atomic join; truthful requested-versus-rendered state; revision-pinned decodable FLAC; full keyboard alternatives and regression assertions. No backend, schema, audio-engine or dependency rewrite is authorized by this ADR. See [4.0 parity matrix](selecta-4-feature-parity.md) and [verification matrix](selecta-4-verification-matrix.md).

## Alternatives, risks and trade-offs

Strong gates slow public release but make high-stakes music and data workflows defensible.

## Evidence and advancement rules

An owner must separately **Accept** this decision before it becomes policy. Each implementing PR must name the S4-0113 task IDs, actual commit(s), changed files, pre-existing regression tests, new negative/concurrency cases, theme/viewport screenshots and relevant human/audible/AT evidence. **Implemented** requires merged code and applicable automated checks; **Verified** additionally requires independent real acceptance relevant to the change. An unchecked checkbox means not Verified. A docs merge does not advance these statuses.

## Status history

| Date | Decision | Implementation | Verification | Evidence |
|---|---|---|---|---|
| 2026-11-07 | Proposed | Not started | Not verified | Documentation-only specification; no runtime, test or UI changes |
| 2026-11-08 | Accepted | Not started | Not verified | Owner accepted all proposed ADRs ([#37](https://github.com/tochi-mba/selecta/pull/37)) |
| 2026-11-10 | Accepted | In progress (2/10) | Not verified | Source reconciliation against current code with focused tests run 2026-11-10; every task still needs independent verification |

## Related documents

- [Selecta 4.0 roadmap and ADR index](selecta-4-roadmap.md)
- [4.0 implementation checklist](selecta-4-implementation-checklist.md)
- [4.0 per-task evidence ledger](selecta-4-evidence.md)
- [4.0 verification and edge-case matrix](selecta-4-verification-matrix.md)
- [4.0 release readiness criteria](selecta-4-release-gates.md)
- [Earlier 3.1 implementation checklist](selecta-3-1-implementation-checklist.md)
