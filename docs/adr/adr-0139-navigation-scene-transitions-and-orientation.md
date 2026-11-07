# ADR-0139 — Navigation choreography, breadcrumbs, page continuity and scene orientation

- **Decision:** Proposed; no owner acceptance is asserted.
- **Implementation:** Not started (0/8 new MI tasks).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta immersive experience and microinteractions; 2026-11-07; main `525a49cee6b0a02cae7e71dbe3f336a0141ec2d7` (after merged PR #30).
- **Priority / phase:** P0 / Shell.
- **Related earlier ADRs:** ADR-0115, ADR-0092, ADR-0132; earlier decisions and historical implementation claims remain intact.
- **Source touchpoints:** web/src/shell/Shell.tsx; web/src/shell/manifest.ts; web/src/router.ts.

## Context and evidence boundary

The shell switches from 212px rail to mobile bottom bar, preserves Back/Forward and owns a mini player. Navigation motion must reinforce where the user went, never restart audio or mask the route context. This is a **new experience delta** to existing code and ADR-0114–0134, not a claim that existing implementations are missing. No proposed behavior is shipped by merging these documents. Human visual, audio, screen-reader, touch and comprehension results are not asserted.

## Proposed decision

- Treat primary navigation as change of task context, not a full-screen theatrical transition; maintain a stable rail, header and player.
- Use one restrained content-region reveal on navigation and a static active destination indicator; no delayed click activation.
- Breadcrumbs, URL, active nav and command palette names must agree, including draft versus current edit paths.
- When returning from an overlay or editor, restore meaningful song/seam focus and scroll when still valid; explain missing targets.
- On mobile preserve keyboard visibility and safe-area geometry, moving chrome out of the way when a text keyboard appears.
- Collapsed rail tooltips and More drawer must remain fully operable by keyboard/touch, with no hover-only information.

## Interaction choreography and visual behavior

- Route content: 120–180 ms opacity reveal, optionally ≤8 px translation in normal motion, instant in reduced motion.
- Active nav state: immediate semantic selection, with ≤120 ms background-color transition; no travelling shared underline across unrelated destinations.
- Drawer from desktop side or mobile bottom: 180–240 ms transform/opacity, with focus entered only after mount and restored on close.
- Back/Forward restores recorded scroll without added scroll animation; page transitions never control playback.

## Alternatives, trade-offs and limits

Prefer semantic, truthful feedback over cosmetic animation; static UI is better than invented musical evidence, gratuitous movement or a delayed critical control. Where visual polish conflicts with accurate playback, scope/revision identity, accessibility or control, behavior and safety win. Do not add runtime dependencies, processing APIs, telemetry or new audio assets under this documentation decision.

## Implementation tasks — all Not started, none Verified

1. **MI-0139-01 — Storyboard all navigation paths.** Acceptance: Listen, Make a Mix, My Mixes, Library and Workspace show destination/route equivalence. Required verification: Route manifest and direct-link fixtures. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
2. **MI-0139-02 — Specify rail and bottom-bar states.** Acceptance: Open/collapsed/mobile states preserve labeling and full target visibility. Required verification: 320–2560 CSS pixel testing. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
3. **MI-0139-03 — Define route motion and focus order.** Acceptance: Focus announces destination; motion cannot defer navigation outcome. Required verification: Reduced motion, Back/Forward and screen reader tests. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
4. **MI-0139-04 — Validate mini-player invariance.** Acceptance: Navigation never creates a new player, restarts audio or drops existing queue. Required verification: Real audio route-switch test. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
5. **MI-0139-05 — Handle returning from deep editor.** Acceptance: Known selection/scroll restored, stale target explained. Required verification: Deleted draft and changed mix fixtures. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
6. **MI-0139-06 — Guard keyboard occlusion.** Acceptance: Bottom bars and dialogs do not conceal active input or focused control. Required verification: Physical touch and on-screen keyboard tests. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
7. **MI-0139-07 — Audit accessibility of collapsed navigation.** Acceptance: Icons retain full labels and tooltips not required for essential information. Required verification: NVDA/Edge, keyboard and touch review. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
8. **MI-0139-08 — Document legacy route compatibility.** Acceptance: Aliases, query filters and browser history keep their meaning. Required verification: E2E route regression matrix. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**

## Shared invariants and negative cases

Preserve original audio files; current/draft and revision identities; one audio-focus owner; manual Pause authority; explicit bridge consent and atomic join; full eight-lane Studio; existing library/route/search operations; blind-study neutrality; decodable exact-revision FLAC; local-only server and truthful LRCLIB metadata disclosure. **No desktop packager, native/browser folder-picker bridge, accounts, SaaS, cloud media upload, subscriptions, remote telemetry or sound effects.**

Review idle, hovered, focused, pressed, selected, queued, rendering, ready, blocked, failed, retry, cancellation, stale response, missing metadata, long/RTL names, low-resource mode and offline recovery. Run dark/light/system, forced colors, 320–2560px, 200/400% zoom, coarse touch, keyboard, NVDA/Edge, reduced-motion and audio-continuity checks as applicable. Automated screenshots/test passes are not human validation.

## Status, dependencies and records

A later implementing PR must provide a task-specific diff, source file, test ID, exact SHA and separately recorded human evidence before advancing **Implemented** or **Verified**. Owner decision must be recorded before **Accepted**. [Immersive programme roadmap](selecta-microinteraction-roadmap.md) · [240-task checklist](selecta-microinteraction-implementation-checklist.md) · [evidence ledger](selecta-microinteraction-evidence.md) · [state and motion matrix](selecta-microinteraction-motion-matrix.md) · [release gates](selecta-microinteraction-release-gates.md).
