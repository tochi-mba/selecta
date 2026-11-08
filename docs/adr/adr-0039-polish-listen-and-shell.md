# ADR-0039: Calm listening hierarchy, stable transport and shell continuity

- **Decision status:** Accepted (owner requested implementation in PR #23)
- **Implementation status:** In progress ([#23](https://github.com/tochi-mba/selecta/pull/23))
- **Proposed:** 2026-11-06
- **Programme:** UI/UX polish
- **Delivery phase:** 3 - Core listening, mixes and requests
- **Extends:** [ADR-0002](adr-0002-routing-and-shell.md), [ADR-0006](adr-0006-audio-transport-and-media.md), [ADR-0007](adr-0007-audio-focus-ownership.md), [ADR-0008](adr-0008-listen-screen.md), [ADR-0009](adr-0009-lyrics-and-stage.md), [ADR-0031](adr-0031-pwa-and-browsers.md); does not silently supersede their behavioural contracts.
- **Dependencies:** ADR-0034 and ADR-0044 foundations, ADR-0035 shared controls and ADR-0036 asynchronous states. Apply ADR-0045 accessibility requirements during implementation.
- **Checklist:** P0061–P0069 in [polish implementation checklist](polish-implementation-checklist.md).

> The owner requested implementation in PR #23 after the planning review. Functionality is written first; verification follows. Checkboxes require actual evidence, including any remaining human checks.

## Context and evidence boundary

Listen combines view toggles, visualizer, beat countdown, waveform, lyrics, transport, requests, feedback and steering. Shell provides a desktop rail, mobile navigation and a mini-player. Preserve the existing functionality and audio contracts while refining hierarchy.

## Proposed decision and rationale

Prioritize song identity, stable transport and the next song; group optional viewing detail without removing it. Keep shell chrome, playback ownership, fullscreen and recovery coherent across navigation and installed-app use.

## Compatibility and product invariants

Preserve the existing feature and route inventory, local-first privacy, source files, drafts and ratings, explicit current/draft mutation scope, single audio ownership, bridge approval and atomic joining, and truthful export identity. Do not remove capability or weaken behavioural tests to obtain a cleaner screenshot. New API, schema, engine or platform work requires an explicitly scoped implementing change; this proposal alone does not authorize it.

## Implementation sequence and acceptance details

1. **P0061:** Define default Listen hierarchy and compact view controls while retaining lyrics focus, spectrum and beat countdown preferences.
2. **P0062:** Keep Play/Pause/Resume, next/previous and volume stable across loading, paused, playing and transition states.
3. **P0063:** Differentiate Next song from Jump to transition in labels, icons, tooltips and shortcut help.
4. **P0064:** Design missing lyrics, untimed lyrics, instrumental, missing beat-grid, failed details and last-song layouts intentionally.
5. **P0065:** Keep feedback and next-song changes from moving the transport; retain factual requested-versus-playable transition explanations.
6. **P0066:** Review waveform seek/transition markers, countdown units and non-colour cues at normal and high zoom.
7. **P0067:** Coordinate rail/bottom navigation, mini-player, banners, safe areas and keyboard focus across all routes.
8. **P0068:** Verify fullscreen entry/exit/rejection, restored view preferences and reduced-motion visualizer/countdown behaviour.
9. **P0069:** Verify deep links, Back/Forward, scroll restoration, missing routes/drafts, media keys, multi-tab takeover and installed-app layout without duplicate audio.

## Required tests and edge cases

Use the applicable cases in [the polish verification matrix](polish-verification-matrix.md), plus the task-specific cases above. Review both themes, loading-to-content transitions, narrow and wide layouts, keyboard/focus, long or missing metadata and failed/retried operations. For audio-affecting surfaces, include real audio ownership and continuity checks; for data-affecting actions, include current/draft identity and stale-response checks. Mark a case not applicable only with a recorded reason.

## Alternatives and trade-offs

A decorative deck interface adds cognitive load for an automatic DJ. Removing waveform, lyrics or steering would discard useful existing features; keep them available through deliberate views.

## Acceptance and status update

Listening and steering remain effortless, controls do not move unexpectedly, and navigation/fullscreen/preview transitions preserve the established audio behaviour.

The owner accepted proceeding with implementation in PR #23. Implementation progresses Not started → In progress → Implemented → Verified using linked evidence. Only implemented and verified work can satisfy runtime tasks. Record partial work and unperformed human checks in [the polish evidence ledger](polish-implementation-evidence.md); do not infer success from a checkbox in the previous programme.

| Date | Decision status | Implementation status | Evidence |
|---|---|---|---|
| 2026-11-06 | Proposed | Not started | Original documentation-only proposal |
| 2026-11-06 | Accepted | In progress | Owner requested full implementation and merge after green CI in PR #23; verification pending |

## References

- [Polish programme and roadmap](polish-roadmap.md)
- [Polish implementation checklist](polish-implementation-checklist.md)
- [Research and source-inspection notes](../research/ui-ux-polish.md)
- [Existing feature parity](feature-parity.md)
- [Existing test coverage](test-coverage-matrix.md)
