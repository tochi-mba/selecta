# ADR-0261 - Stem Studio novice mental model and expert confidence

- **Decision:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation:** In progress (7/8 Implemented, 0/8 In progress, 1/8 Not started).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta gap-focused UI/UX polish; 2026-11-08; main `2956bc47fd735339e7216e03d27817fb3a31e92b`.
- **Priority / phase:** P1 / Gap-focused polish.
- **Owner:** Unassigned.
- **Related accepted ADRs:** ADR-0223, ADR-0224; those implementation statuses remain unchanged.
- **Existing source touchpoints:** `web/src/views/Studio.tsx`; `web/src/studio.ts`.

## Context and evidence boundary

Studio's eight lanes and Shape/Grid/List modes exist, but novices may not predict what a painted cell, a solo, an AI diff or an unapplied preview will do.

This is an added acceptance decision, not a claim that related source capabilities are absent. The supplied screenshots and source code are *hypothesis evidence*, not an independently verified usability, audio or accessibility audit.

## Novel delta versus previous ADRs

Use consistent two-song × four-stem language and exact cell/time coordinates across modes; label working, previewed, proposed, applied and rendered states distinctly without removing expert precision.

The accepted predecessor ADRs remain authoritative for existing functionality. Reconcile each new acceptance condition with the current source before implementing; owner may reject or supersede genuinely redundant tasks.

## Proposed decision

Adopt the new targeted acceptance contract above only after explicit owner review. Prefer refining current source over recreating working features; scope, error/unknown states, progress and interaction semantics must remain correct.

## Visual, motion, safety and interaction contract

Primary music identity and real transport remain legible. Make source truth distinguish planned/requested/preparing/rendered/heard/unknown; never animate nonexistent musical information. Preserve keyboard/touch/assistive-tech equivalence, focus restoration, Still/reduced-motion behavior, responsive layout and explicit scope when taking actions.

**Non-negotiable preservation:** Original local music remains unchanged; one audio owner and intentional Pause; accurate song occurrence/seam identity, current/draft revision and scoped Undo; explicitly consented atomic request bridges; eight Studio lanes and 8–64 cells; truthful Library readiness and LRCLIB metadata disclosure; neutral listening studies; correct frozen-revision decodable FLAC. No SaaS, accounts, telemetry, cloud music, native folder picker or launcher is authorized.

## Implementation checklist - 7/8 Implemented, 0/8 independently Verified

