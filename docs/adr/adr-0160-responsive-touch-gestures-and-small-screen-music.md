# ADR-0160 - Responsive gestures: thumb reach, safe-area geometry, keyboard occlusion and zoom

- **Decision:** Accepted by the repository owner on 2026-11-07; implementation and independent verification remain separately evidenced.
- **Implementation:** 7/8 Implemented, 0/8 In progress, 1 Not started (source-level, PR #31).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta immersive experience and microinteractions; 2026-11-07; main `525a49cee6b0a02cae7e71dbe3f336a0141ec2d7` (after merged PR #30).
- **Priority / phase:** P0 / Responsive.
- **Related earlier ADRs:** ADR-0132, ADR-0115, ADR-0122; earlier decisions and historical implementation claims remain intact.
- **Source touchpoints:** web/src/styles/shell.css; web/src/styles/creation.css; web/src/styles/listening.css; web/src/shell/Shell.tsx.

## Context and evidence boundary

The application uses a desktop rail, mobile bar, sticky transport, sheets and a horizontally scrollable stem grid. More animations or gestures can worsen occlusion and scrolling if they are not carefully scoped. This is a **new experience delta** to existing code and ADR-0114–0134, not a claim that existing implementations are missing. PR #31 includes source-level implementation and tests, but this proposal remains owner-unaccepted and independently unverified. Human visual, audio, screen-reader, touch and comprehension results are not asserted.

## Proposed decision

- Design by task and available space rather than shrinking desktop panels unchanged; preserve actual controls and semantics.
- Bottom navigation, mini-player, sticky Listen controls and virtual keyboard never cover the active target.
- Avoid swipe gestures for destructive actions or those with no visible alternative; preserve touch scroll outside explicit drag handles.
- Provide obvious, large targets and reliable feedback in compact Library and editor layouts.
- Sheets and drawers retain accessible close affordances and the context of the selected song/seam.
- Adapt for landscape, safe areas, tall/short viewports, larger fonts and 200/400% zoom.

## Interaction choreography and visual behavior

- Mobile sheet rises ≤200 ms without shifting document scroll unexpectedly; reduced motion appears instantly.
- Only drag handles capture touch movement; other touch moves scroll naturally.
- Keyboard insets change chrome immediately after viewport adjustment, no prolonged animation while typing.
- Pinned transport/mini-player may fade on state change but not slide over an active focus target.

## Alternatives, trade-offs and limits

Prefer semantic, truthful feedback over cosmetic animation; static UI is better than invented musical evidence, gratuitous movement or a delayed critical control. Where visual polish conflicts with accurate playback, scope/revision identity, accessibility or control, behavior and safety win. Do not add runtime dependencies, processing APIs, telemetry or new audio assets under this documentation decision.

## Implementation tasks - 3 source-level Implemented, 0 independently Verified

1. **MI-0160-01 - Audit viewport geometry.** Acceptance: 320/375/430/760/768/1280 and short-height layouts no essential occlusion. Required verification: Automated and physical screenshots. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: runtime/source contract and mapped implementation evidence in `docs/adr/selecta-microinteraction-final-contracts.md`; applicable independent human/device/audio review remains open.**
2. **MI-0160-02 - Check dynamic virtual keyboard.** Acceptance: Active input stays visible while bars collapse/restack. Required verification: Android/iOS-compatible browser tests. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `web/src/styles/tokens.css`, `web/src/views/EditorRows.tsx`; `web/src/views/Mix.test.tsx`, `web/src/shell/Shell.test.tsx`; independent checks pending.**
3. **MI-0160-03 - Specify gesture priority.** Acceptance: Scroll, reorder, slider, scrub and grid paint do not conflict. Required verification: Coarse-pointer usability trial. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `web/src/styles/tokens.css`, `web/src/views/EditorRows.tsx`; `web/src/views/Mix.test.tsx`, `web/src/shell/Shell.test.tsx`; independent checks pending.**
4. **MI-0160-04 - Ensure alternatives to swipes.** Acceptance: Every destructive/edit action has visible or keyboard equivalent. Required verification: Pointer and AT tests. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: visible buttons and keyboard reorder/edit equivalents accompany pointer gestures in `EditorRows.tsx`; physical touch/AT review remains open.**
5. **MI-0160-05 - Validate target size and spacing.** Acceptance: Touch hits accurate in comfortable and compact densities. Required verification: Physical tap-error review. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `web/src/styles/tokens.css`, `web/src/views/EditorRows.tsx`; `web/src/views/Mix.test.tsx`, `web/src/shell/Shell.test.tsx`; independent checks pending.**
6. **MI-0160-06 - Preserve sheet context.** Acceptance: Selected object visible/announced when opening or returning. Required verification: Editor and Studio mobile task. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: runtime/source contract and mapped implementation evidence in `docs/adr/selecta-microinteraction-final-contracts.md`; applicable independent human/device/audio review remains open.**
7. **MI-0160-07 - Verify zoom and large fonts.** Acceptance: 400% zoom, text enlargement and safe-area preserve tasks. Required verification: WCAG reflow/resize audit. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: runtime/source contract and mapped implementation evidence in `docs/adr/selecta-microinteraction-final-contracts.md`; applicable independent human/device/audio review remains open.**
8. **MI-0160-08 - Measure mobile task fluency.** Acceptance: First play, request, edit and export succeed without gesture coaching. Required verification: Uncoached mobile study. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: -; evidence: -.**

## Shared invariants and negative cases

Preserve original audio files; current/draft and revision identities; one audio-focus owner; manual Pause authority; explicit bridge consent and atomic join; full eight-lane Studio; existing library/route/search operations; blind-study neutrality; decodable exact-revision FLAC; local-only server and truthful LRCLIB metadata disclosure. **No desktop packager, native/browser folder-picker bridge, accounts, SaaS, cloud media upload, subscriptions, remote telemetry or sound effects.**

Review idle, hovered, focused, pressed, selected, queued, rendering, ready, blocked, failed, retry, cancellation, stale response, missing metadata, long/RTL names, low-resource mode and offline recovery. Run dark/light/system, forced colors, 320–2560px, 200/400% zoom, coarse touch, keyboard, NVDA/Edge, reduced-motion and audio-continuity checks as applicable. Automated screenshots/test passes are not human validation.

## Status, dependencies and records

PR #31 records code implementation with referenced source and automation. **Implemented is not independently Verified**; a named reviewer must still record all required real-world theme, accessibility, audio, performance and user results before Yes or owner Acceptance. [Immersive programme roadmap](selecta-microinteraction-roadmap.md) · [240-task checklist](selecta-microinteraction-implementation-checklist.md) · [evidence ledger](selecta-microinteraction-evidence.md) · [state and motion matrix](selecta-microinteraction-motion-matrix.md) · [release gates](selecta-microinteraction-release-gates.md).
