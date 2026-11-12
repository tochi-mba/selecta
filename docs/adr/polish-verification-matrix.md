# Selecta UI/UX polish - verification matrix

- **Status:** Proposed; no runtime checks completed by the 2026-11-06 planning PR.
- **Status (2026-11-12):** automated checks are recorded for 115 of 143 P tasks in [the evidence ledger](polish-implementation-evidence.md); 0 are independently Verified, and the person-run checks (screen readers, listening, installed app, user tests) remain open.
- **Date:** 2026-11-06
- **Applies to:** every task in [the polish checklist](polish-implementation-checklist.md).

## Coverage contract

Record an applicable-state inventory for every route, subview and overlay. Cover initial loading, populated, empty, partial, refreshing, saving, success, failed, disconnected, unavailable and recovery. A state may be not applicable only with a reason. Do not multiply screenshots mechanically when one shared-component capture proves the same appearance; retain screen-level checks for composition and behaviour.

Every meaningful control must have applicable default, hover, pressed, selected, focus, disabled, busy, success and error coverage, including long labels. For each surface, inspect both themes, narrow/wide composition, keyboard access, long/missing metadata and reduced motion.

## Surface and journey matrix

| Surface | Required cases | Acceptance evidence |
|---|---|---|
| Setup/readiness | Invalid, Unicode, unavailable and empty paths; no supported music; running/failed scan; analysis complete but insufficient cues; restart/retry; actual lyric-network disclosure | State captures and first-mix task results; backend facts and copy agree |
| Mixes/defaults | Recommendation, unavailable preset, building/failure, duration, persistent customization, requested/achieved arc, failed destination search | Clear action hierarchy and scope; no unintentional playback replacement |
| Drafts | Empty, current, rendering, ready, failed, rename/copy/delete, priority order, stale/deleted draft | Explicit current/draft identity and correct undo target |
| Listen | Idle/resume/loading/playing/paused, transition/fallback, missing details, lyrics variants, grid unavailable, final song | Stable transport and layout; truthful next state; actual continuity evidence |
| Shell/fullscreen | Deep links, missing routes, Back/Forward, restored scroll, mini-player, connection banner, multiple tabs, rejected fullscreen, PWA | Focus and controls remain reachable; no duplicate player or unexpected takeover |
| Edit/inspector | Empty/long mix, selected row, insert/reorder/remove/undo, cue edits, tab keyboard use, loading/error capabilities, actual versus requested transition | Correct target and stable selection; desktop inspector and mobile sheet retain context |
| Studio | Preparing/loading/ready/failed, enabled/focused/solo/playhead cells, local restore/reset, dirty/save/error/close, rapid preview switching | Reachable grid and labels; recoverable edits; exact pair commit; real-stem audio ownership |
| Requests/bridges | Search, duplicate, competing requests, no placement, preparation, approval/rejection, stale cancel, late playhead, ready/played | Explicit route consent and atomic insertion; waiting never implies ready |
| Word discovery | Loading, no matches, preparation, unavailable cues, rendered/failed pair, rating, insertion destination | Candidate and audible result distinguished; atomic insertion |
| Harmonic discovery | Initial retrieval, empty candidates, preparation, four audition stages, playback failure, Yes/No/Skip/history | Stage and result are clear; one owner; recovery without lost judgment |
| Library/details | Search/filter/sort/count, no results, background refresh/failure, long/RTL/duplicate metadata, corrections, 20k songs | Scannable rows; correct readiness and override provenance; preserved focus/position |
| Workshop/sources/storage | Queued/working/blocked/failed jobs, paused worker, unavailable sources, low disk, changed budget/stale save, private diagnostics | Actionable next step and confirmed storage values; no sensitive diagnostic leakage |
| Export | Waiting transitions, rendering, file creation, failed seam, mix changes, close/reopen, download | Lifecycle matches backend; exported FLAC decodes and matches intended mix snapshot |
| Blind studies | Missing input/audio, partial trial, switch A/B, failed/double submission, reload/completion | Conditions remain blind; protocol unchanged; answers recoverable |
| Shared controls | Buttons, inputs, sliders, tabs, menus, tooltips, dialogs, drawers, notifications, empty/error panels | Reviewed state gallery, focus/keyboard/touch behaviour and coherent sizing |
| Skeletons | All layout variants, instant/slow/failure/retry, background refresh, partial and stale responses | Reserved geometry, no misleading waveform/progress, no endless loading or duplicate announcements |
| Notifications | More than three simultaneous Undo actions, repeated offline notices, focus/hover hold, retry failure | No silently lost sole recovery path; readable stack without obscured essential controls |

