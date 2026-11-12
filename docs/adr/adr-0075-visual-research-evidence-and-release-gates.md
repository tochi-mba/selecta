# ADR-0075: Visual regression, usability research and observable release acceptance

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** In progress: 2 of 9 tasks implemented with automated evidence on 2026-11-12; 6 need a person; 1 still open
- **Documentation status:** Drafted in the Selecta 3.0 documentation-only proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.0 complete experience overhaul
- **Phase:** 7 - Verification
- **Extends existing decisions:** ADR-0029, ADR-0046
- **Dependencies:** [programme roadmap](selecta-3-roadmap.md) and verified baseline; see phase order.
- **Work item statuses:** Recorded on each item below (2026-11-11). Implemented means its automated evidence ran green; nothing here is independently Verified.

## Context and rationale

Aesthetic quality needs evidence beyond code and visual taste. Existing plans record incomplete real-screen, audio and human task verification; Selecta 3.0 must not label a documentation merge or green unit test as a successful overhaul.

## Decision proposed

Gate releases on deterministic visual coverage, measured task outcomes, accessibility/audible checks, UX defects triage and explicit evidence. Separate design-spec completion from implementation and actual user verification.

## Experience and frontend architecture

- Build screenshot sets for every route and major initial/empty/busy/failed/ready state in both themes and responsive widths. Freeze fixture data, fonts, clock and animations; review visual diffs rather than blanket update baselines.

- Conduct unguided listener/creator/expert tasks, record task completion, time, critical errors and confusion, and iterate after seeing actual failures. Compare task data to baseline without inventing success or setting arbitrary 'perfect' metrics.

- Maintain an evidence ledger with PR/commit/test/visual/audible/AT/manual owner and limitations. An accepted decision is not an implemented task, and a merged code PR is not automatically verified.

## Detailed implementation work

1. **S3-0075-01 - In progress.** Capture deterministic baseline screenshots and a coverage map of all meaningful states. **Status:** In progress: the surface inventory (docs/adr/mp-0272-surface-inventory.json) maps the states and web/e2e/mp-baseline.mp.ts captures them, but the baseline screenshots were not regenerated and compared in this session The pixel-diff gate for these states is web/e2e/s3-0075-visual-regression.e2e.ts (written 2026-11-11, browser check pending).
2. **S3-0075-02 - Implemented.** Create visual regression infrastructure for dark/light, mobile/desktop, large text and overlays. **Status:** Implemented; browser check passed (the 8 s3-0075-visual-regression.e2e.ts capture tests (light/dark x phone, desktop, 200% text, overlays) passed as review candidates (CI run 43119473767, Edge E2E (shard 2/2) job 130857753267, head f851f2b, recorded 2026-11-12); the pixel-diff comparison skips until the reviewed baseline folder exists) (web/e2e/s3-0075-visual-regression.e2e.ts, written 2026-11-11: toHaveScreenshot over Light and Dark, phone and desktop, 200% text and the palette and theme-menu overlays, with clock, motion, caret and live drawings frozen or masked; it skips until a reviewed baseline folder exists). Candidate captures also come from web/e2e/paired-theme.e2e.ts and web/e2e/visual.e2e.ts. Needs a person: create, review and commit the baseline pictures.
3. **S3-0075-03 - Needs a person.** Review screenshots under long/RTL/missing metadata, no art, loading, errors and network loss. **Status:** Needs a person: a person reviewing screenshots under long, right-to-left and missing metadata, no art, loading, errors and network loss
4. **S3-0075-04 - Needs a person.** Run structured new listener, creator and expert usability sessions on realistic content. **Status:** Needs a person: structured usability sessions with a new listener, a creator and an expert on realistic content
5. **S3-0075-05 - Needs a person.** Run manual screen-reader, keyboard and audio listening sessions with documented environments. **Status:** Needs a person: manual screen-reader, keyboard and audio listening sessions with their environments recorded (docs/adr/selecta-3-accessibility.md 'Scripts for a person')
6. **S3-0075-06 - Implemented.** Define P0/P1/P2 issue severity, triage ownership and release-blocking standards. **Evidence:** docs/adr/selecta-3-baseline.md 'How issues are judged' (P0, P1 and P2 with what each blocks) and 'How work moves and who decides'; docs/adr/selecta-3-verification-matrix.md release disposition; tests/test_s3_docs_contracts.py test_severity_delivery_order_and_gates_are_written_down (passed 2026-11-11).
7. **S3-0075-07 - Implemented.** Link CI, visual evidence, traces, measurements, study notes and rollback evidence to task ledger. **Evidence:** this checklist and docs/adr/selecta-3-evidence.md carry each task's evidence; src/selecta/audit/checklist_evidence.py, run in CI ('Reject checked tasks without evidence'), refuses a tick without it (passed 2026-11-11).
8. **S3-0075-08 - Needs a person.** Create a release-candidate go/no-go review explicitly listing unperformed checks and accepted limitations. **Status:** Needs a person: a release-candidate go or no-go review by the owner, listing unperformed checks and accepted limitations
9. **S3-0075-09 - Needs a person.** Compare before/after interaction success without pretending aesthetic preference is objective proof. **Status:** Needs a person: before and after task-success comparisons with participants

## Preservation and integration constraints

This work must preserve all applicable capabilities in [the existing feature-parity ledger](feature-parity.md): original source music and library data; drafts, user corrections, ratings and preferences; correct current-versus-draft mutation isolation; original routes; honest playable/render readiness; a single audio owner with no unintended stop or overlap; explicit request bridge consent and atomic insertion; accurate revision-bound FLAC; and secure localhost/origin privacy. New dependencies, API fields or native integration require separately reviewed contracts; the design does not itself authorize backend replacement.

## Required tests and edge-case verification (not yet executed)

- Intentional screenshot difference requires recorded review; accidental offset caught on mobile.
- Empty/errored/loading content all visually reviewed, not only happy path.
- Human test can identify a blind spot even with all automated tests green; issue blocks release based on severity.

General test dimensions: dark and light; initial/populated/empty/partial/refreshing/busy/failed/offline/recovery; 320px–4K; zoom, pointer and keyboard; realistic long/missing/duplicate/RTL metadata; accessibility checks; stale response and race tests; representative local-audio playback where relevant. Existing tests may be adapted to accessible semantics but not deleted or weakened.

## Alternatives, risks and trade-offs

Ship after a screenshot review: faster but hides interaction and audio defects. Require measured evidence and explicitly reviewed exceptions.

## Acceptance and evidence

The release record supports each claimed improvement with actual evidence; any unverified essential flow prevents Verified status.

Before marking **Implemented**, link implementing PR(s), commit(s), contract tests, component/integration/E2E tests, screenshots and rollback disposition in [the evidence ledger](selecta-3-evidence.md). Before marking **Verified**, additionally record human task testing, assistive technology and audible checks wherever the change affects them. No prospective metric is a completed observation.

## Status history

| Date | Decision | Implementation | Evidence |
|---|---|---|---|
| 2026-11-07 | Proposed | Not started | Documentation-only ADR; no application or test changes |
| 2026-11-08 | Accepted | Not started | Owner accepted all proposed ADRs ([#37](https://github.com/tochi-mba/selecta/pull/37)) |

## References

- [Selecta 3.0 roadmap and ADR status index](selecta-3-roadmap.md)
- [Selecta 3.0 implementation checklist](selecta-3-implementation-checklist.md)
- [Selecta 3.0 verification matrix](selecta-3-verification-matrix.md)
- [Prior feature preservation contract](feature-parity.md)
- [Prior test coverage](test-coverage-matrix.md)
