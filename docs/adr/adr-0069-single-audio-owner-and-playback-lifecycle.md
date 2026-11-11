# ADR-0069: Single audio ownership, transport continuity and preview lifecycle

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** In progress: 9 of 9 tasks implemented with automated evidence on 2026-11-11; 0 need a person; 0 still open
- **Documentation status:** Drafted in the Selecta 3.0 documentation-only proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.0 complete experience overhaul
- **Phase:** 6 - Cross-cutting quality
- **Extends existing decisions:** ADR-0006, ADR-0007, ADR-0028
- **Dependencies:** [programme roadmap](selecta-3-roadmap.md) and verified baseline; see phase order.
- **Work item statuses:** Recorded on each item below (2026-11-11). Implemented means its automated evidence ran green; nothing here is independently Verified.

## Context and rationale

Main playback, transition previews, Requests, Stem Studio, harmonic audition and blind studies compete for audio focus. The existing audio/focus.ts guarantees conditional pause/resume, but a broad React reconstruction risks introducing unmount races, overlapping sound and unexpected resume.

## Decision proposed

Retain one audio-focus authority and make all new preview controls comply with it. Presentation components may mount and unmount freely, but transport should not. User-originated pause/seek/skip takes precedence over automatic resume after a preview.

## Experience and frontend architecture

- Main player is a stable app-scoped service. Preview ownership uses unique session IDs and lifecycle cancellation so an old preview completion cannot release a new owner's audio. The application never auto-resumes the mix after explicit user intervention.

- Auditioning a seam or chord temporarily pauses the main mix if appropriate. On preview completion, resume only according to the focus service's verified intent rules. A Study A/B change stops the previous clip before starting the next.

- Multi-tab arbitration and Media Session remain consistent. All new route transitions, dialogs and Stage UI must not inadvertently call playback constructors or duplicate audio elements.

## Detailed implementation work

1. **S3-0069-01 - Implemented.** Document transport and preview focus state machine including idle, playing, paused, previewing and user-interrupted. **Evidence:** docs/adr/selecta-3-audio.md 'States' and 'Transitions' (idle, playing, paused, previewing, user-interrupted, another tab); tests/test_s3_docs_contracts.py test_the_audio_states_and_failures_are_written_down; the machine itself in web/src/audio/focus.test.tsx 'starting a preview pauses the mix, and it carries on afterwards' and 'never restarts the mix after someone has pressed something themselves' (passed 2026-11-11).
2. **S3-0069-02 - Implemented.** Audit every audio call site in Listen, editor, Requests, Discovery, Studio, Study and Export UI. **Evidence:** docs/adr/selecta-3-audio.md 'Every place that makes sound' (rerun 2026-11-11, now naming the device speaker and Cloud player too); tests/test_s3_docs_contracts.py test_every_place_that_starts_sound_is_in_the_audio_audit; web/src/singleOwner.test.ts 'previews share one audio element, and only the player and the Studio open an audio context' (passed 2026-11-11).
3. **S3-0069-03 - Implemented.** Use stable owner IDs and cleanup to prevent stale onended/onerror events releasing new playback. **Evidence:** web/src/audio/focusEdges.test.tsx 'an older play() rejecting late (AbortError) never brings the mix in under the newer clip' and 'taking the sound for B stops A first, and only one owner exists at any moment'; web/src/audio/focus.test.tsx 'something that lost the sound can’t let go of someone else’s'; web/src/audio/s4OwnerModel.test.ts 'holds every audio-owner invariant across 120 seeded runs' (passed 2026-11-11).
4. **S3-0069-04 - Implemented.** Test play/pause/skip/seek by user while preview is active, then preview end/route unmount. **Evidence:** web/src/audio/focus.test.tsx 'never restarts the mix after someone has pressed something themselves', 'leaving the page lets the sound go, and the mix carries on' and 'does not revive a mix after the listener pauses while a slow suspension is pending'; web/src/audio/focusEdges.test.tsx 'twenty fast switches leave exactly the last preview playing and the mix waiting' (passed 2026-11-11).
5. **S3-0069-05 - Implemented.** Retain Media Session metadata/actions and multi-tab takeover safeguards. **Evidence:** web/src/audio/mediaSession.test.ts 'follows the current song, rejects invalid seeks and refuses seeking during a seam', 'never starts an empty mix or hijacks a preview, and clears media actions on unmount' and 'reports real position and metadata only when a track owns the session'; web/src/audio/focusEdges.test.tsx 'taking the sound tells other tabs, and another tab playing is heard here' (passed 2026-11-11).
6. **S3-0069-06 - Implemented.** Verify no audio element duplication during React StrictMode and responsive view swaps. **Evidence:** web/src/audio/s3-0069-strict.test.tsx 'a StrictMode mount and a layout swap make no AudioContext and no audio element before Play' and 'every press reaches the same player, and no audio element or context is added' (passed 2026-11-11).
7. **S3-0069-07 - Implemented.** Measure actual seam scheduling continuity separately from UI animation. **Evidence:** web/src/audio/transportEdges.test.ts 'a ready seam overlaps outgoing song, clip and incoming song with no gap' and 'a fallback fade brings the next song in before this one ends', which read the scheduled AudioBufferSourceNode start times with no animation involved, as docs/adr/selecta-3-audio.md 'What was deliberately not changed' records (passed 2026-11-11).
8. **S3-0069-08 - Implemented.** Define audio-failure recovery for rejected play(), decode failure, suspended context and missing sources. **Evidence:** docs/adr/selecta-3-audio.md 'When audio fails'; web/src/audio/transportEdges.test.ts 'a song whose audio cannot be decoded stops with an honest reason' and 'a system suspension shows as paused, never resumes by itself, and resumes in place on Play'; web/src/audio/focus.test.tsx 'says so if it can’t play, and gives the sound back'; web/src/audio/focusEdges.test.tsx 'a context that refuses to resume leaves the mix paused without an unhandled rejection' and 'a clip that errors while loading says so and gives the sound back to the mix' (passed 2026-11-11).
9. **S3-0069-09 - Implemented.** Keep visual playback status synchronized with actual transport rather than optimistic guesses. **Evidence:** web/src/audio/transportWords.test.tsx 'the mini-player and Listen agree on song, phase and time while ...' and 'an interrupted output says why on the mini-player as well as on Listen, and only while stopped'; web/src/audio/outputInterruptions.test.ts 'the system taking the sound away is a visible pause, not a pretend play' (passed 2026-11-11).

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
| 2026-11-08 | Accepted | Not started | Owner accepted all proposed ADRs ([#37](https://github.com/tochi-mba/selecta/pull/37)) |

## References

- [Selecta 3.0 roadmap and ADR status index](selecta-3-roadmap.md)
- [Selecta 3.0 implementation checklist](selecta-3-implementation-checklist.md)
- [Selecta 3.0 verification matrix](selecta-3-verification-matrix.md)
- [Prior feature preservation contract](feature-parity.md)
- [Prior test coverage](test-coverage-matrix.md)
