# ADR-0007: Coordinating main player and all audition audio

- **Decision status:** Proposed
- **Implementation status:** In progress ([#22](https://github.com/tochi-mba/selecta/pull/22))
- **Proposed:** 2026-11-06
- **Delivery phase:** 4
- **Scope:** Implemented in [#22](https://github.com/tochi-mba/selecta/pull/22). See its status above and the evidence file for anything left.

> Merging this proposal does not mean the decision is accepted or the implementation has started. Update both statuses with a PR link and verification evidence when work actually occurs.

## Context

Main player, rendered seam previews, request bridges, lyrical/harmonic demos, Stem Studio and blind trials must not compete unpredictably.

## Proposed decision and rationale

- Create one audio-session coordinator with explicit owner and priority.
- A preview normally pauses the main set, but may not auto-resume after the user explicitly pauses or changes context.
- Unloading a view releases its preview, not unrelated audio sessions.
- Use actual rendered revision and readiness for previews; prevent stale clips from claiming to reflect new edits.

## Compatibility and product invariants

- Instant Studio local audition and A/B non-overlap are preserved.
- No unintended simultaneous independent playback.

## Implementation sequence

- Wrap current HTML audio and Web Audio helpers before reorganizing previews.
- Make resume intent explicit instead of guessing from initial play state.

## Required tests and edge cases

- Preview switch, modal close, route away, Pause during preview, failed decode, AudioContext suspension, two tabs and overlapping A/B attempts.

## Alternatives and trade-offs

Retaining the old UI permanently would avoid immediate migration risk but preserve the documented usability problems. A single simultaneous rewrite would be faster to describe but harder to verify and roll back. Implement this ADR incrementally, preserve the backend/audio contracts, and reject any proposal that cannot meet the stated invariants.

## Acceptance and status update

Implementation may move to **In progress** only when a linked implementation PR exists; to **Implemented** only when the intended behaviour and associated tests are merged; and to **Verified** only with relevant automated, browser, accessibility, audio and migration evidence recorded. The [feature-parity matrix](feature-parity.md) and [test plan](test-coverage-matrix.md) must be updated alongside it.

| Date | Decision status | Implementation status | Evidence |
|---|---|---|---|
| 2026-11-06 | Proposed | Not started | Documentation-only plan |
| 2026-11-06 | Proposed | In progress | [#22](https://github.com/tochi-mba/selecta/pull/22), with evidence in [implementation-evidence.md](implementation-evidence.md) |

## References

- [ADR index](README.md)
- [Implementation roadmap](implementation-roadmap.md)
- [Existing acceptance ledger](../acceptance.md)
- [Existing UI/UX research](../research/ui-ux.md)
