# ADR-0058: Context-preserving seam inspector, exact cues and honest rendered outcome

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** Not started
- **Documentation status:** Drafted in the Selecta 3.0 documentation-only proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.0 complete experience overhaul
- **Phase:** 4 - Creation workspaces
- **Extends existing decisions:** ADR-0014, ADR-0016, ADR-0027, ADR-0040
- **Dependencies:** [programme roadmap](selecta-3-roadmap.md) and verified baseline; see phase order.
- **Work item statuses:** Every S3-0058-XX item below is **Not started**. No runtime feature, test or UI change is claimed by this ADR.

## Context and rationale

The current inspector has Listen, Change, Studio and Details tabs, manual cue and transition-style choices, preview, fallback, Good/Bad and a renderer audit. These powerful functions are too easily conflated with one another when an old render finishes after the user changes intent.

## Decision proposed

Keep the four feature families but redesign around permanent outgoing/incoming song identity and layered requested, in-flight, rendered and audible state. Editing precision must never silently rewrite the user's chosen style or cue.

## Experience and frontend architecture

- Keep a pair header visible while scrolling and expose current/draft identity. The Listen tab owns a revision-aware preview; Change groups feel, duration, phrase and entry/exit cues; Studio routes to its full workspace; Details distinguishes recommended, requested, actual fallback and the evidence for each.

- Disable impossible choices with a truthful reason and show valid cue ranges. Any frontend Apply step must be weighed against actual render cost and previous interaction efficiency. Avoid rerender per incidental focus change; preserve explicit intent until confirmation or a safe revert.

- The inspector sheet on mobile restores timeline focus and scroll on close. A selected pair that disappears after reorder/removal must not mutate an adjacent pair.

## Detailed implementation work (all Not started)

1. **S3-0058-01 - Not started.** Design an always-visible pair identity header with exact scope, selection and renderer revision.
2. **S3-0058-02 - Not started.** Implement Listen tab with revision-matched preview and single audio-owner behavior.
3. **S3-0058-03 - Not started.** Group Change controls by style, length and exact cue with accessible form validation.
4. **S3-0058-04 - Not started.** Preserve all existing seam styles, phrase alignment, bar lengths, out/in positions, warnings and fallback options.
5. **S3-0058-05 - Not started.** Expose requested/manual versus actual rendered/fallback state without conflating readiness.
6. **S3-0058-06 - Not started.** Keep Details audit hierarchy: actual move, selected move, music data, failed alternatives, quality checks.
7. **S3-0058-07 - Not started.** Make transition ratings identify the precise seam and survive route switching.
8. **S3-0058-08 - Not started.** Rebuild mobile inspector as a focus-safe sheet/workspace without losing timeline context.
9. **S3-0058-09 - Not started.** Add stale-render, exact-pair, cue-invalid and preview-cancellation tests.

## Preservation and integration constraints

This work must preserve all applicable capabilities in [the existing feature-parity ledger](feature-parity.md): original source music and library data; drafts, user corrections, ratings and preferences; correct current-versus-draft mutation isolation; original routes; honest playable/render readiness; a single audio owner with no unintended stop or overlap; explicit request bridge consent and atomic insertion; accurate revision-bound FLAC; and secure localhost/origin privacy. New dependencies, API fields or native integration require separately reviewed contracts; the design does not itself authorize backend replacement.

## Required tests and edge-case verification (not yet executed)

- Change style during render, then receive old result; never rewrite new intent or wrongly label audio.
- Remove selected track while inspector is open; old actions must not target another seam.
- Manual cue invalid for style; fallback while playing; preview begins then user pauses main mix; no unexpected auto-resume.

General test dimensions: dark and light; initial/populated/empty/partial/refreshing/busy/failed/offline/recovery; 320px–4K; zoom, pointer and keyboard; realistic long/missing/duplicate/RTL metadata; accessibility checks; stale response and race tests; representative local-audio playback where relevant. Existing tests may be adapted to accessible semantics but not deleted or weakened.

## Alternatives, risks and trade-offs

A single 'AI improves transition' button would hide exact expert control; exposing raw renderer internals by default overwhelms listeners. Progressive control and truthful diagnostics preserve both.

## Acceptance and evidence

The interface always identifies exactly which audio and cue settings were requested, rendered, previewed and committed.

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
