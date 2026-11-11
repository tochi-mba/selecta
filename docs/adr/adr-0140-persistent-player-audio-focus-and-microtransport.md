# ADR-0140 - Persistent mini-player, audio-focus handoff and frictionless microtransport

- **Decision:** Accepted by the repository owner on 2026-11-07; implementation and independent verification remain separately evidenced.
- **Implementation:** 8/8 Implemented, 0/8 In progress, 0 Not started (source-level, PR #31).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta immersive experience and microinteractions; 2026-11-07; main `525a49cee6b0a02cae7e71dbe3f336a0141ec2d7` (after merged PR #30).
- **Priority / phase:** P0 / Playback shell.
- **Related earlier ADRs:** ADR-0093, ADR-0116, ADR-0131; earlier decisions and historical implementation claims remain intact.
- **Source touchpoints:** web/src/shell/Shell.tsx; web/src/player.ts; web/src/audio/focus.ts; web/src/state/tabs.ts.

## Context and evidence boundary

The mini-player lives outside routed pages, while previews can temporarily own the sound. Polishing this system must not introduce surprise playback, two audio owners or inaccurate transport status. This is a **new experience delta** to existing code and ADR-0114–0134, not a claim that existing implementations are missing. PR #31 includes source-level implementation and tests, but this proposal remains owner-unaccepted and independently unverified. Human visual, audio, screen-reader, touch and comprehension results are not asserted.

## Proposed decision

- Mini-player remains visually quiet, anchored above mobile navigation, with current title, artist, transport and truthful position.
- Make Play/Pause touch targets easy to distinguish and keep controls in place as player phase changes.
- A preview takeover explicitly indicates its sound owner without exposing duplicate Play operations; manual Pause always wins over auto-resume.
- No audio cues, button click sounds or background music overlays are introduced by UI polish; the music itself remains the sound design.
- Switching tabs, disconnecting the server or opening Stage must not misrepresent whether audio continues.
- Progress display follows actual player time only, never easing ahead of an unknown seek/render boundary.

## Interaction choreography and visual behavior

- Mini-player entrance when playback first exists: short 160–220 ms fade while page bottom padding is established before paint.
- Song title updates crossfade at most 180 ms with full accessible identity announced once, not on every clock tick.
- Pause/Play icon switches within 100 ms, with no spin or delay; scrub progress remains clock-derived.
- Preview handoff changes ownership label immediately; on completion resume only when intent generation still permits.

## Alternatives, trade-offs and limits

Prefer semantic, truthful feedback over cosmetic animation; static UI is better than invented musical evidence, gratuitous movement or a delayed critical control. Where visual polish conflicts with accurate playback, scope/revision identity, accessibility or control, behavior and safety win. Do not add runtime dependencies, processing APIs, telemetry or new audio assets under this documentation decision.

## Implementation tasks - 2 source-level Implemented, 0 independently Verified

1. **MI-0140-01 - Define mini-player geometry.** Acceptance: No layout occlusion at 320px, safe-area, landscape and 400% zoom. Required verification: Viewport and touch screenshots. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: persistent safe-area/keyboard-aware mini-player geometry in `Shell.tsx`/`shell.css`.**
2. **MI-0140-02 - Specify transport state machine visuals.** Acceptance: Idle/loading/playing/paused/seam/blocked are distinct without false completion. Required verification: Player fixture and media-session tests. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `web/src/shell/Shell.tsx`, `web/src/player.ts`; `web/src/player.test.ts`, `web/src/audio/focus.test.tsx`; independent checks pending.**
3. **MI-0140-03 - Choreograph preview ownership.** Acceptance: One source audible and explicit Pause never reversed by preview end. Required verification: Real audio race and double-tab tests. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: single preview arbitration and stale-resume protection in `audio/focus.ts` with unit fixtures.**
4. **MI-0140-04 - Validate title and time changes.** Acceptance: Metadata updates once, progress matches actual player clock. Required verification: Clock fixture and accessible announcements. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: player-clock-derived time and state-derived title/transport updates in `Shell.tsx`/`App.tsx`.**
5. **MI-0140-05 - Design volume/mute feedback.** Acceptance: Slider and icon communicate mute, 0 volume and restore distinctly. Required verification: Keyboard/AT and device media-key review. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `web/src/shell/Shell.tsx`, `web/src/player.ts`; `web/src/player.test.ts`, `web/src/audio/focus.test.tsx`; independent checks pending.**
6. **MI-0140-06 - Audit keyboard and media-session parity.** Acceptance: Global shortcuts, mini controls, headphones and media keys target same engine. Required verification: Browser device matrix. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: global shortcuts, mini-player controls and Media Session handlers share `SetPlayer` in `web/src/App.tsx` and `web/src/shell/Shell.tsx`; physical device matrix remains open.**
7. **MI-0140-07 - Specify disconnected experience.** Acceptance: Already buffered audio continues when possible; stale state is marked. Required verification: Server loss/recovery and stale-status test. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: buffer-preserving stale/offline banner and recovery flow in `web/src/App.tsx`/`web/src/player.ts`; server-loss device review remains open.**
8. **MI-0140-08 - Measure player stability.** Acceptance: Route/modal interactions do not cause audio dropout or extra AudioContext. Required verification: Long-session trace and captured audio. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: feat/finish-checklists @ `49dd09a`; evidence: `web/e2e/mi-player-stability.e2e.ts` (MI-0140-08 every route, dialog, sheet and the command palette leave one AudioContext running and the sound unbroken) passed on 2026-11-11: across a 29-step walk of routes, dialogs, sheets, the command palette and Back/Forward, exactly one AudioContext is made, it never changes state once running, its clock keeps pace with the wall clock, something is always scheduled to sound, no song restarts and shown time never goes backwards. Needs a person: a captured recording of the real audio output over a long session, listened to for dropouts.**

## Shared invariants and negative cases

Preserve original audio files; current/draft and revision identities; one audio-focus owner; manual Pause authority; explicit bridge consent and atomic join; full eight-lane Studio; existing library/route/search operations; blind-study neutrality; decodable exact-revision FLAC; local-only server and truthful LRCLIB metadata disclosure. **No desktop packager, native/browser folder-picker bridge, accounts, SaaS, cloud media upload, subscriptions, remote telemetry or sound effects.**

Review idle, hovered, focused, pressed, selected, queued, rendering, ready, blocked, failed, retry, cancellation, stale response, missing metadata, long/RTL names, low-resource mode and offline recovery. Run dark/light/system, forced colors, 320–2560px, 200/400% zoom, coarse touch, keyboard, NVDA/Edge, reduced-motion and audio-continuity checks as applicable. Automated screenshots/test passes are not human validation.

## Status, dependencies and records

PR #31 records code implementation with referenced source and automation. **Implemented is not independently Verified**; a named reviewer must still record all required real-world theme, accessibility, audio, performance and user results before Yes or owner Acceptance. [Immersive programme roadmap](selecta-microinteraction-roadmap.md) · [240-task checklist](selecta-microinteraction-implementation-checklist.md) · [evidence ledger](selecta-microinteraction-evidence.md) · [state and motion matrix](selecta-microinteraction-motion-matrix.md) · [release gates](selecta-microinteraction-release-gates.md).
