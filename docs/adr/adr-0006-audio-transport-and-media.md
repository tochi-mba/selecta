# ADR-0006: Web Audio transport, seeking and Media Session semantics

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** In progress ([#22](https://github.com/tochi-mba/selecta/pull/22))
- **Proposed:** 2026-11-06
- **Delivery phase:** 4
- **Scope:** Implemented in [#22](https://github.com/tochi-mba/selecta/pull/22). See its status above and the evidence file for anything left.

> The owner accepted this decision on 2026-11-08. Implementation and verification are tracked separately, task by task, in its checklist.

## Context

Current Skip intentionally approaches the next seam; headset Next normally means advance track. A standard-looking seek slider needs safe scheduler logic.

## Proposed decision and rationale

- Keep Jump to transition and add distinct Next track, Seek, Volume and Mute operations.
- Maintain sample-accurate Web Audio scheduling outside React render cycles.
- After seek, reschedule only valid future seams; never play an expired seam late.
- Represent audio already committed to a seam so UI cannot promise immediate retroactive edits.
- Map OS media controls to their actual conventional meanings, with feature detection.

## Compatibility and product invariants

- Gapless rendering/fallback, pause/resume, playback restoration and existing seam preview remain safe.
- No invalid transition can introduce unexpected silence.

## Implementation sequence

- Record current engine timing with real fixtures before modifying it.
- Ship transport behaviour only behind browser-level regression tests.

## Required tests and edge cases

- Autoplay denial, decode fail, seek before/after/during seam, last song, hidden tab, sleep, double Next, media-key race and already playing crossfade.

## Alternatives and trade-offs

Retaining the old UI permanently would avoid immediate migration risk but preserve the documented usability problems. A single simultaneous rewrite would be faster to describe but harder to verify and roll back. Implement this ADR incrementally, preserve the backend/audio contracts, and reject any proposal that cannot meet the stated invariants.

## Acceptance and status update

Implementation may move to **In progress** only when a linked implementation PR exists; to **Implemented** only when the intended behaviour and associated tests are merged; and to **Verified** only with relevant automated, browser, accessibility, audio and migration evidence recorded. The [feature-parity matrix](feature-parity.md) and [test plan](test-coverage-matrix.md) must be updated alongside it.

| Date | Decision status | Implementation status | Evidence |
|---|---|---|---|
| 2026-11-06 | Proposed | Not started | Documentation-only plan |
| 2026-11-06 | Proposed | In progress | [#22](https://github.com/tochi-mba/selecta/pull/22), with evidence in [implementation-evidence.md](implementation-evidence.md) |
| 2026-11-08 | Accepted | In progress | Owner accepted all proposed ADRs ([#37](https://github.com/tochi-mba/selecta/pull/37)) |

## References

- [ADR index](README.md)
- [Implementation roadmap](implementation-roadmap.md)
- [Existing acceptance ledger](../acceptance.md)
- [Existing UI/UX research](../research/ui-ux.md)
