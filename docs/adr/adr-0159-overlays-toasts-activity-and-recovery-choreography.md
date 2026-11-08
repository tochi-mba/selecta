# ADR-0159 - Dialogs, drawers, toasts, Activity and recoverable mistakes

- **Decision:** Accepted by the repository owner on 2026-11-07; implementation and independent verification remain separately evidenced.
- **Implementation:** 7/8 Implemented, 0/8 In progress, 1 Not started (source-level, PR #31).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta immersive experience and microinteractions; 2026-11-07; main `525a49cee6b0a02cae7e71dbe3f336a0141ec2d7` (after merged PR #30).
- **Priority / phase:** P0 / Shared feedback.
- **Related earlier ADRs:** ADR-0131, ADR-0094, ADR-0095; earlier decisions and historical implementation claims remain intact.
- **Source touchpoints:** web/src/ui/controls.tsx; web/src/ui/toasts.tsx; web/src/ui/ActivityPanel.tsx; web/src/state/activity.ts.

## Context and evidence boundary

A user can open deep overlays during music playback. Animation must never conceal focus, obscure an Undo, or use generic 'success' before server confirmation. This is a **new experience delta** to existing code and ADR-0114–0134, not a claim that existing implementations are missing. PR #31 includes source-level implementation and tests, but this proposal remains owner-unaccepted and independently unverified. Human visual, audio, screen-reader, touch and comprehension results are not asserted.

## Proposed decision

- Modal overlays open with proper accessible name and focus capture; only topmost overlay receives keyboard interaction.
- Escape closes the innermost dismissible layer first; closing a nested overlay restores focus to the invoking control if it still exists.
- Toasts confirm exact outcomes briefly while Activity preserves in-session context and scoped Undo after a toast disappears.
- Prioritize errors/required consent over routine background notifications; Stage suppresses ordinary toasts.
- Undo must refer to the newest relevant action within its exact mix scope and refuse stale inverse operations.
- Use constructive error copy stating what happened, what remained safe and the next action-without false promises.

## Interaction choreography and visual behavior

- Dialog/drawer enter ≤220 ms using opacity/transform; no large backdrop scale or bouncy spring.
- Toasts enter ≤160 ms and exit ≤160 ms only after message is no longer actionable elsewhere; focus keeps toast alive.
- Undo confirms with a stable state marker and does not visually reverse before backend confirms scope.
- In reduced motion overlays appear immediately, focus behavior unchanged.

## Alternatives, trade-offs and limits

Prefer semantic, truthful feedback over cosmetic animation; static UI is better than invented musical evidence, gratuitous movement or a delayed critical control. Where visual polish conflicts with accurate playback, scope/revision identity, accessibility or control, behavior and safety win. Do not add runtime dependencies, processing APIs, telemetry or new audio assets under this documentation decision.

## Implementation tasks - 5 source-level Implemented, 0 independently Verified

1. **MI-0159-01 - Specify overlay stacking and focus.** Acceptance: Nested modal/inert/escape behavior correct without focus loss. Required verification: Keyboard, NVDA and portal tests. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: modal focus entry/trap/restore, Escape and inert overlay behavior in `ui/controls.tsx` with control tests; NVDA review remains open.**
2. **MI-0159-02 - Design toast duration policy.** Acceptance: Errors/Undo durable in Activity and not obscured by bottom chrome. Required verification: Burst, timer and mobile tests. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `web/src/ui/toasts.tsx`, `web/src/ui/controls.tsx`; `web/src/ui/controls.test.tsx`; independent checks pending.**
3. **MI-0159-03 - Guard scope-aware Undo.** Acceptance: Older undo cannot revert newer unrelated action. Required verification: Current/draft concurrency tests. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `web/src/ui/toasts.tsx`, `web/src/ui/controls.tsx`; `web/src/ui/controls.test.tsx`; independent checks pending.**
4. **MI-0159-04 - Define recovery copy grammar.** Acceptance: Failure, surviving state, retry and affected object named. Required verification: Copy audit of major API failures. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: runtime/source contract and mapped implementation evidence in `docs/adr/selecta-microinteraction-final-contracts.md`; applicable independent human/device/audio review remains open.**
5. **MI-0159-05 - Choreograph async confirmation.** Acceptance: Pending vs successful mutation never visually indistinguishable. Required verification: Delayed action fixtures. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `web/src/ui/toasts.tsx`, `web/src/ui/controls.tsx`; `web/src/ui/controls.test.tsx`; independent checks pending.**
6. **MI-0159-06 - Protect Stage from noise.** Acceptance: No ordinary toasts disturb lyrics while critical failures remain reachable. Required verification: Stage and activity integration. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `web/src/ui/toasts.tsx`, `web/src/ui/controls.tsx`; `web/src/ui/controls.test.tsx`; independent checks pending.**
7. **MI-0159-07 - Handle disappearing invokers.** Acceptance: Focus falls back to meaningful page start when item deleted. Required verification: Deleted draft/seam overlay tests. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `web/src/ui/toasts.tsx`, `web/src/ui/controls.tsx`; `web/src/ui/controls.test.tsx`; independent checks pending.**
8. **MI-0159-08 - Measure error recovery.** Acceptance: User can recover from failed create/move/export/request without coaching. Required verification: Injected fault study and raw counts. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: -; evidence: -.**

## Shared invariants and negative cases

Preserve original audio files; current/draft and revision identities; one audio-focus owner; manual Pause authority; explicit bridge consent and atomic join; full eight-lane Studio; existing library/route/search operations; blind-study neutrality; decodable exact-revision FLAC; local-only server and truthful LRCLIB metadata disclosure. **No desktop packager, native/browser folder-picker bridge, accounts, SaaS, cloud media upload, subscriptions, remote telemetry or sound effects.**

Review idle, hovered, focused, pressed, selected, queued, rendering, ready, blocked, failed, retry, cancellation, stale response, missing metadata, long/RTL names, low-resource mode and offline recovery. Run dark/light/system, forced colors, 320–2560px, 200/400% zoom, coarse touch, keyboard, NVDA/Edge, reduced-motion and audio-continuity checks as applicable. Automated screenshots/test passes are not human validation.

## Status, dependencies and records

PR #31 records code implementation with referenced source and automation. **Implemented is not independently Verified**; a named reviewer must still record all required real-world theme, accessibility, audio, performance and user results before Yes or owner Acceptance. [Immersive programme roadmap](selecta-microinteraction-roadmap.md) · [240-task checklist](selecta-microinteraction-implementation-checklist.md) · [evidence ledger](selecta-microinteraction-evidence.md) · [state and motion matrix](selecta-microinteraction-motion-matrix.md) · [release gates](selecta-microinteraction-release-gates.md).
