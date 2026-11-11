# ADR-0249 - Listen control hierarchy and attention budget

- **Decision:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation:** In progress (7/8 Implemented, 0/8 In progress, 1/8 Not started).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta gap-focused UI/UX polish; 2026-11-08; main `2956bc47fd735339e7216e03d27817fb3a31e92b`.
- **Priority / phase:** P0 / Gap-focused polish.
- **Owner:** Unassigned.
- **Related accepted ADRs:** ADR-0210, ADR-0212, ADR-0214, ADR-0215; those implementation statuses remain unchanged.
- **Existing source touchpoints:** `web/src/views/Now.tsx`; `web/src/styles/listening.css`.

## Context and evidence boundary

Listen currently combines real transport, waveform, spectrum, large beat countdown, up-next detail, lyrics, preferences, ratings, requests and steering in a dense scene.

This is an added acceptance decision, not a claim that related source capabilities are absent. The supplied screenshots and source code are *hypothesis evidence*, not an independently verified usability, audio or accessibility audit.

## Novel delta versus previous ADRs

Keep song, Play/Pause, actual time and next musical event as first-level affordances. Compact secondary controls using discoverable disclosure; preserve all fifteen visualizers, every DJ action and correct real-audio status.

The accepted predecessor ADRs remain authoritative for existing functionality. Reconcile each new acceptance condition with the current source before implementing; owner may reject or supersede genuinely redundant tasks.

## Proposed decision

Adopt the new targeted acceptance contract above only after explicit owner review. Prefer refining current source over recreating working features; scope, error/unknown states, progress and interaction semantics must remain correct.

## Visual, motion, safety and interaction contract

Primary music identity and real transport remain legible. Make source truth distinguish planned/requested/preparing/rendered/heard/unknown; never animate nonexistent musical information. Preserve keyboard/touch/assistive-tech equivalence, focus restoration, Still/reduced-motion behavior, responsive layout and explicit scope when taking actions.

**Non-negotiable preservation:** Original local music remains unchanged; one audio owner and intentional Pause; accurate song occurrence/seam identity, current/draft revision and scoped Undo; explicitly consented atomic request bridges; eight Studio lanes and 8–64 cells; truthful Library readiness and LRCLIB metadata disclosure; neutral listening studies; correct frozen-revision decodable FLAC. No SaaS, accounts, telemetry, cloud music, native folder picker or launcher is authorized.

## Implementation checklist - 5/8 Implemented, 0/8 independently Verified

1. **GP-0249-01 - Inventory controls and define foreground versus advanced tiers.** **Acceptance:** Inventory controls and define foreground versus advanced tiers is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** full-route visual state matrix, real audio and novice/DJ task study; relevant negative-case and exact-SHA source tests. **Implementation:** Implemented; **Verified:** No; **Owner:** Checklist agent (2026-11-10); **Implementing PR/SHA:** existing source (web/src/views/Now.tsx); inventory and test added 2026-11-10, uncommitted; **Evidence:** inventory in docs/adr/adr-0249-listen-attention-hierarchy.md 'Listen control inventory'; web/src/views/gp-0249-tiers.test.tsx 'keeps the transport in the foreground and every advanced control behind DJ controls' and web/src/views/Now.test.tsx 'keeps expert view controls discoverable without competing with playback' (vitest, passed 2026-11-10).
2. **GP-0249-02 - Keep core transport fixed when panels open or close.** **Acceptance:** Keep core transport fixed when panels open or close is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** full-route visual state matrix, real audio and novice/DJ task study; relevant negative-case and exact-SHA source tests. **Implementation:** Implemented; **Verified:** No; **Owner:** Checklist agent (2026-11-11); **Implementing PR/SHA:** existing source (web/src/views/Now.tsx TrackTitle and transport); **Evidence:** 'GP-0249-02/03 the transport stays fixed while display panels open, close and change' passed in web/e2e/gp-polish.e2e.ts on a current build (web/dist-dj-gp, slot-lock run) (2026-11-11).
3. **GP-0249-03 - Expose fifteen visualizers without a permanently tall selector.** **Acceptance:** Expose fifteen visualizers without a permanently tall selector is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** full-route visual state matrix, real audio and novice/DJ task study; relevant negative-case and exact-SHA source tests. **Implementation:** Implemented; **Verified:** No; **Owner:** Checklist agent (2026-11-11); **Implementing PR/SHA:** existing source (web/src/views/Now.tsx TrackTitle and transport); **Evidence:** 'GP-0249-02/03 the transport stays fixed while display panels open, close and change' passed in web/e2e/gp-polish.e2e.ts on a current build (web/dist-dj-gp, slot-lock run): fifteen visualizer styles in one control no taller than 48px (2026-11-11).
4. **GP-0249-04 - Reduce oversized countdown space except in explicit focus view.** **Acceptance:** Reduce oversized countdown space except in explicit focus view is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** full-route visual state matrix, real audio and novice/DJ task study; relevant negative-case and exact-SHA source tests. **Implementation:** Implemented; **Verified:** No; **Owner:** Checklist agent (2026-11-10); **Implementing PR/SHA:** existing source (web/src/views/Now.tsx); **Evidence:** web/src/views/Now.test.tsx 'keeps the countdown compact, preserves choices and explains lyric focus' (vitest, passed 2026-11-10).
5. **GP-0249-05 - Consolidate repeated planned versus rendered explanations.** **Acceptance:** Consolidate repeated planned versus rendered explanations is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** full-route visual state matrix, real audio and novice/DJ task study; relevant negative-case and exact-SHA source tests. **Implementation:** Implemented; **Verified:** No; **Owner:** Checklist agent (2026-11-10); **Implementing PR/SHA:** web/src/views/Now.tsx WhyThisTransition; uncommitted; **Evidence:** web/src/views/Now.tsx: planned versus made, and asked versus what will play, are said once by TransitionTruth under Up Next; Why this transition now gives only the reasons; web/src/views/gp-0249-listen.test.tsx 'GP-0249-05 one explanation of planned versus made' (2 cases) plus web/src/views/explanations.test.tsx and web/src/views/Now.test.tsx (vitest, passed 2026-11-10).
6. **GP-0249-06 - Keep lyrics, steering and request controls discoverable.** **Acceptance:** Keep lyrics, steering and request controls discoverable is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** full-route visual state matrix, real audio and novice/DJ task study; relevant negative-case and exact-SHA source tests. **Implementation:** Implemented; **Verified:** No; **Owner:** Checklist agent (2026-11-10); **Implementing PR/SHA:** web/src/views/Now.tsx Change the next song opener in Up Next; uncommitted; **Evidence:** web/src/views/Now.tsx: with DJ controls closed, Up Next offers 'Change the next song', which opens DJ controls with focus on the steering heading; lyrics stay in the foreground and Request a song is one press; web/src/views/gp-0249-listen.test.tsx 'GP-0249-06 lyrics, steering and requests stay discoverable' (2 cases, vitest, passed 2026-11-10).
7. **GP-0249-07 - Preserve accessibility and audio focus during visual changes.** **Acceptance:** Preserve accessibility and audio focus during visual changes is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** full-route visual state matrix, real audio and novice/DJ task study; relevant negative-case and exact-SHA source tests. **Implementation:** Implemented; **Verified:** No; **Owner:** Checklist agent (2026-11-10); **Implementing PR/SHA:** existing source (web/src/views/Now.tsx); test added 2026-11-10, uncommitted; **Evidence:** web/src/views/gp-0249-listen.test.tsx 'panels, visualizer style and intensity change without touching the player or moving focus' (no player method called, focus stays on each control, the same Pause element and lyric remain; vitest, passed 2026-11-10).
8. **GP-0249-08 - Compare control-discovery time for listeners and DJs.** **Acceptance:** Compare control-discovery time for listeners and DJs is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** full-route visual state matrix, real audio and novice/DJ task study; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Checklist agent (2026-11-10); **Implementing PR/SHA:** -; **Evidence:** Needs a person: timed control-discovery study with listeners and DJs.

