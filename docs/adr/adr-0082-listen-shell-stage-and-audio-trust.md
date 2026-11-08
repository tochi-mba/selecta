# ADR-0082: Polish Listen, navigation, mini-player and Stage without audio regressions

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** In progress on PR #25 (selected sub-tasks only; none Verified)
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.1 verification-led UI/UX finishing (proposal initially docs-only)
- **Phase:** 2 — listener journeys
- **Extends:** ADR-0048, ADR-0049, ADR-0055, ADR-0069. No inherited task is automatically complete.
- **Dependencies:** ADRs 0078–0080; shared visual hierarchy.
- **Checklist:** S31-0082-01 through S31-0082-11 in [the 3.1 checklist](selecta-3-1-implementation-checklist.md).

## Context and verified source boundary

Relevant current repository surfaces: `web/src/views/Now.tsx`, `web/src/shell/{Shell,manifest}.tsx`, `web/src/styles/{shell,listening,tokens}.css`, `web/src/{player.ts,router.ts}`, `web/src/audio/focus.ts`. Source inspection and the existing 3.0 documentation establish the available controls and contracts; they do **not** establish rendered quality, human usability, screen-reader conformance or subjective audio quality. The source baseline is the 3.0 merge `3b01dc1336aab0f1cb0a4d85be5eba359de81831`. All new work is proposed.

## Proposed decision

Present current song and transport first, next transition second, optional visualizations and advanced steering third. Keep an accurate seek/transition truth, maintain persistent audio ownership across routes and tabs, and avoid bottom bar/keyboard obstruction.

## Non-negotiable preservation

Preserve [Selecta 3.0 invariants INV-01–INV-20](selecta-3-roadmap.md): music and metadata safety; local-first Host/Origin boundaries and accurate LRCLIB disclosure; all routes and old aliases; stable current/draft identity and guarded writes; persisted drafts, corrections and preferences; single-owner playback and previews; explicit atomic bridge consent; truthful seam/readiness; authentic revision-pinned FLAC; keyboard/AT alternatives; and complete behavioural regression assertions. This ADR does not authorize changing the audio engine, backend, schema or runtime code.

## Tasks, observable acceptance and traceable ID

1. **S31-0082-01 — Review primary hierarchy across Listen playing/paused/empty/error states.** Acceptance: Song, artist, progress, Play/Pause and Next are immediately recognizable; optional controls do not compete.
2. **S31-0082-02 — Test Next versus Skip semantics and transition countdown wording.** Acceptance: Users understand whether the next song is immediate or transition-aligned without changing transport behaviour.
3. **S31-0082-03 — Verify waveform seek and disabled-seek feedback with real audio.** Acceptance: Time, output and accessibility value agree; unavailable areas explain why.
4. **S31-0082-04 — Review timed/untimed/instrumental/missing lyrics presentation.** Acceptance: Readable line and word focus; no fabricated timing; explicit no-lyrics fallback.
5. **S31-0082-05 — Review Spectrum, Beat countdown, Lyrics focus and Why disclosure.** Acceptance: View options are discoverable but do not obscure transport, player state or song title.
6. **S31-0082-06 — Review next-song, steering, rating and requests grouping.** Acceptance: Users can inspect the next song and shape energy without mistaking a preview for a live edit.
7. **S31-0082-07 — Re-test mini-player and bottom nav geometry at narrow widths.** Acceptance: No overlap or obscured last row at 320–430px, short height, orientation or display safe area.
8. **S31-0082-08 — Verify visual keyboard and focus changes on narrow screens.** Acceptance: Input is visible, navigation/player step away predictably, and focus resumes correctly.
9. **S31-0082-09 — Verify Stage fullscreen denial and exit fallbacks.** Acceptance: Exit/Escape work, focus returns, audio continues, reduced motion and announcements remain appropriate.
10. **S31-0082-10 — Exercise main/preview/multi-tab audio ownership on real media.** Acceptance: One active owner, no unintended overlap, silence, play restart or surprise resume.
11. **S31-0082-11 — Review route, history, breadcrumbs and deep-link continuity.** Acceptance: Listen and mini-player survive page navigation, Back/Forward and old aliases with correct page titles.

## Required adverse cases and evidence

- A beautiful playback control that misrepresents transport is a P0 defect.
- Audio focus/resume semantics must not be altered casually by UI rerenders.
- Stage and mobile layouts may create focus/scroll conflicts.

For each applicable task, capture a fixture/viewport/theme and observable pass/fail, plus keyboard/AT, real audio, performance, security, persistence or backend-contract evidence when relevant. A visual-only improvement cannot weaken prior behaviour. Record untested cases as pending and explicitly justify N/A. Reuse [the 3.1 verification matrix](selecta-3-1-verification-matrix.md) and [the evidence ledger](selecta-3-1-evidence.md).

## Alternatives and trade-offs

Less always-visible detail improves attention, but lyrics, Why, waveform, steering, rating and Stage remain one obvious action away.

## Decision and implementation boundary

The owner accepted this decision on 2026-11-08. Every S31 task remains **Not started**. A later implementation PR must name the task ID, acceptance, real implementation commit, negative cases, linked old S3 task/parity row and evidence. **Implemented** requires merged code and required automated checks; **Verified** additionally requires the human evidence relevant to that task. The initial proposal was documentation-only. PR #25 now includes limited frontend and component-test changes on selected workstreams. None of the tasks is Implemented or Verified; follow the evidence ledger for exact In-progress IDs.

## Status history

| Date | Decision | Implementation | Evidence |
|---|---|---|---|
| 2026-11-07 | Proposed | Not started | Original documentation-only finishing plan |\n| 2026-11-07 | Proposed | In progress | Selected UI/test code now on PR #25; complete verification still outstanding |
| 2026-11-08 | Accepted | Not started | Owner accepted all proposed ADRs ([#37](https://github.com/tochi-mba/selecta/pull/37)) |

## Related documents

- [Selecta 3.1 roadmap](selecta-3-1-roadmap.md)
- [3.1 implementation checklist](selecta-3-1-implementation-checklist.md)
- [3.1 verification matrix](selecta-3-1-verification-matrix.md)
- [3.1 evidence ledger](selecta-3-1-evidence.md)
- [3.0 roadmap and invariant contract](selecta-3-roadmap.md)
- [3.0 implementation status](selecta-3-evidence.md)
- [Research and confidence boundary](../research/selecta-3-1-polish.md)
