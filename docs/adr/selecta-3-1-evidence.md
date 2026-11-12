# Selecta 3.1 - finishing implementation and independent verification ledger

- **Date:** 2026-11-07.
- **Programme decisions:** 11 Accepted (ADR-0078–0088); they were Proposed when this ledger was written on 2026-11-07.
- **Implementation:** PR #25 merged as `6d78cf420c55817e967fc3b8db45749c9817926e`; 29 selected S31 tasks had partial source mapping then. **On 2026-11-12 the checklist records 96 Implemented with automated evidence, 1 In progress and 19 that need a person; 0/116 are independently Verified.**
- **Scope:** PR #25 began as docs-only, now contains targeted frontend/unit/Edge changes and synthetic screenshot upload. No backend/schema/audio-engine/dependency changes. Baseline `main` is `3b01dc1336aab0f1cb0a4d85be5eba359de81831`.
- **Important historical distinction:** PR #24 is **merged**. The earlier 3.0 ledger still records it as in progress/open and 0 merged; that was a stale planning snapshot, since reconciled item by item (2026-11-12: 221 of 258 ticked with automated evidence, 0 Verified), and **not** a basis for retroactively marking any S3 item complete.
- **Evidence presently available:** source inspection, existing suites, new concurrency/identity/keyboard regressions and Web unit/build success on earlier PR heads. Final-head aggregate CI must be checked after the last commit. Synthetic screenshots are *review candidates only*: no approved images, human AT/usability, real audio audition or scale benchmarks are claimed.

## Individual ADR status

| ADR | Decision | Implementation | Verified | Workstream |
|---|---|---|---:|---|
| [ADR-0078](adr-0078-baseline-evidence-and-governance.md) | Accepted | 7 Implemented, 3 need a person (2026-11-12) | 0/10 | Reconcile the shipped 3.0 baseline and govern finishing work |
| [ADR-0079](adr-0079-visual-system-and-css-ownership.md) | Accepted | 8 Implemented, 2 need a person (2026-11-12) | 0/10 | Unify typography, themes, visual rhythm and CSS ownership |
| [ADR-0080](adr-0080-interaction-state-recovery-and-undo.md) | Accepted | 10 Implemented (2026-11-12) | 0/10 | Make controls, asynchronous states, recovery and Undo dependable |
| [ADR-0081](adr-0081-first-run-explore-and-mix-choice.md) | Accepted | 9 Implemented, 1 need a person (2026-11-12) | 0/10 | Reduce friction from first music folder to a confident first mix |
| [ADR-0082](adr-0082-listen-shell-stage-and-audio-trust.md) | Accepted | 11 Implemented (2026-11-12) | 0/11 | Polish Listen, navigation, mini-player and Stage without audio regressions |
| [ADR-0083](adr-0083-mixes-editor-inspector-and-export.md) | Accepted | 12 Implemented (2026-11-12) | 0/12 | Make drafts, timeline editing, transition intent and export unambiguous |
| [ADR-0084](adr-0084-stem-studio-workstation-polish.md) | Accepted | 9 Implemented (2026-11-12) | 0/9 | Refine Stem Studio's expert controls without reducing capability |
| [ADR-0085](adr-0085-requests-and-music-discovery.md) | Accepted | 10 Implemented (2026-11-12) | 0/10 | Clarify Requests, consented bridges and discovery auditions |
| [ADR-0086](adr-0086-library-workspace-study-and-operational-trust.md) | Accepted | 10 Implemented, 1 need a person (2026-11-12) | 0/11 | Polish Library, Workspace, studies and operational status |
| [ADR-0087](adr-0087-accessibility-responsive-and-performance-gates.md) | Accepted | 5 Implemented, 6 need a person (2026-11-12) | 0/11 | Verify WCAG, device reflow, audio latency and scale |
| [ADR-0088](adr-0088-research-visual-regression-and-release.md) | Accepted | 5 Implemented, 1 In progress, 6 need a person (2026-11-12) | 0/12 | Require observable user, visual and product acceptance before release |
| **Total** | 11 Accepted | 96 Implemented, 1 In progress, 19 need a person (2026-11-12) | **0/116** | |

## Implementation on PR #25 - 29 partial tasks, none Verified

