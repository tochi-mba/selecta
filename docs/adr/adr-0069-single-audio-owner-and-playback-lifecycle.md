# ADR-0069: Single audio ownership, transport continuity and preview lifecycle

- **Decision status:** Proposed
- **Implementation status:** Not started
- **Documentation status:** Drafted in the Selecta 3.0 documentation-only proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.0 complete experience overhaul
- **Phase:** 6 — Cross-cutting quality
- **Extends existing decisions:** ADR-0006, ADR-0007, ADR-0028
- **Dependencies:** [programme roadmap](selecta-3-roadmap.md) and verified baseline; see phase order.
- **Work item statuses:** Every S3-0069-XX item below is **Not started**. No runtime feature, test or UI change is claimed by this ADR.

## Context and rationale

Main playback, transition previews, Requests, Stem Studio, harmonic audition and blind studies compete for audio focus. The existing audio/focus.ts guarantees conditional pause/resume, but a broad React reconstruction risks introducing unmount races, overlapping sound and unexpected resume.

## Decision proposed

Retain one audio-focus authority and make all new preview controls comply with it. Presentation components may mount and unmount freely, but transport should not. User-originated pause/seek/skip takes precedence over automatic resume after a preview.

## Experience and frontend architecture

- Main player is a stable app-scoped service. Preview ownership uses unique session IDs and lifecycle cancellation so an old preview completion cannot release a new owner's audio. The application never auto-resumes the mix after explicit user intervention.

- Auditioning a seam or chord temporarily pauses the main mix if appropriate. On preview completion, resume only according to the focus service's verified intent rules. A Study A/B change stops the previous clip before starting the next.

- Multi-tab arbitration and Media Session remain consistent. All new route transitions, dialogs and Stage UI must not inadvertently call playback constructors or duplicate audio elements.

## Detailed implementation work (all Not started)

1. **S3-0069-01 — Not started.** Document transport and preview focus state machine including idle, playing, paused, previewing and user-interrupted.
2. **S3-0069-02 — Not started.** Audit every audio call site in Listen, editor, Requests, Discovery, Studio, Study and Export UI.
3. **S3-0069-03 — Not started.** Use stable owner IDs and cleanup to prevent stale onended/onerror events releasing new playback.
4. **S3-0069-04 — Not started.** Test play/pause/skip/seek by user while preview is active, then preview end/route unmount.
5. **S3-0069-05 — Not started.** Retain Media Session metadata/actions and multi-tab takeover safeguards.
6. **S3-0069-06 — Not started.** Verify no audio element duplication during React StrictMode and responsive view swaps.
7. **S3-0069-07 — Not started.** Measure actual seam scheduling continuity separately from UI animation.
8. **S3-0069-08 — Not started.** Define audio-failure recovery for rejected play(), decode failure, suspended context and missing sources.
9. **S3-0069-09 — Not started.** Keep visual playback status synchronized with actual transport rather than optimistic guesses.

## Preservation and integration constraints

This work must preserve all applicable capabilities in [the existing feature-parity ledger](feature-parity.md): original source music and library data; drafts, user corrections, ratings and preferences; correct current-versus-draft mutation isolation; original routes; honest playable/render readiness; a single audio owner with no unintended stop or overlap; explicit request bridge consent and atomic insertion; accurate revision-bound FLAC; and secure localhost/origin privacy. New dependencies, API fields or native integration require separately reviewed contracts; the design does not itself authorize backend replacement.

## Required tests and edge-case verification (not yet executed)

- Preview A then B, navigate, explicit Pause, late A ended, screen hidden; no overlap or unexpected resume.
- Tab A playing then tab B takes over; return to A with stale Media Session event.
- Audio context suspended, browser autoplay denial, missing audio, queued render, end-of-set and seek across seam.

General test dimensions: dark and light; initial/populated/empty/partial/refreshing/busy/failed/offline/recovery; 320px–4K; zoom, pointer and keyboard; realistic long/missing/duplicate/RTL metadata; accessibility checks; stale response and race tests; representative local-audio playback where relevant. Existing tests may be adapted to accessible semantics but not deleted or weakened.

## Alternatives, risks and trade-offs

Allow each page to own its own media element: easier locally but violates Selecta's intentional one-owner design. Reuse the existing coordinator with stronger tests.

## Acceptance and evidence

A real-browser audible test demonstrates only one active owner and zero unexpected playback restarts across every new surface.

Before marking **Implemented**, link implementing PR(s), commit(s), contract tests, component/integration/E2E tests, screenshots and rollback disposition in [the evidence ledger](selecta-3-evidence.md). Before marking **Verified**, additionally record human task testing, assistive technology and audible checks wherever the change affects them. No prospective metric is a completed observation.

## Status history

| Date | Decision | Implementation | Evidence |
|---|---|---|---|
| 2026-11-07 | Proposed | Not started | Documentation-only ADR; no application or test changes |

## References

- [Selecta 3.0 roadmap and ADR status index](selecta-3-roadmap.md)
- [Selecta 3.0 implementation checklist](selecta-3-implementation-checklist.md)
- [Selecta 3.0 verification matrix](selecta-3-verification-matrix.md)
- [Prior feature preservation contract](feature-parity.md)
- [Prior test coverage](test-coverage-matrix.md)
