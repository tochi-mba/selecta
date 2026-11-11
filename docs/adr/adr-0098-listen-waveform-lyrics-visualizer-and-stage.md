# ADR-0098: Listening-first Now view, accurate waveform, lyrics, spectrum and Stage

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** 8/10 Implemented, 2 In progress (per-task source and test reconciliation 2026-11-10; updated 2026-11-11)
- **Verification status:** Not verified (0/10)
- **Documentation status:** Drafted, documentation-only Selecta 4.0 proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 4.0 complete UI/UX overhaul
- **Phase:** 4 Listen
- **Extends, does not automatically supersede:** ADR-0008, ADR-0009, ADR-0055, ADR-0082
- **Source surfaces to reconcile:** `web/src/views/Now.tsx`; `web/src/views/Now.tsx (Stage view)`; `web/src/styles/listening.css`
- **Tasks:** S4-0098-01 through S4-0098-10 in [the Selecta 4.0 checklist](selecta-4-implementation-checklist.md)
- **Baseline:** `main` `9b663f9f10212619f27ce67ce82f602347065cbd` (after merged PRs #25 and #26)

## Context and evidence boundary

The main listening page should put music first while exposing precise DJ timing without overwhelming novices. Timed lyrics, waveform, spectrum and next transition need a consistent hierarchy.

This is a **proposal**. Source inspection and earlier planning documents establish current contracts and candidate risks; they do not establish verified visual quality, human task success, real audio quality, screen-reader usability or shipped implementation of this ADR. Earlier programme status headings can be stale and are not inherited as verified work.

## Proposed decision

Offer one default listening-focused composition and an optional DJ detail preference. Keep identical transport and all advanced controls; improve state clarity, precise markers, lyrics readability and fullscreen accessibility.

## Experience, frontend and interaction specification

- Primary order: song/artist, Play/Pause/progress, waveform, lyric/visualizer preference, Up next, Bigger/Calmer/Something else, rating.
- Layer waveform played/unplayed/playhead/transition/structure with keyboard seeking and disabled regions.
- Lyric line focus is calm with accurate timed/untimed/instrumental states and reduced-motion alternatives.
- Stage retains working controls/escape when browser refuses fullscreen; no double player.

## Detailed implementation work

1. **S4-0098-01 - Rebuild Listen hierarchy for idle/playing/paused/transition.** Acceptance: Transport and current song are immediate and readable. Required verification: Real media listener testing. **Implementation: Implemented (2026-11-10). Evidence: `web/src/views/Now.test.tsx`; `web/e2e/listen.e2e.ts` play/pause/resume; `web/e2e/pages.e2e.ts` 'on a phone, Listen keeps display options after the song identity and transport', run 2026-11-10. Verified: No. Needs a person: real-media listener testing.**
2. **S4-0098-02 - Add optional DJ detail without branching audio behaviour.** Acceptance: All core actions remain in both views. Required verification: Preference change while playing E2E. **Implementation: Implemented (2026-11-10). Evidence: `web/src/views/Now.test.tsx` 'keeps expert view controls discoverable without competing with playback'; `web/e2e/creative-visualizers.e2e.ts` 'all thirteen additional horizontal visualizers are selectable without restarting real audio', run 2026-11-10. Verified: No.**
3. **S4-0098-03 - Redesign waveform layers and seek semantics.** Acceptance: Rendered markers correspond to real audio and controls report exact values. Required verification: Seek near start/end, non-seekable clip and metadata tests. **Implementation: Implemented (2026-11-10). Evidence: `web/src/views/Now.test.tsx` 'shows bars and the current beat against the analyzed grid', 'previews the target without seeking until release', 'keeps a finite, disabled slider'; `web/e2e/listen.e2e.ts` seeking tests, run 2026-11-10. Verified: No.**
4. **S4-0098-04 - Improve lyric typography, active line and auto-scroll.** Acceptance: Long/missing/untimed/RTL text is readable without jumping. Required verification: Lyric fixtures, reduced motion, visual screenshots. **Implementation: In progress (2026-11-10). Evidence: `web/src/views/Now.test.tsx` timed, untimed and static lyric sheet tests; `web/e2e/finishing.e2e.ts` reduced motion; no RTL lyric fixture yet. Verified: No. Needs a person: visual lyric screenshot review.**
5. **S4-0098-05 - Contain visualizer canvas work and theme redraw.** Acceptance: No excessive React renders or frame work when hidden. Required verification: Profile plus light/dark switch while playing. **Implementation: In progress (2026-11-10). Evidence: `web/src/views/spectrumVisuals.test.ts` measured-only geometry; `web/src/views/Studio.test.tsx` hidden-tab stop; hidden-canvas frame work is not yet measured. Verified: No. Needs a person: profile while switching theme.**
6. **S4-0098-06 - Clarify Up next and pending requests.** Acceptance: Future plan is not falsely promised when request may alter order. Required verification: Request join near transition E2E. **Implementation: Implemented (2026-11-10). Evidence: `web/src/views/RequestsJoining.test.tsx` 'does not promise joining before the next valid opening', 'isn't shown once nothing is playing'; `web/e2e/flows.e2e.ts` requests flow, run 2026-11-10. Verified: No.**
7. **S4-0098-07 - Clarify Bigger/Calmer/Something else intent and feedback.** Acceptance: Accepted request distinct from successful track selection. Required verification: Steering failure/stale-race tests. **Implementation: Implemented (2026-11-11). Evidence: `web/src/views/Now.tsx` steering result wording; `web/src/views/s4ListenSteering.test.tsx` 'a different song chosen is announced as the new next song', 'an accepted request that keeps the same song says so, and never claims a swap', 'a refused request shows the reason and announces no new song'; `web/src/views/Now.test.tsx` overlapping-press guard, run 2026-11-11 (vitest, passed). Verified: No.**
8. **S4-0098-08 - Tie feedback/rating to actually heard transition identity.** Acceptance: Late rating never attaches to newer transition. Required verification: Rating key and cross-song tests. **Implementation: Implemented (2026-11-11). Evidence: `web/src/views/s4ListenSteering.test.tsx` 'a late rating answer never attaches to a newer transition'; `web/src/player.test.ts` 'records actual exposure across seeks', run 2026-11-11 (vitest, passed). Verified: No.**
9. **S4-0098-09 - Redesign Stage focus/fullscreen and long-song display.** Acceptance: Escape/fallback and resume focus work without audio interruption. Required verification: Fullscreen denial, small screen, keyboard tests. **Implementation: Implemented (2026-11-10). Evidence: `web/e2e/finishing.e2e.ts` fullscreen refused test; `web/e2e/listen.e2e.ts` 'lyrics follow the song, and the fullscreen view keeps everything working', run 2026-11-10. Verified: No. Needs a person: small-screen review.**
10. **S4-0098-10 - Create honest Listen empty/no lyrics/missing-media states.** Acceptance: No Explore content silently under Listen URL; no fabricated playback. Required verification: Deep-link, empty and fault injection tests. **Implementation: Implemented (2026-11-10). Evidence: `web/src/App.test.tsx` 'says so rather than showing an empty mix in silence'; `web/e2e/listen.e2e.ts` 'a song's audio going missing says so', run 2026-11-10. Verified: No.**

## Required negative cases and regression strategy

- Seek during crossfade or missing rendered clip; media clock must not display NaN.
- Timed lyrics update frequently; avoid live-region chatter.
- Very long song title and small-height landscape cannot hide playback controls.
- Exercise light, dark and system themes; empty, loading, partial, ready, stale, failed, offline and recovering states where applicable.
- Exercise 320/375/390/430/768/1024/1280/1440/1920 CSS-pixel widths, short viewports, 200/400% zoom, keyboard, touch, reduced motion, realistic long/missing/duplicate/Unicode/RTL metadata.
- Maintain existing frontend, API, audio and Python assertions; changed markup may require selector updates but never weakened behavioural contracts.

## Preservation and dependencies

Retain the [existing Selecta 3.0 invariants INV-01–INV-20](selecta-3-roadmap.md) and [3.1 preservation contract](selecta-3-1-roadmap.md): no original-file mutation; local-first security and LRCLIB disclosure; no loss of current/draft state, preferences, corrections or ratings; stable old routes; one audio owner; exact request consent and atomic join; truthful requested-versus-rendered state; revision-pinned decodable FLAC; full keyboard alternatives and regression assertions. No backend, schema, audio-engine or dependency rewrite is authorized by this ADR. See [4.0 parity matrix](selecta-4-feature-parity.md) and [verification matrix](selecta-4-verification-matrix.md).

## Alternatives, risks and trade-offs

Two presentation depths remain one functional Listen mode, limiting implementation drift.

## Evidence and advancement rules

An owner must separately **Accept** this decision before it becomes policy. Each implementing PR must name the S4-0098 task IDs, actual commit(s), changed files, pre-existing regression tests, new negative/concurrency cases, theme/viewport screenshots and relevant human/audible/AT evidence. **Implemented** requires merged code and applicable automated checks; **Verified** additionally requires independent real acceptance relevant to the change. An unchecked checkbox means not Verified. A docs merge does not advance these statuses.

## Status history

| Date | Decision | Implementation | Verification | Evidence |
|---|---|---|---|---|
| 2026-11-07 | Proposed | Not started | Not verified | Documentation-only specification; no runtime, test or UI changes |
| 2026-11-08 | Accepted | Not started | Not verified | Owner accepted all proposed ADRs ([#37](https://github.com/tochi-mba/selecta/pull/37)) |
| 2026-11-10 | Accepted | 6/10 Implemented, 4 In progress | Not verified | Per-task source and test reconciliation; each task names the automated checks run on 2026-11-10 and any check that needs a person |

## Related documents

- [Selecta 4.0 roadmap and ADR index](selecta-4-roadmap.md)
- [4.0 implementation checklist](selecta-4-implementation-checklist.md)
- [4.0 per-task evidence ledger](selecta-4-evidence.md)
- [4.0 verification and edge-case matrix](selecta-4-verification-matrix.md)
- [4.0 release readiness criteria](selecta-4-release-gates.md)
- [Earlier 3.1 implementation checklist](selecta-3-1-implementation-checklist.md)