| Task | Status | Source or automated evidence | Still required before Verified |
|---|---|---|---|
| S31-0078-05 | In progress | `web/e2e/visual.e2e.ts` + CI synthetic screenshot upload (`a30af56`) | Review images against approved fixture, font, theme, viewport and privacy requirements |
| S31-0079-03 | In progress | `tokens.css` owns removed `polish.css` duplicated globals (`6e0c618`) | Full CSS ownership, selector and theme cascade audit |
| S31-0079-10 | In progress | `selecta-3-1-visual-review.md` defines review workflow and candidate image collection (`a30af56`) | Reviewer-approved visual baseline and diff policy |
| S31-0080-03 | In progress | Listen steering and rating mutually block related in-flight actions (`1f5c20f`); Action already guards single duplicate presses | All actions, timeouts, errors and reconnects in real browser |
| S31-0080-04 | In progress | `activity.ts` blocks older Undo behind newer running/failed actions; component assertions (`2bb47b5`) | Cross-mix/manual Undo identity, reload and delayed-server verification |
| S31-0080-05 | In progress | `controls.tsx` Menu ArrowUp/controlled ID; Escape nesting for Tooltip/Menu; `primitives.tsx` no form submit; tests (`6e0c618`, `664174d`) | Keyboard-only, real screen reader, nested overlay and pointer walkthrough |
| S31-0080-06 | In progress | `SeamInspector.tsx` retains latest edit intent; `MixSetup.tsx` serializes steering changes; new concurrency tests (`30bc40d`, `26b7621`) | Request/Studio/library/render multi-tab stale-response matrix |
| S31-0080-10 | In progress | Delayed-server regression tests for steering and stale inspection (`26b7621`, `30bc40d`) | Disconnect/reconnect, pending click, focus and idempotency on device |
| S31-0081-01 | In progress | `Start.tsx` removes unsolicited initial autofocus; existing folder/privacy explanation (`6e0c618`) | First-run denied/empty/external drive/keyboard/human comprehension |
| S31-0081-07 | In progress | `MixSetup.tsx` serializes feel/stems/destination/energy writes and shows failed persistence (`26b7621`, `1cb6ae1`) | Visual hierarchy, browser persistence and unguided customization |
| S31-0082-01 | Implemented (automated), 2026-11-11 | `Now.tsx` collapses optional display options and retains transport prominence (`6e0c618`); `s31-0082-01-listen-hierarchy.test.tsx` passed 2026-11-11 | Actual listener tasks in playing/paused/error and both themes |
| S31-0082-05 | In progress | `Now.tsx` Display options disclosure; component assertion (`6e0c618`) | Human hierarchy/lyrics/spectrum/timing review in real browser |
| S31-0082-06 | In progress | Upcoming card discloses Edit action; steering/rating guards; component tests (`664eb3b`, `1f5c20f`) | Human Next-versus-Edit comprehension, actual audio |
| S31-0082-07 | In progress | Mobile disclosure flex order restored; Edge browser layout assertion (`e638458`) | 320–430px player/nav/keyboard/safe area/screenshots on device |
| S31-0083-08 | In progress | `SeamInspector.tsx` late response reconciliation and render skip; unit assertion (`30bc40d`) | Actual render, preview/rating and stale order recovery |
| S31-0083-09 | In progress | `ExportPanel.tsx` filters job by scope and exact draft ID, shows first/last song; unit tests (`e638458`, `f5d1071`) | Revision-pinned actual output, FLAC and stale edit verification |
| S31-0083-11 | In progress | Export scope change and Undo blocking regressions (`f5d1071`, `2bb47b5`) | Current/draft concurrent server requests, cross-tab and activity audit |
| S31-0084-01 | In progress | `Studio.tsx` names numbered transition and identifies both songs (`e638458`) | Changed/deleted pair revision review and human A/B context test |
| S31-0084-05 | In progress | Validated exact-cell locally recovered shape, never equates retained to applied (`e638458`) | Real Studio session/dirty/recovery/render confirmation |
| S31-0087-06 | In progress | Edge narrow Listen order/disclosure/transport assertion (`e638458`), synthetic screenshot matrix (`a30af56`) | Physical keyboard, safe area, short heights, 200/400% zoom |
| S31-0088-01 | In progress | Synthetic route/overlay and light/dark candidate screenshot collection (`a30af56`) | Reviewed approved golden baselines including empty/error/recovery, not merely generated images |
| S31-0088-03 | In progress | Pre-existing Python/Web/audio/Edge suites retained; new focused regressions added (`6e0c618`–`a30af56`) | Green exact-head aggregate `verify`, human review and P0/P1 disposition |

