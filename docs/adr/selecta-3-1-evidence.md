# Selecta 3.1 — finishing implementation and independent verification ledger

- **Date:** 2026-11-07.
- **Programme decisions:** 11 Proposed (ADR-0078–0088); none accepted as part of this proposal.
- **Implementation:** PR #25 merged as `6d78cf420c55817e967fc3b8db45749c9817926e`; 29 selected S31 tasks had partial source mapping, while **0/116 are independently Verified** in this ledger.
- **Scope:** PR #25 began as docs-only, now contains targeted frontend/unit/Edge changes and synthetic screenshot upload. No backend/schema/audio-engine/dependency changes. Baseline `main` is `3b01dc1336aab0f1cb0a4d85be5eba359de81831`.
- **Important historical distinction:** PR #24 is **merged**. The earlier 3.0 ledger still records it as in progress/open and 0 merged; that is a stale planning snapshot requiring item-by-item reconciliation, **not** a basis for retroactively marking any S3 item complete.
- **Evidence presently available:** source inspection, existing suites, new concurrency/identity/keyboard regressions and Web unit/build success on earlier PR heads. Final-head aggregate CI must be checked after the last commit. Synthetic screenshots are *review candidates only*: no approved images, human AT/usability, real audio audition or scale benchmarks are claimed.

## Individual ADR status

| ADR | Decision | Implementation | Verified | Workstream |
|---|---|---|---:|---|
| [ADR-0078](adr-0078-baseline-evidence-and-governance.md) | Proposed | In progress (partial) | 0/10 | Reconcile the shipped 3.0 baseline and govern finishing work |
| [ADR-0079](adr-0079-visual-system-and-css-ownership.md) | Proposed | In progress (partial) | 0/10 | Unify typography, themes, visual rhythm and CSS ownership |
| [ADR-0080](adr-0080-interaction-state-recovery-and-undo.md) | Proposed | In progress (partial) | 0/10 | Make controls, asynchronous states, recovery and Undo dependable |
| [ADR-0081](adr-0081-first-run-explore-and-mix-choice.md) | Proposed | In progress (partial) | 0/10 | Reduce friction from first music folder to a confident first mix |
| [ADR-0082](adr-0082-listen-shell-stage-and-audio-trust.md) | Proposed | In progress (partial) | 0/11 | Polish Listen, navigation, mini-player and Stage without audio regressions |
| [ADR-0083](adr-0083-mixes-editor-inspector-and-export.md) | Proposed | In progress (partial) | 0/12 | Make drafts, timeline editing, transition intent and export unambiguous |
| [ADR-0084](adr-0084-stem-studio-workstation-polish.md) | Proposed | In progress (partial) | 0/9 | Refine Stem Studio's expert controls without reducing capability |
| [ADR-0085](adr-0085-requests-and-music-discovery.md) | Proposed | In progress (partial) | 0/10 | Clarify Requests, consented bridges and discovery auditions |
| [ADR-0086](adr-0086-library-workspace-study-and-operational-trust.md) | Proposed | In progress (partial) | 0/11 | Polish Library, Workspace, studies and operational status |
| [ADR-0087](adr-0087-accessibility-responsive-and-performance-gates.md) | Proposed | In progress (partial) | 0/11 | Verify WCAG, device reflow, audio latency and scale |
| [ADR-0088](adr-0088-research-visual-regression-and-release.md) | Proposed | In progress (partial) | 0/12 | Require observable user, visual and product acceptance before release |
| **Total** | 11 proposed | 0 implemented | **0/116** | |

## Implementation on PR #25 — 29 partial tasks, none Verified

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
| S31-0082-01 | In progress | `Now.tsx` collapses optional display options and retains transport prominence (`6e0c618`) | Actual listener tasks in playing/paused/error and both themes |
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

**Proposed ADR programme with limited source changes in progress, 0 Implemented and 0 Verified.** Remaining CI, manual accessibility/audio/usability, scale and owner acceptance must not be invented. No merge is warranted by this partial record.