1. **GP-0261-01 - Explain two songs and all eight stem lanes consistently.** **Acceptance:** Explain two songs and all eight stem lanes consistently is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** 64-cell keyboard/touch parity, live audio and novice/expert task study; relevant negative-case and exact-SHA source tests. **Implementation:** Implemented; **Verified:** No; **Owner:** Checklist agent (2026-11-10); **Implementing PR/SHA:** existing source (web/src/views/Studio.tsx); **Evidence:** web/src/views/Studio.test.tsx 'shows a square for every part of both songs, named for a screen reader' and web/src/views/gp-0261-studio.test.tsx 'shows all 512 squares as one tab stop and reaches every corner by keyboard' (both songs, eight lanes, named alike; vitest, passed 2026-11-10).
2. **GP-0261-02 - Keep cell coordinate meaning identical across Shape/Grid/List.** **Acceptance:** Keep cell coordinate meaning identical across Shape/Grid/List is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** 64-cell keyboard/touch parity, live audio and novice/expert task study; relevant negative-case and exact-SHA source tests. **Implementation:** Implemented; **Verified:** No; **Owner:** Checklist agent (2026-11-10); **Implementing PR/SHA:** existing source (web/src/views/Studio.tsx); **Evidence:** web/src/views/Studio.test.tsx 'switches between guided Shape and Detailed without changing the grid', 'guided Shape edits the same exact lane shown by Detailed' and 'keeps every stem square and its saved value when changing editor modes' (vitest, passed 2026-11-10).
3. **GP-0261-03 - Make individual cell and solo effect understandable.** **Acceptance:** Make individual cell and solo effect understandable is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** 64-cell keyboard/touch parity, live audio and novice/expert task study; relevant negative-case and exact-SHA source tests. **Implementation:** Implemented; **Verified:** No; **Owner:** Checklist agent (2026-11-10); **Implementing PR/SHA:** existing source (web/src/views/Studio.tsx); **Evidence:** web/src/views/Studio.test.tsx 'tapping a square is heard straight away and renders nothing' and 'pressing a name plays only that part, and can go back to everything' (vitest, passed 2026-11-10).
4. **GP-0261-04 - Distinguish working, AI proposed, applied and rendered states.** **Acceptance:** Distinguish working, AI proposed, applied and rendered states is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** 64-cell keyboard/touch parity, live audio and novice/expert task study; relevant negative-case and exact-SHA source tests. **Implementation:** Implemented; **Verified:** No; **Owner:** Checklist agent (2026-11-10); **Implementing PR/SHA:** existing source (web/src/views/Studio.tsx); **Evidence:** web/src/views/StudioSafety.test.tsx 'says plainly when the working copy differs from what is applied and rendered' and web/src/views/Studio.test.tsx 'fine tunes your own grid and says what it changed and why' and 'nothing it does is final until Apply to this transition' (vitest, passed 2026-11-10).
5. **GP-0261-05 - Preserve single-owner reversible audition behavior.** **Acceptance:** Preserve single-owner reversible audition behavior is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** 64-cell keyboard/touch parity, live audio and novice/expert task study; relevant negative-case and exact-SHA source tests. **Implementation:** Implemented; **Verified:** No; **Owner:** Checklist agent (2026-11-10); **Implementing PR/SHA:** existing source (web/src/views/Studio.tsx); **Evidence:** web/src/views/Studio.test.tsx 'play and stop, and it pauses the mix when it plays', 'tapping twice puts it back', 'closing lets go of the audio' and 'stops the owned Studio preview and its playhead when the tab becomes hidden' (vitest, passed 2026-11-10).
6. **GP-0261-06 - Explain unavailable stem lanes without fictional audio.** **Acceptance:** Explain unavailable stem lanes without fictional audio is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** 64-cell keyboard/touch parity, live audio and novice/expert task study; relevant negative-case and exact-SHA source tests. **Implementation:** Implemented; **Verified:** No; **Owner:** Checklist agent (2026-11-10); **Implementing PR/SHA:** existing source (web/src/views/Studio.tsx); **Evidence:** web/src/views/StudioSafety.test.tsx 'a stem that could not load is named, disabled and cannot be toggled or soloed' and web/src/views/Studio.test.tsx 'marks that lane unavailable, ignores presses on it, and leaves the other lanes working' (vitest, passed 2026-11-10).
7. **GP-0261-07 - Stress-test 64-cell painting, keyboard focus and Undo.** **Acceptance:** Stress-test 64-cell painting, keyboard focus and Undo is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** 64-cell keyboard/touch parity, live audio and novice/expert task study; relevant negative-case and exact-SHA source tests. **Implementation:** Implemented; **Verified:** No; **Owner:** Checklist agent (2026-11-10); **Implementing PR/SHA:** e9e333c (wip, feat/finish-checklists); **Evidence:** web/src/views/gp-0261-studio.test.tsx 'shows all 512 squares as one tab stop and reaches every corner by keyboard' and 'paints one value across a whole 64-cell lane and Start again restores it' (vitest, passed 2026-11-10); hardware responsiveness is left to the browser check named in the ADR.
8. **GP-0261-08 - Compare novice completion and expert editing efficiency.** **Acceptance:** Compare novice completion and expert editing efficiency is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** 64-cell keyboard/touch parity, live audio and novice/expert task study; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Checklist agent (2026-11-10); **Implementing PR/SHA:** -; **Evidence:** Needs a person: novice completion and expert editing efficiency study.

## Negative cases and required evidence

**Area-specific:** 8–64 cells, missing stems, stale AI response, touch drag, preview focus

**Common matrix:** Offline/stale/failed/cancel, multitab, duplicate titles, long/RTL/Unicode metadata, 320–2560px widths, short landscape, 400% zoom, dark/light/forced colors, keyboard/touch/NVDA, reduced motion and real audio where applicable.

Required verification is *independent* of code completion: named reviewer, date, exact source SHA, device/OS/browser, representative songs when audio-related, task outcome denominators, accessibility observations and failure/rollback evidence. CI screenshots are candidates, not owner-approved goldens; muted synthetic browser tests do not certify real audible behavior.

## Dependencies, provenance and status

- **Depends on:** ADR-0223, ADR-0224, ADR-0199 (status reconciliation), ADR-0237 (source truth), ADR-0239/0240 (tests and research), ADR-0247 (GO/NO-GO).
- **Sequence:** decision review → design specimens → narrow implementing PR with tests → independent audio/AT/human review → evidence and release verdict.
- **Now:** Accepted; 7/8 Implemented, 0/8 In progress, 1/8 Not started (2026-11-10); 0 Verified; implementation in the feat/finish-checklists working tree and wip commits, cited per task. Historical T/P/S3/S31/S4/EX/MI/CI/SF statuses unchanged.
- [Roadmap](selecta-gap-polish-roadmap.md) · [Checklist](selecta-gap-polish-implementation-checklist.md) · [Evidence](selecta-gap-polish-implementation-evidence.md) · [Parity](selecta-gap-polish-overlap-and-parity.md) · [Verification](selecta-gap-polish-verification-matrix.md) · [Gates](selecta-gap-polish-release-gates.md).