| S31-0078-03 | In progress | `selecta-3-1-surface-inventory.md` indexes routes, overlays, Stage and mini-player from router/App | Validate coverage against actual built app, owner route and task sign-off |
| S31-0078-04 | In progress | Source-grounded state-coverage plan and adversarial sequences in inventory | Execute and record initial/empty/stale/failed/recovered states on each surface |
| S31-0085-03 | In progress | `Requests.tsx` stops concurrent bridge approvals, exposes busy state for alternate bridge selection (`416dda3`) | Human whole-route consent explanation and competing action audit |
| S31-0085-04 | In progress | `Requests.test.tsx` adds in-flight duplicate consent regression (`416dda3`) | Real server atomic bridge, rejection, cancellation and no partial-play review |
| S31-0086-01 | In progress | `Library.tsx` responds when only paginated URL/history changes; regression in `Library.test.tsx` (`bc70194`) | Back/Forward, refresh, sort, filter and 20k results on device |
| S31-0086-03 | In progress | Page append avoids redundant full refetch and reloads subset on direct navigation (`bc70194`) | Background refresh, focus preservation and large-result profile |
| S31-0088-11 | In progress | `selecta-3-1-release-readiness.md` documents scope, evidence gaps and explicit NO-GO | Exact-head green CI, real image/AT/audio/performance/usability findings and reviewer decision |
| S31-0079-06 | Implemented (automated), 2026-11-11 | `web/src/ui/ControlGallery.tsx` (Workspace > Diagnostics in development or a `VITE_SELECTA_GALLERY=1` build) holds default, primary, pressed, busy, busy-and-disabled, disabled, invalid field, Problem with retry and destructive buttons and menu items, tabs, checkbox, menu and all eight statuses; `web/src/ui/polish-components.test.tsx` 'holds every shared control family the polish inventory names' (passed 2026-11-11); hover, focus, pressed and busy geometry in the browser: `web/e2e/mp-0279-component-gallery.e2e.ts` MP-0279-01 to -04 passed 2026-11-11 (recorded in the measured micro-polish checklist). | Human review for Verified (the checklist's Needs a person) |
| S31-0079-08 | Implemented (automated), 2026-11-11 | `web/src/lib.ts` `gb()` now reads small amounts in MB instead of "0.0 GB"; `web/src/s31-0079-08-numbers.test.ts` (durations never NaN or negative, storage keeps a readable unit, BPM and key named in words with a reason when missing, times, counts, metrics, library columns, facts, playhead and number fields use tabular figures, long and RTL titles wrap in their own direction), with `web/src/lib.test.ts` and `web/src/sfEdgeCases.test.ts` (passed 2026-11-11). | Human review for Verified (the checklist's Needs a person) |
| S31-0081-05 | Implemented (automated), 2026-11-11 | `web/src/views/MixSetup.tsx` build summary shown on the featured pick now says "part-by-part moves" instead of the DJ term "stem moves"; `web/src/views/s31-0081-05-mix-choice.test.tsx` 'the featured pick: one recommendation, what it draws on, one main action', 'a mood card: name, plain summary, whose music, outcomes, and one main action' and 'the whole Make a Mix page, in Selecta's own words, uses no DJ terms', with `web/src/views/Mixes.test.tsx` and `MixSetup.test.tsx` (passed 2026-11-11). | Human review for Verified (the checklist's Needs a person) |
| S31-0083-01 | Implemented (automated), 2026-11-11 | `web/src/views/s31-0083-01-my-mixes-hierarchy.test.tsx`: the current mix says Playing now, Paused or Current mix; every draft says Saved and none claims to play; the render line is numbered (1st, 2nd in line), says the current mix goes first and that it doesn't change what's playing; the 1st in line says Rendering now once the current mix is done; what plays comes first on the page (passed 2026-11-11). | Human review for Verified (the checklist's Needs a person) |
| S31-0083-03 | Implemented (automated), 2026-11-11 | `web/src/views/s31-0083-03-timeline-scale.test.tsx`: at 2, 20 and 100 songs with long, RTL, CJK and duplicate names, one row per song and per transition; each song row keeps its number, full title (title attribute, dir=auto), artist, own occurrence and actions named for that song; each transition keeps a worded status and failures say why; duplicates stay distinct in a 100-song list (passed 2026-11-11). | Human review for Verified (the checklist's Needs a person) |
| S31-0084-02 | Implemented (automated), 2026-11-11 | `web/src/views/s31-0084-02-studio-lanes.test.tsx`: each lane shows Voice, Drums, Bass or Melody in words and each square's name says its part and on or off; solo reads "Solo:" in bold while the rest fade; on, now and unavailable have their own mark, edge, hatching and strike-through (plus a forced-colours border); no lane has a colour of its own; an unavailable part says so in its name (passed 2026-11-11). | Human review for Verified (the checklist's Needs a person) |
| S31-0086-02 | Implemented (automated), 2026-11-11 | `web/src/views/s31-0086-02-library-rows.test.tsx`: each row reads title, artist, facts, readiness, then actions; a blocked song's reason sits with its status before any action; Prioritize and Never play wait behind the row menu while Start a mix stays in view; `styles/operations.css` keeps that order at desktop, tablet and phone widths (passed 2026-11-11). | Human review for Verified (the checklist's Needs a person) |
| S31-0087-04 | Implemented (automated), 2026-11-11 | `web/e2e/mp-0298-responsive-and-a11y.e2e.ts` MP-0298-01 (reflow 320 to 3840px), -02 (200% and 400% zoom), -03 (24px or a named inline or spacing exception; 44px only for primary touch targets) and -05 (4.5:1 text, 3:1 large text and field edges, both themes) write measurement reports and passed 2026-11-11 (recorded in the measured micro-polish checklist); focus visibility in `web/e2e/flows.e2e.ts` 'focus is never hidden behind the bottom bar on a phone'; `web/src/s31-0087-04-wcag-gates.test.ts` holds the spec and `selecta-3-1-verification-matrix.md` to 24px as the AA rule and 44px as a product aim (passed 2026-11-11). | Human review for Verified (the checklist's Needs a person) |

All work remains on an unmerged **draft** PR. Captured screenshots do not count as approved visual comparisons, a Web job does not count as full CI, and a source test does not replace human AT, audible or unassisted research. See [visual review instructions](selecta-3-1-visual-review.md).

## Evidence schema required for each S31 ID

1. **Identity:** S31 ID, related ADR, inherited S3/T/P/parity IDs, product surface, issue priority.
2. **Decision:** owner, date, Accepted/Rejected/Superseded rationale and dependencies.
3. **Implementation:** PR, exact commit, merged status and file scope; partial implementation clearly described.
4. **Acceptance:** expected observable outcome, adverse test, actual result, supported browser/OS.
5. **Automated:** exact commands/CI link, named assertions, fixture and failure result. A green build alone is insufficient.
6. **Visual:** screenshot/test reference, approved baseline, dark/light, viewport, font, clock and source-safe synthetic metadata.
7. **Manual:** keyboard, supported screen reader with OS/AT version, touch, 200/400% zoom, user-task outcomes, as applicable.
8. **Music and data:** real audio continuity/revision-accurate FLAC/bridge or draft provenance as applicable; unrelated data unchanged.
9. **Scale/security:** hardware, production build, timings, external network observation and unsupported platforms where applicable.
10. **Release:** P0/P1/P2 disposition, owner review, rollback confirmation, open limitations and final Verified sign-off.

## Status advancement

- **Not started:** planning only; no runtime work or proven acceptance outcome.
- **In progress:** approved implementing PR with task IDs and actual code/test changes.
- **Implemented:** code merged and appropriate automated test evidence recorded.
- **Verified:** implemented *and* relevant human visual, accessibility, music, usability and performance acceptance independently recorded.
- **Blocked / N/A:** recorded reason with owner and impact. Neither counts as Verified.

Every check in [the 116-item tracker](selecta-3-1-implementation-checklist.md) remains unchecked until Verified. Do not rewrite historical 3.0 data; reconcile via evidence and link the old items.

## Current disposition

**Accepted ADR programme (2026-11-12): 96 Implemented with automated evidence, 1 In progress, 19 need a person, 0 Verified.** The PR #25 table above is the historical partial-task snapshot; current task states are on the checklist lines. Remaining CI, manual accessibility/audio/usability, scale and owner acceptance must not be invented. No merge is warranted by this partial record.
