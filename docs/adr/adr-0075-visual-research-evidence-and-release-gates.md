# ADR-0075: Visual regression, usability research and observable release acceptance

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** Not started
- **Documentation status:** Drafted in the Selecta 3.0 documentation-only proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.0 complete experience overhaul
- **Phase:** 7 — Verification
- **Extends existing decisions:** ADR-0029, ADR-0046
- **Dependencies:** [programme roadmap](selecta-3-roadmap.md) and verified baseline; see phase order.
- **Work item statuses:** Every S3-0075-XX item below is **Not started**. No runtime feature, test or UI change is claimed by this ADR.

## Context and rationale

Aesthetic quality needs evidence beyond code and visual taste. Existing plans record incomplete real-screen, audio and human task verification; Selecta 3.0 must not label a documentation merge or green unit test as a successful overhaul.

## Decision proposed

Gate releases on deterministic visual coverage, measured task outcomes, accessibility/audible checks, UX defects triage and explicit evidence. Separate design-spec completion from implementation and actual user verification.

## Experience and frontend architecture

- Build screenshot sets for every route and major initial/empty/busy/failed/ready state in both themes and responsive widths. Freeze fixture data, fonts, clock and animations; review visual diffs rather than blanket update baselines.

- Conduct unguided listener/creator/expert tasks, record task completion, time, critical errors and confusion, and iterate after seeing actual failures. Compare task data to baseline without inventing success or setting arbitrary 'perfect' metrics.

- Maintain an evidence ledger with PR/commit/test/visual/audible/AT/manual owner and limitations. An accepted decision is not an implemented task, and a merged code PR is not automatically verified.

## Detailed implementation work (all Not started)

1. **S3-0075-01 — Not started.** Capture deterministic baseline screenshots and a coverage map of all meaningful states.
2. **S3-0075-02 — Not started.** Create visual regression infrastructure for dark/light, mobile/desktop, large text and overlays.
3. **S3-0075-03 — Not started.** Review screenshots under long/RTL/missing metadata, no art, loading, errors and network loss.
4. **S3-0075-04 — Not started.** Run structured new listener, creator and expert usability sessions on realistic content.
5. **S3-0075-05 — Not started.** Run manual screen-reader, keyboard and audio listening sessions with documented environments.
6. **S3-0075-06 — Not started.** Define P0/P1/P2 issue severity, triage ownership and release-blocking standards.
7. **S3-0075-07 — Not started.** Link CI, visual evidence, traces, measurements, study notes and rollback evidence to task ledger.
8. **S3-0075-08 — Not started.** Create a release-candidate go/no-go review explicitly listing unperformed checks and accepted limitations.
9. **S3-0075-09 — Not started.** Compare before/after interaction success without pretending aesthetic preference is objective proof.

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
