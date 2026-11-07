# ADR-0093: Persistent playback presentation, previews, audio focus and immersive Stage lifecycle

- **Decision status:** Proposed (owner acceptance required)
- **Implementation status:** Not started (0/10 implemented)
- **Verification status:** Not verified (0/10)
- **Documentation status:** Drafted, documentation-only Selecta 4.0 proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 4.0 complete UI/UX overhaul
- **Phase:** 2 Shell / 4 Listen
- **Extends, does not automatically supersede:** ADR-0006, ADR-0007, ADR-0049, ADR-0069, ADR-0082
- **Source surfaces to reconcile:** `web/src/player.ts`; `web/src/audio/focus.ts`; `web/src/views/Now.tsx`; `web/src/shell/*`
- **Tasks:** S4-0093-01 through S4-0093-10 in [the Selecta 4.0 checklist](selecta-4-implementation-checklist.md)
- **Baseline:** `main` `9b663f9f10212619f27ce67ce82f602347065cbd` (after merged PRs #25 and #26)

## Context and evidence boundary

Main playback, mini-player, transition previews, Studio and blind auditions share a critical audio resource. Visual remounts or delayed preview cleanup can create overlap or unexpected resume.

This is a **proposal**. Source inspection and earlier planning documents establish current contracts and candidate risks; they do not establish verified visual quality, human task success, real audio quality, screen-reader usability or shipped implementation of this ADR. Earlier programme status headings can be stale and are not inherited as verified work.

## Proposed decision

Keep one authoritative audio controller independent of routes, with a documented preview-ownership policy; redesign mini-player and Stage presentation without rewriting audio scheduling as part of UI work.

## Experience, frontend and interaction specification

- Mini-player shows song/artist, play/pause, meaningful progress, next and volume as space permits; Listen does not duplicate controls unnecessarily.
- Preview generally suspends the main mix; extended Studio/study preview does not auto-resume main playback.
- Short transient preview may restore only if the user has not issued a newer explicit playback command.
- Stage must work when fullscreen is denied; focus/route and audio remain continuous.

## Detailed implementation work — all Not started

1. **S4-0093-01 — Specify audio-owner state graph for every audition surface.** Acceptance: At most one active owner; no implicit resume after explicit Pause. Required verification: Pairwise preview owner race tests. **Implementation: Not started; Verified: No.**
2. **S4-0093-02 — Decouple transport lifecycle from routes, themes and overlay mounts.** Acceptance: Playback survives navigation/density/theme changes. Required verification: Real-media route/nav/theme E2E. **Implementation: Not started; Verified: No.**
3. **S4-0093-03 — Redesign desktop and mobile mini-player hierarchy.** Acceptance: Primary transport available without text/icon collision. Required verification: Long-title and 320–430px screenshots. **Implementation: Not started; Verified: No.**
4. **S4-0093-04 — Document play, pause, resume, next, previous and Jump semantics.** Acceptance: User can distinguish immediate skip from transition jump. Required verification: Audio timing and copy comprehension checks. **Implementation: Not started; Verified: No.**
5. **S4-0093-05 — Preserve seeking and disabled transition-seek feedback.** Acceptance: Position remains accurate and unavailable areas explain why. Required verification: Seek near boundaries and during transition tests. **Implementation: Not started; Verified: No.**
6. **S4-0093-06 — Preserve and test volume, mute and Media Session behaviours.** Acceptance: System media controls work where supported; in-app fallback always works. Required verification: Windows/Edge real hardware plus browser API tests. **Implementation: Not started; Verified: No.**
7. **S4-0093-07 — Implement preview interruption/cleanup rules.** Acceptance: Late preview cannot resume stale owner or leave silence. Required verification: Open/close/switch/fail preview adversarial tests. **Implementation: Not started; Verified: No.**
8. **S4-0093-08 — Rebuild Stage fullscreen/fallback/exit and focus handling.** Acceptance: Escape/Close recover without interrupting playback. Required verification: Fullscreen denial, tab switch, reduced motion. **Implementation: Not started; Verified: No.**
9. **S4-0093-09 — Test paused, last-song, no-mix, missing-file and interrupted audio states.** Acceptance: UI never falsely claims audio playing or downloadable. Required verification: Fault-injected transport suite. **Implementation: Not started; Verified: No.**
10. **S4-0093-10 — Validate multi-tab and background lifecycle.** Acceptance: Existing leader/ownership protections remain intact. Required verification: Two tabs, hidden tab, suspension, wake and server restart. **Implementation: Not started; Verified: No.**

## Required negative cases and regression strategy

- Preview fails before starting; user presses Pause while preview active; another preview starts before old cleanup.
- Audio device changes and autoplay gesture restrictions.
- Synchronized visualizer clocks must not drive global React rerenders.
- Exercise light, dark and system themes; empty, loading, partial, ready, stale, failed, offline and recovering states where applicable.
- Exercise 320/375/390/430/768/1024/1280/1440/1920 CSS-pixel widths, short viewports, 200/400% zoom, keyboard, touch, reduced motion, realistic long/missing/duplicate/Unicode/RTL metadata.
- Maintain existing frontend, API, audio and Python assertions; changed markup may require selector updates but never weakened behavioural contracts.

## Preservation and dependencies

Retain the [existing Selecta 3.0 invariants INV-01–INV-20](selecta-3-roadmap.md) and [3.1 preservation contract](selecta-3-1-roadmap.md): no original-file mutation; local-first security and LRCLIB disclosure; no loss of current/draft state, preferences, corrections or ratings; stable old routes; one audio owner; exact request consent and atomic join; truthful requested-versus-rendered state; revision-pinned decodable FLAC; full keyboard alternatives and regression assertions. No backend, schema, audio-engine or dependency rewrite is authorized by this ADR. See [4.0 parity matrix](selecta-4-feature-parity.md) and [verification matrix](selecta-4-verification-matrix.md).

## Alternatives, risks and trade-offs

Audio-focus orchestration is deliberately separate from visual components; rapid cosmetic delivery must not compromise it.

## Evidence and advancement rules

An owner must separately **Accept** this decision before it becomes policy. Each implementing PR must name the S4-0093 task IDs, actual commit(s), changed files, pre-existing regression tests, new negative/concurrency cases, theme/viewport screenshots and relevant human/audible/AT evidence. **Implemented** requires merged code and applicable automated checks; **Verified** additionally requires independent real acceptance relevant to the change. An unchecked checkbox means not Verified. A docs merge does not advance these statuses.

## Status history

| Date | Decision | Implementation | Verification | Evidence |
|---|---|---|---|---|
| 2026-11-07 | Proposed | Not started | Not verified | Documentation-only specification; no runtime, test or UI changes |

## Related documents

- [Selecta 4.0 roadmap and ADR index](selecta-4-roadmap.md)
- [4.0 implementation checklist](selecta-4-implementation-checklist.md)
- [4.0 per-task evidence ledger](selecta-4-evidence.md)
- [4.0 verification and edge-case matrix](selecta-4-verification-matrix.md)
- [4.0 release readiness criteria](selecta-4-release-gates.md)
- [Earlier 3.1 implementation checklist](selecta-3-1-implementation-checklist.md)