## Viewport, theme and input matrix

- Widths: 320, 375, 390, 430, 768, 1024, 1440, 1920 and 3840 CSS pixels; include short landscape windows.
- Capture representative layouts at all composition breakpoints and probe nearby widths for clipping and awkward wrapping.
- Dark and light themes; normal and reduced motion; applicable Windows forced colours.
- Actual 200%/400% zoom and enlarged text in addition to narrow viewport simulation.
- Pointer, keyboard and applicable touch input, including virtual keyboard and safe areas.
- NVDA on supported Windows browser and VoiceOver on supported Apple configurations; record actual platform/version and human results.
- Browser tab and installed standalone app; document unsupported platform combinations rather than pretending coverage.
- Long Latin, Unicode and mixed RTL/LTR titles/artists, duplicate titles, unknown artist, missing artwork and large time/count values.

WCAG 2.2 AA is the target. Normal text contrast is at least 4.5:1, qualifying large text 3:1, and applicable non-text contrast 3:1. Pointer targets meet 24px minimum or documented exceptions; 44px is a preferred touch design target, not a misstatement of the AA criterion. Verify focus is visible and not fully obscured. Automated axe scans complement, not replace, manual task completion.

## Loading and motion contract

- A skeleton matches future content geometry; keep actual known labels, modal frame and navigation visible.
- Short fetches should avoid distracting flashes without delaying already-ready content. Measure reveal timing rather than copying an arbitrary delay.
- Keep populated content during refresh and mark stale data honestly on failure.
- Buttons retain their footprint when busy. Display actual stages for analysis/rendering/stems/export; no fabricated percentage.
- Every loader has a slow and failed exit, a recovery action where possible, and a defined screen-reader announcement.
- Reduced motion disables nonessential continuous effects and applies when the preference changes during the session.
- Check transitions for focus loss, scroll jumps and targets moving beneath the pointer.

## Performance and audio evidence

Record hardware, browser, commit, fixture size, render concurrency, cache state and measurement method. Profile a 20,000-song Library, 100-song Edit and full Studio while background rendering competes for resources. Preserve the existing page/API behaviour; choose optimization only after identifying the bottleneck.

Use INP <=200ms and CLS <=0.1 as reference targets. Where field-style 75th-percentile reporting is unavailable in this local app, report lab observations and sample size honestly rather than claiming field compliance. Keep initial UI loading separate from legitimately lengthy audio analysis; LCP <=2.5s is a reference for initial UI, not a promised render duration. Do not add remote telemetry for this measurement.

Audible checks cover navigation, seek, next versus jump-to-transition, late/fallback seams, preview takeover/release, request insertion, Studio commit/failure, reconnect and multi-tab ownership. Automated render checks cannot establish that a transition sounds good. Record human listening separately using the existing [listening procedure](../listening-procedure.md).

## Evidence and completion

For each task record exact commit, fixture/state, automated result, reviewed capture and relevant human result in [the evidence ledger](polish-implementation-evidence.md). Freeze clocks and animation for deterministic visual comparisons; document any masked dynamic regions and inspect those regions separately. Never silently approve new screenshots to hide a regression.

User task sessions cover casual listeners, mix creators and expert editors without coaching. Record success, misclicks, recovery, comprehension and unresolved confusion; do not invent participants or numerical outcomes. Visual review must inspect alignment, typography, icons, copy, separators, truncation, hover/focus and transition detail, not just task success.

Release is blocked by data loss, wrong-mix edits, essential inaccessible actions, misleading preparation state, unsafe local access, unapproved/partial bridges, invalid export, or unintended audio silence/overlap. Review every remaining visual defect and explicitly record any accepted limitation. Unperformed human checks remain unchecked.