## Listen control inventory (GP-0249-01, 2026-11-10)

Read from `web/src/views/Now.tsx` and pinned by `web/src/views/gp-0249-tiers.test.tsx`.

- **Foreground tier, always on screen:** the mix eyebrow, song motif, title and artist; Previous song, Play/Pause/Resume and Next song; Jump to the transition; volume; the seek strip ("Where in the song"); the countdown to the next transition and the Coming up list; the current lyric when the song has lyrics.
- **Advanced tier, inside the closed "DJ controls" disclosure:** Request a song; Visible listening panels (Spectrum, Beat countdown, Lyrics focus); Audio visualizer style (fifteen styles in one ordinary select); Visual intensity; Fullscreen lyrics; Good/Bad rating of the transition just heard; Bigger, Calmer and Something else steering; Why this transition.
- **Stage:** its own Play/Pause and exit; everything else stays out of the way.

## Negative cases and required evidence

**Area-specific:** seam fallback, no lyrics, loading, active request, narrow landscape, reduced motion

**Common matrix:** Offline/stale/failed/cancel, multitab, duplicate titles, long/RTL/Unicode metadata, 320–2560px widths, short landscape, 400% zoom, dark/light/forced colors, keyboard/touch/NVDA, reduced motion and real audio where applicable.

Required verification is *independent* of code completion: named reviewer, date, exact source SHA, device/OS/browser, representative songs when audio-related, task outcome denominators, accessibility observations and failure/rollback evidence. CI screenshots are candidates, not owner-approved goldens; muted synthetic browser tests do not certify real audible behavior.

## Dependencies, provenance and status

- **Depends on:** ADR-0210, ADR-0212, ADR-0214, ADR-0215, ADR-0199 (status reconciliation), ADR-0237 (source truth), ADR-0239/0240 (tests and research), ADR-0247 (GO/NO-GO).
- **Sequence:** decision review → design specimens → narrow implementing PR with tests → independent audio/AT/human review → evidence and release verdict.
- **Now:** Accepted; 5/8 Implemented, 2/8 In progress, 1/8 Not started (2026-11-10); 0 Verified; implementation in the feat/finish-checklists working tree and wip commits, cited per task. Historical T/P/S3/S31/S4/EX/MI/CI/SF statuses unchanged.
- [Roadmap](selecta-gap-polish-roadmap.md) · [Checklist](selecta-gap-polish-implementation-checklist.md) · [Evidence](selecta-gap-polish-implementation-evidence.md) · [Parity](selecta-gap-polish-overlap-and-parity.md) · [Verification](selecta-gap-polish-verification-matrix.md) · [Gates](selecta-gap-polish-release-gates.md).
