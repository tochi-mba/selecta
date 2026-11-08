# ADR-0059: Full Stem Studio workstation, grid interaction and commit safety

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** Not started
- **Documentation status:** Drafted in the Selecta 3.0 documentation-only proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.0 complete experience overhaul
- **Phase:** 4 — Creation workspaces
- **Extends existing decisions:** ADR-0016, ADR-0007, ADR-0041
- **Dependencies:** [programme roadmap](selecta-3-roadmap.md) and verified baseline; see phase order.
- **Work item statuses:** Every S3-0059-XX item below is **Not started**. No runtime feature, test or UI change is claimed by this ADR.

## Context and rationale

Stem Studio offers a 2-song/4-stem grid with 64 binary cells, immediate audition, solo, preset shapes, automatic arrange, fine-tune, restore previous and Apply render. Shrinking an entire grid into a dialog risks overflow, keyboard confusion, losing unfinished work or accidentally changing the wrong seam.

## Decision proposed

Make Studio a responsive focused workspace with permanent pair identity, aligned bar ruler, audition transport, two-song stem lanes and explicit working/recovered/committed/rendered states. Preserve all 64 cell controls, preset behavior, audio ownership and revision-bound commit.

## Experience and frontend architecture

- Separate real-time working shape from applied backend arrangement and ready rendered audio. Keep the bar ruler aligned during horizontal scrolling and lane labels visible. Mobile offers horizontal grid scrolling and deliberate controls without inventing unsupported per-beat audio precision.

- Use the WAI-ARIA grid pattern with a single tab stop, deterministic arrows/Home/End/Space, clear active/focus/solo feedback and accessible cell labels. Presets and automation preserve recoverable prior work; failed AI operations do not overwrite manual edits.

- Opening Studio auditions pauses the main mix through existing audio ownership. Closing/route changes respect user-intent flags; no preview may auto-resume playback after the user explicitly paused it.

## Detailed implementation work (all Not started)

1. **S3-0059-01 — Not started.** Build dedicated Studio workspace with persistent pair header and responsive transport.
2. **S3-0059-02 — Not started.** Redesign 64 cells, two songs, four stem lanes, selected/active/inactive/solo states and aligned bar labels.
3. **S3-0059-03 — Not started.** Implement accessible grid keyboard model, focus restoration and horizontal-scroll behavior.
4. **S3-0059-04 — Not started.** Keep stem preview, solo, preset shapes, auto-arrange, Fine tune mine and Restore previous operations.
5. **S3-0059-05 — Not started.** Separate dirty local shape, recovered local draft, backend committed shape and rendered audio status.
6. **S3-0059-06 — Not started.** Make Apply revision-checked and never attach a saved shape to an old or different pair.
7. **S3-0059-07 — Not started.** Handle partial stem availability, loading/error, preview failure and close during processing.
8. **S3-0059-08 — Not started.** Profile interaction responsiveness during background render and suppress excessive grid remounts.
9. **S3-0059-09 — Not started.** Exercise all cell positions, solo combinations, and playback interruptions with real audio evidence.

## Preservation and integration constraints

This work must preserve all applicable capabilities in [the existing feature-parity ledger](feature-parity.md): original source music and library data; drafts, user corrections, ratings and preferences; correct current-versus-draft mutation isolation; original routes; honest playable/render readiness; a single audio owner with no unintended stop or overlap; explicit request bridge consent and atomic insertion; accurate revision-bound FLAC; and secure localhost/origin privacy. New dependencies, API fields or native integration require separately reviewed contracts; the design does not itself authorize backend replacement.

## Required tests and edge-case verification (not yet executed)

- Matrix of all 64 cells and each lane state, arrows/Space/End, screen reader names and 200/400% zoom.
- Toggle, solo, navigate away, user pauses main, reopen/recover, commit after reordered pair; reject stale revision.
- AI arrange fails after local edits, browser storage unavailable, missing stems and partial load; original shape survives.

General test dimensions: dark and light; initial/populated/empty/partial/refreshing/busy/failed/offline/recovery; 320px–4K; zoom, pointer and keyboard; realistic long/missing/duplicate/RTL metadata; accessibility checks; stale response and race tests; representative local-audio playback where relevant. Existing tests may be adapted to accessible semantics but not deleted or weakened.

## Alternatives, risks and trade-offs

A full new audio arrangement engine or arbitrary DAW timeline would exceed UI scope. The existing binary-cell model remains canonical; improve its representation and interaction contract.

## Acceptance and evidence

An expert can edit, hear, recover and commit stems on the intended pair using pointer, touch and keyboard with no audio overlap or data loss.

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
