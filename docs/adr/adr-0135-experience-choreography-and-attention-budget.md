# ADR-0135 — Experience choreography, musical attention and the calm-to-creative ladder

- **Decision:** Accepted by the repository owner on 2026-11-07; implementation and independent verification remain separately evidenced.
- **Implementation:** 6/8 Implemented, 0/8 In progress, 2 Not started (source-level, PR #31).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta immersive experience and microinteractions; 2026-11-07; main `525a49cee6b0a02cae7e71dbe3f336a0141ec2d7` (after merged PR #30).
- **Priority / phase:** P0 / Experience foundation.
- **Related earlier ADRs:** ADR-0114, ADR-0116, ADR-0130, ADR-0131; earlier decisions and historical implementation claims remain intact.
- **Source touchpoints:** web/src/App.tsx; web/src/shell/Shell.tsx; web/src/views/Now.tsx.

## Context and evidence boundary

Selecta is simultaneously an autonomous DJ, discovery engine and precise creative workstation. The current source offers these capabilities but does not prove how attention behaves during real listening. No animation should compete with a great transition. This is a **new experience delta** to existing code and ADR-0114–0134, not a claim that existing implementations are missing. PR #31 includes source-level implementation and tests, but this proposal remains owner-unaccepted and independently unverified. Human visual, audio, screen-reader, touch and comprehension results are not asserted.

## Proposed decision

- Define four user attention modes: passive Listen, intentional Steering, focused Creation and precise Studio; use explicit entry and return paths rather than automatic mode changes.
- Choose one perceptual focal point per scene: song identity in Listen, one decision in Make a Mix, selected song or seam in Edit, active stem/time cell in Studio.
- Differentiate background work from decisions needing consent. Rendering should never steal focus, play sound or open an overlay.
- Require every expressive animation to explain an event, preserve continuity or express real audio; otherwise prefer stillness.
- Introduce a scene-transition storyboard covering first run, first play, first seam, requests, edit, preview, export and recovery; mark every interruption as deliberate.
- Keep the product's warm black/cream/lime visual identity and usable original controls; no fake DJ hardware or manufactured evidence of quality.

## Interaction choreography and visual behavior

- Idle baseline: no pulsing accents or perpetual celebratory loops; animation frequency depends on actual playback or a user action.
- Mode entry: 120–240 ms opacity/position continuity only; never obscure transport or move focus until navigation completes.
- When a seam becomes ready, one short local state change, not a page-level celebration; unready remains visibly unready.
- Under reduced motion, retain the exact information sequence using instant state changes and labels.

## Alternatives, trade-offs and limits

Prefer semantic, truthful feedback over cosmetic animation; static UI is better than invented musical evidence, gratuitous movement or a delayed critical control. Where visual polish conflicts with accurate playback, scope/revision identity, accessibility or control, behavior and safety win. Do not add runtime dependencies, processing APIs, telemetry or new audio assets under this documentation decision.

## Implementation tasks — 2 source-level Implemented, 0 independently Verified

1. **MI-0135-01 — Map attention across seven core journeys.** Acceptance: Each scene has a single primary decision and measured distraction budget; note all interruptions. Required verification: Storyboard review with listener/creator and source inventory. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: `selecta-microinteraction-design-baselines.md` and its source inventory; independent listener/creator review remains open.**
2. **MI-0135-02 — Define the four attention modes.** Acceptance: List entry/exit points, retained focus and no unexpected playback changes for each. Required verification: Keyboard walkthrough and route-flow evidence. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: runtime/source contract and mapped implementation evidence in `docs/adr/selecta-microinteraction-final-contracts.md`; applicable independent human/device/audio review remains open.**
3. **MI-0135-03 — Create beat-independent choreography rules.** Acceptance: UI animation never implies beat-accurate timing without actual audio state. Required verification: Player-state fixture and audio synchronization review. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `web/src/views/Now.tsx`, `web/src/ui/toasts.tsx`; `web/src/views/Now.test.tsx`, `web/src/ui/controls.test.tsx`; independent checks pending.**
4. **MI-0135-04 — Author interruption policy.** Acceptance: Only failures, required consent and user-initiated overlays can interrupt listening. Required verification: Injected render, notification and request tests. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `web/src/views/Now.tsx`, `web/src/ui/toasts.tsx`; `web/src/views/Now.test.tsx`, `web/src/ui/controls.test.tsx`; independent checks pending.**
5. **MI-0135-05 — Specify transition-to-creation continuity.** Acceptance: Selected song/seam identity survives navigating between Listen, Edit and Studio. Required verification: Deep-link, Back/Forward and revision tests. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: runtime/source contract and mapped implementation evidence in `docs/adr/selecta-microinteraction-final-contracts.md`; applicable independent human/device/audio review remains open.**
6. **MI-0135-06 — Design first-delight evaluation.** Acceptance: Compare first mix, first seam and first request confidence with uncoached listeners. Required verification: Study protocol and raw success/hesitation counts. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
7. **MI-0135-07 — Inventory overload failure cases.** Acceptance: Long titles, multiple jobs, failed request, toast burst and nested overlay preserve hierarchy. Required verification: Dark/light/mobile screenshot review. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: runtime/source contract and mapped implementation evidence in `docs/adr/selecta-microinteraction-final-contracts.md`; applicable independent human/device/audio review remains open.**
8. **MI-0135-08 — Record scene and owner sign-off.** Acceptance: Each proposed scene has owner, alternatives, no-go and traceable implementation evidence. Required verification: Decision record with exact SHA and accessibility/audio reviewer. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**

## Shared invariants and negative cases

Preserve original audio files; current/draft and revision identities; one audio-focus owner; manual Pause authority; explicit bridge consent and atomic join; full eight-lane Studio; existing library/route/search operations; blind-study neutrality; decodable exact-revision FLAC; local-only server and truthful LRCLIB metadata disclosure. **No desktop packager, native/browser folder-picker bridge, accounts, SaaS, cloud media upload, subscriptions, remote telemetry or sound effects.**

Review idle, hovered, focused, pressed, selected, queued, rendering, ready, blocked, failed, retry, cancellation, stale response, missing metadata, long/RTL names, low-resource mode and offline recovery. Run dark/light/system, forced colors, 320–2560px, 200/400% zoom, coarse touch, keyboard, NVDA/Edge, reduced-motion and audio-continuity checks as applicable. Automated screenshots/test passes are not human validation.

## Status, dependencies and records

PR #31 records code implementation with referenced source and automation. **Implemented is not independently Verified**; a named reviewer must still record all required real-world theme, accessibility, audio, performance and user results before Yes or owner Acceptance. [Immersive programme roadmap](selecta-microinteraction-roadmap.md) · [240-task checklist](selecta-microinteraction-implementation-checklist.md) · [evidence ledger](selecta-microinteraction-evidence.md) · [state and motion matrix](selecta-microinteraction-motion-matrix.md) · [release gates](selecta-microinteraction-release-gates.md).
