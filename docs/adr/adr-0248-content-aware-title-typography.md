# ADR-0248 - Content-aware music title typography

- **Decision:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation:** In progress (7/8 Implemented, 0/8 In progress, 1/8 Not started).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta gap-focused UI/UX polish; 2026-11-08; main `2956bc47fd735339e7216e03d27817fb3a31e92b`.
- **Priority / phase:** P0 / Gap-focused polish.
- **Owner:** Unassigned.
- **Related accepted ADRs:** ADR-0202, ADR-0203, ADR-0210, ADR-0233; those implementation statuses remain unchanged.
- **Existing source touchpoints:** `web/src/style.css`; `web/src/styles/listening.css`; `web/src/views/Now.tsx`.

## Context and evidence boundary

A supplied Listen screenshot shows a regular song title occupying three oversized lines. The shared `.display` clamp grows with viewport width, not actual music-title fit.

This is an added acceptance decision, not a claim that related source capabilities are absent. The supplied screenshots and source code are *hypothesis evidence*, not an independently verified usability, audio or accessibility audit.

## Novel delta versus previous ADRs

Separate song, artist, mix and fullscreen Stage type roles. Bound font scaling by real content width and wrapping, preserve full accessible metadata and do not move transport off screen when titles change.

The accepted predecessor ADRs remain authoritative for existing functionality. Reconcile each new acceptance condition with the current source before implementing; owner may reject or supersede genuinely redundant tasks.

## Proposed decision

Adopt the new targeted acceptance contract above only after explicit owner review. Prefer refining current source over recreating working features; scope, error/unknown states, progress and interaction semantics must remain correct.

## Visual, motion, safety and interaction contract

Primary music identity and real transport remain legible. Make source truth distinguish planned/requested/preparing/rendered/heard/unknown; never animate nonexistent musical information. Preserve keyboard/touch/assistive-tech equivalence, focus restoration, Still/reduced-motion behavior, responsive layout and explicit scope when taking actions.

**Non-negotiable preservation:** Original local music remains unchanged; one audio owner and intentional Pause; accurate song occurrence/seam identity, current/draft revision and scoped Undo; explicitly consented atomic request bridges; eight Studio lanes and 8–64 cells; truthful Library readiness and LRCLIB metadata disclosure; neutral listening studies; correct frozen-revision decodable FLAC. No SaaS, accounts, telemetry, cloud music, native folder picker or launcher is authorized.

## Implementation checklist - 0/8 Implemented, 0/8 independently Verified

