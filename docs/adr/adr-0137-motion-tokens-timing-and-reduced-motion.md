# ADR-0137 — Motion grammar: timings, easing, causality and reduced-motion equivalence

- **Decision:** Proposed; no owner acceptance is asserted.
- **Implementation:** 6/8 Implemented, 1/8 In progress, 1 Not started (source-level, PR #31).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta immersive experience and microinteractions; 2026-11-07; main `525a49cee6b0a02cae7e71dbe3f336a0141ec2d7` (after merged PR #30).
- **Priority / phase:** P0 / Motion foundation.
- **Related earlier ADRs:** ADR-0044, ADR-0132, ADR-0130; earlier decisions and historical implementation claims remain intact.
- **Source touchpoints:** web/src/styles/tokens.css; web/src/styles/polish.css; web/src/ui/Skeleton.tsx.

## Context and evidence boundary

The current motion tokens specify 120 ms and 240 ms roles, but a full motion grammar needs to distinguish navigation, feedback, audio-reactive content, progress and decorative effects without creating a spectacle. This is a **new experience delta** to existing code and ADR-0114–0134, not a claim that existing implementations are missing. PR #31 includes source-level implementation and tests, but this proposal remains owner-unaccepted and independently unverified. Human visual, audio, screen-reader, touch and comprehension results are not asserted.

## Proposed decision

- Define semantic durations: instant 0–60 ms for acknowledgment, quick 100–160 ms for local feedback, standard 180–260 ms for overlays and structural reveals, deliberate 300–400 ms only for explicitly requested orientation aids.
- Define directional easing for entering/leaving surfaces; no spring overshoot on playback, precise timeline drops or dialogs that contain data.
- Prefer opacity and transform for transitions; avoid animated height and width where hit targets, scroll position or layout shift would move.
- Animate only causally true state changes. Queued is not running; rendering progress is not an invented percentage; a transition is not ready until confirmed.
- Time-based audio-reactive motion may use real analyser or playback state, but cannot falsely imply accurate bars, beats or waveform samples.
- Respect dynamic prefers-reduced-motion, tab visibility, battery/resource constraints and system high-contrast settings; provide an equivalent textual state.

## Interaction choreography and visual behavior

- Button acknowledgment 100–140 ms; chip selection 120–160 ms; tooltip 0–120 ms; menu/overlay 160–240 ms.
- Drag feedback follows pointer continuously but settles within 120–180 ms after valid release; invalid drop returns without misleading persistence.
- Song change: restrained opacity exchange 160–240 ms; display lyrics only when matching actual current song.
- Reduced motion: instant opacity/state swap, no spatial travel, no persistent pulse, no auto-scroll that disorients focus.

## Alternatives, trade-offs and limits

Prefer semantic, truthful feedback over cosmetic animation; static UI is better than invented musical evidence, gratuitous movement or a delayed critical control. Where visual polish conflicts with accurate playback, scope/revision identity, accessibility or control, behavior and safety win. Do not add runtime dependencies, processing APIs, telemetry or new audio assets under this documentation decision.

## Implementation tasks — 6 source-level Implemented, 0 independently Verified

1. **MI-0137-01 — Publish semantic motion token catalogue.** Acceptance: Each motion role names duration, easing, properties, cause and fallback. Required verification: Computed styles, visual spec and ADR review. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `web/src/styles/tokens.css`, `web/src/styles/polish.css`; `web/src/views/Now.test.tsx`, `web/src/ui/controls.test.tsx`; independent checks pending.**
2. **MI-0137-02 — Define interruption and cancellation.** Acceptance: New user action cancels older animation without reverting newer state. Required verification: Rapid toggle and race tests. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `web/src/styles/tokens.css`, `web/src/styles/polish.css`; `web/src/views/Now.test.tsx`, `web/src/ui/controls.test.tsx`; independent checks pending.**
3. **MI-0137-03 — Specify audio-truth constraint.** Acceptance: No animations claim beat alignment or actual waveform without real clock/analyser evidence. Required verification: Synthetic beat mismatch and player fixture. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `web/src/styles/tokens.css`, `web/src/styles/polish.css`; `web/src/views/Now.test.tsx`, `web/src/ui/controls.test.tsx`; independent checks pending.**
4. **MI-0137-04 — Design reduced-motion equivalence.** Acceptance: Every essential state remains identifiable with 0 ms travel and unchanged task completion. Required verification: Live OS preference toggling and manual check. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `web/src/styles/tokens.css`, `web/src/styles/polish.css`; `web/src/views/Now.test.tsx`, `web/src/ui/controls.test.tsx`; independent checks pending.**
5. **MI-0137-05 — Protect focus and target geometry.** Acceptance: No active animation changes pointer targets or keyboard focus unexpectedly. Required verification: Tap-while-moving and keyboard tests. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `web/src/styles/tokens.css`, `web/src/styles/polish.css`; `web/src/views/Now.test.tsx`, `web/src/ui/controls.test.tsx`; independent checks pending.**
6. **MI-0137-06 — Control visualizer resource use.** Acceptance: Hidden, offscreen, paused and reduced-motion visualizations stop expensive frames. Required verification: CPU and visibility measurement. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `web/src/styles/tokens.css`, `web/src/styles/polish.css`; `web/src/views/Now.test.tsx`, `web/src/ui/controls.test.tsx`; independent checks pending.**
7. **MI-0137-07 — Create motion storyboard baselines.** Acceptance: Cover player, navigation, request, grid, card, job and export lifecycles. Required verification: Screen recordings at normal and 0.25x speed. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
8. **MI-0137-08 — Set motion performance budgets.** Acceptance: No long main-thread animation or layout shift for core controls. Required verification: Performance traces with hardware and long task log. **Implementation: In progress; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `web/src/styles/tokens.css`, `web/src/styles/polish.css`; partial behavior or baseline, task acceptance outstanding.**

## Shared invariants and negative cases

Preserve original audio files; current/draft and revision identities; one audio-focus owner; manual Pause authority; explicit bridge consent and atomic join; full eight-lane Studio; existing library/route/search operations; blind-study neutrality; decodable exact-revision FLAC; local-only server and truthful LRCLIB metadata disclosure. **No desktop packager, native/browser folder-picker bridge, accounts, SaaS, cloud media upload, subscriptions, remote telemetry or sound effects.**

Review idle, hovered, focused, pressed, selected, queued, rendering, ready, blocked, failed, retry, cancellation, stale response, missing metadata, long/RTL names, low-resource mode and offline recovery. Run dark/light/system, forced colors, 320–2560px, 200/400% zoom, coarse touch, keyboard, NVDA/Edge, reduced-motion and audio-continuity checks as applicable. Automated screenshots/test passes are not human validation.

## Status, dependencies and records

PR #31 records code implementation with referenced source and automation. **Implemented is not independently Verified**; a named reviewer must still record all required real-world theme, accessibility, audio, performance and user results before Yes or owner Acceptance. [Immersive programme roadmap](selecta-microinteraction-roadmap.md) · [240-task checklist](selecta-microinteraction-implementation-checklist.md) · [evidence ledger](selecta-microinteraction-evidence.md) · [state and motion matrix](selecta-microinteraction-motion-matrix.md) · [release gates](selecta-microinteraction-release-gates.md).