1. **GP-0248-01 - Define distinct track, artist, mix and Stage type roles.** **Acceptance:** Define distinct track, artist, mix and Stage type roles is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** light/dark title fixtures, browser layout and NVDA review; relevant negative-case and exact-SHA source tests. **Implementation:** Implemented; **Verified:** No; **Owner:** Checklist agent (2026-11-11); **Implementing PR/SHA:** existing source (web/src/views/Now.tsx TrackTitle and transport); **Evidence:** 'GP-0248-01 track, artist, mix and Stage titles are distinct type roles' passed in web/e2e/gp-polish.e2e.ts on a current build (web/dist-dj-gp, slot-lock run) (2026-11-11).
2. **GP-0248-02 - Fit ordinary title size to column width and line count.** **Acceptance:** Fit ordinary title size to column width and line count is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** light/dark title fixtures, browser layout and NVDA review; relevant negative-case and exact-SHA source tests. **Implementation:** Implemented; **Verified:** No; **Owner:** Checklist agent (2026-11-11); **Implementing PR/SHA:** existing source (web/src/views/Now.tsx TrackTitle and transport); **Evidence:** 'GP-0248-02/03/05 at 1440x900, 1024x768 and 768x1024 titles fit their slot and Play/Pause and seek stay still' passed in web/e2e/gp-polish.e2e.ts on a current build (web/dist-dj-gp, slot-lock run) (2026-11-11).
3. **GP-0248-03 - Prevent three-line oversized titles from dominating listening.** **Acceptance:** Prevent three-line oversized titles from dominating listening is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** light/dark title fixtures, browser layout and NVDA review; relevant negative-case and exact-SHA source tests. **Implementation:** Implemented; **Verified:** No; **Owner:** Checklist agent (2026-11-11); **Implementing PR/SHA:** existing source (web/src/views/Now.tsx TrackTitle and transport); **Evidence:** 'GP-0248-02/03/05 at 1440x900, 1024x768 and 768x1024 titles fit their slot and Play/Pause and seek stay still' passed in web/e2e/gp-polish.e2e.ts on a current build (web/dist-dj-gp, slot-lock run) (2026-11-11).
4. **GP-0248-04 - Keep complete title and artist accessible in compact layouts.** **Acceptance:** Keep complete title and artist accessible in compact layouts is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** light/dark title fixtures, browser layout and NVDA review; relevant negative-case and exact-SHA source tests. **Implementation:** Implemented; **Verified:** No; **Owner:** Checklist agent (2026-11-11); **Implementing PR/SHA:** existing source (web/src/views/Now.tsx TrackTitle and transport); **Evidence:** 'GP-0248-04/07 the whole title and artist stay readable and the transport reachable' at 320x640, 320x256 and 1024x480 passed in web/e2e/gp-polish.e2e.ts on a current build (web/dist-dj-gp, slot-lock run); browser check pending at 640x360 (web/e2e/gp-polish.e2e.ts, same test), where the run broke in setup with a disposed response before any check (2026-11-11).
5. **GP-0248-05 - Protect Play/Pause and seek geometry as tracks change.** **Acceptance:** Protect Play/Pause and seek geometry as tracks change is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** light/dark title fixtures, browser layout and NVDA review; relevant negative-case and exact-SHA source tests. **Implementation:** Implemented; **Verified:** No; **Owner:** Checklist agent (2026-11-11); **Implementing PR/SHA:** existing source (web/src/views/Now.tsx TrackTitle and transport); **Evidence:** 'GP-0248-02/03/05 ... Play/Pause and seek stay still' at three sizes and 'GP-0248-05 Play, Loading and Pause keep one button size' passed in web/e2e/gp-polish.e2e.ts on a current build (web/dist-dj-gp, slot-lock run) (2026-11-11).
6. **GP-0248-06 - Verify bidirectional, emoji and non-Latin title wrapping.** **Acceptance:** Verify bidirectional, emoji and non-Latin title wrapping is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** light/dark title fixtures, browser layout and NVDA review; relevant negative-case and exact-SHA source tests. **Implementation:** Implemented; **Verified:** No; **Owner:** Checklist agent (2026-11-11); **Implementing PR/SHA:** existing source (web/src/views/Now.tsx TrackTitle and transport); **Evidence:** 'GP-0248-06 song N keeps its whole title, its direction and its slot' for songs 5, 6, 7, 9 and 10 (Hebrew, Arabic, Japanese, emoji and long names) passed in web/e2e/gp-polish.e2e.ts on a current build (web/dist-dj-gp, slot-lock run) (2026-11-11).
7. **GP-0248-07 - Verify short screens, 320px and 400% zoom.** **Acceptance:** Verify short screens, 320px and 400% zoom is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** light/dark title fixtures, browser layout and NVDA review; relevant negative-case and exact-SHA source tests. **Implementation:** Implemented; **Verified:** No; **Owner:** Checklist agent (2026-11-11); **Implementing PR/SHA:** existing source (web/src/views/Now.tsx TrackTitle and transport); **Evidence:** 'GP-0248-04/07 the whole title and artist stay readable and the transport reachable' at 320x640, 320x256 and 1024x480 passed in web/e2e/gp-polish.e2e.ts on a current build (web/dist-dj-gp, slot-lock run); browser check pending at 640x360 (web/e2e/gp-polish.e2e.ts, same test), where the run broke in setup with a disposed response before any check (2026-11-11).
8. **GP-0248-08 - Show improved first-glance readability in uncoached study.** **Acceptance:** Show improved first-glance readability in uncoached study is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** light/dark title fixtures, browser layout and NVDA review; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Checklist agent (2026-11-10); **Implementing PR/SHA:** -; **Evidence:** Needs a person: uncoached first-glance readability study.

## Negative cases and required evidence

**Area-specific:** long featured credits, RTL, CJK, emoji, 320px, 400% zoom, font fallback

**Common matrix:** Offline/stale/failed/cancel, multitab, duplicate titles, long/RTL/Unicode metadata, 320–2560px widths, short landscape, 400% zoom, dark/light/forced colors, keyboard/touch/NVDA, reduced motion and real audio where applicable.

Required verification is *independent* of code completion: named reviewer, date, exact source SHA, device/OS/browser, representative songs when audio-related, task outcome denominators, accessibility observations and failure/rollback evidence. CI screenshots are candidates, not owner-approved goldens; muted synthetic browser tests do not certify real audible behavior.

## Dependencies, provenance and status

- **Depends on:** ADR-0202, ADR-0203, ADR-0210, ADR-0233, ADR-0199 (status reconciliation), ADR-0237 (source truth), ADR-0239/0240 (tests and research), ADR-0247 (GO/NO-GO).
- **Sequence:** decision review → design specimens → narrow implementing PR with tests → independent audio/AT/human review → evidence and release verdict.
- **Now:** Accepted; 0/8 Implemented, 7/8 In progress, 1/8 Not started (2026-11-10); 0 Verified; implementation in the feat/finish-checklists working tree and wip commits, cited per task. Historical T/P/S3/S31/S4/EX/MI/CI/SF statuses unchanged.
- [Roadmap](selecta-gap-polish-roadmap.md) · [Checklist](selecta-gap-polish-implementation-checklist.md) · [Evidence](selecta-gap-polish-implementation-evidence.md) · [Parity](selecta-gap-polish-overlap-and-parity.md) · [Verification](selecta-gap-polish-verification-matrix.md) · [Gates](selecta-gap-polish-release-gates.md).
