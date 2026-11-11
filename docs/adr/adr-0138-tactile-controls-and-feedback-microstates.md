# ADR-0138 - Tactile microinteractions for buttons, menus, fields, chips and feedback

- **Decision:** Accepted by the repository owner on 2026-11-07; implementation and independent verification remain separately evidenced.
- **Implementation:** 8/8 Implemented, 0/8 In progress, 0 Not started (source-level, PR #31).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta immersive experience and microinteractions; 2026-11-07; main `525a49cee6b0a02cae7e71dbe3f336a0141ec2d7` (after merged PR #30).
- **Priority / phase:** P0 / Shared interactions.
- **Related earlier ADRs:** ADR-0094, ADR-0131; earlier decisions and historical implementation claims remain intact.
- **Source touchpoints:** web/src/ui/controls.tsx; web/src/ui/primitives.tsx; web/src/ui/toasts.tsx.

## Context and evidence boundary

Selecta already defines reusable controls and semantic statuses. New polish must preserve their exact behavioral contracts while making every press acknowledged and every result unmistakable. This is a **new experience delta** to existing code and ADR-0114–0134, not a claim that existing implementations are missing. PR #31 includes source-level implementation and tests, but this proposal remains owner-unaccepted and independently unverified. Human visual, audio, screen-reader, touch and comprehension results are not asserted.

## Proposed decision

- Specify idle, hover, pointer-down, focus, selected, busy, disabled, success, warning, failed, retry and undo as separate states with stable dimensions.
- Give immediate local confirmation of a press even if server work takes seconds; never show success until the authoritative result arrives.
- Preserve keyboard-visible focus as a distinct layer from selection and playback; never convey an action solely through hover.
- Checkboxes, toggles, segmented options and energy controls reflect committed versus pending state and keep accessible names/value text.
- Errors must say what failed, what stayed safe and which scoped action retries; retry must not replay a different operation.
- Prevent double-submit without hiding the focused control; respect cancellation and the latest user's intent.

## Interaction choreography and visual behavior

- Pointer-down uses modest 100–120 ms surface color/outline response; no scale jump that makes hit boxes move.
- Busy starts immediately in place with stable text footprint; determinate indicators move only from actual progress; no eternal spinners for blocked states.
- Success is a brief 160 ms local confirmation, then returns to persistent final status without celebratory loops.
- Failure is a stable high-contrast icon/text change, not a shake animation, alarm flash or auto-dismissing diagnosis.

## Alternatives, trade-offs and limits

Prefer semantic, truthful feedback over cosmetic animation; static UI is better than invented musical evidence, gratuitous movement or a delayed critical control. Where visual polish conflicts with accurate playback, scope/revision identity, accessibility or control, behavior and safety win. Do not add runtime dependencies, processing APIs, telemetry or new audio assets under this documentation decision.

## Implementation tasks - 2 source-level Implemented, 0 independently Verified

1. **MI-0138-01 - Write complete shared state matrix.** Acceptance: Each component specifies copy, style, ARIA state, trigger and cancellation. Required verification: Control gallery and semantic audit. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: shared rest/focus/pressed/working/success/failure/disabled/stale matrix in `selecta-microinteraction-interaction-contracts.md` mapped to shared controls; independent review remains open.**
2. **MI-0138-02 - Implementable stable button geometry spec.** Acceptance: Normal/busy/success/failed labels do not cause layout shift. Required verification: Screenshot diff and button width comparison. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `web/src/ui/controls.tsx`, `web/src/ui/toasts.tsx`; `web/src/ui/controls.test.tsx`; independent checks pending.**
3. **MI-0138-03 - Define toggle and chip interactions.** Acceptance: Pressed and selected states persist and expose proper controls. Required verification: Keyboard, touch and screen reader checks. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: native/ARIA toggle and chip contract plus implementations in shared controls and Library filters.**
4. **MI-0138-04 - Specify field validation timing.** Acceptance: Errors associate with fields and appear without premature interruption. Required verification: Invalid-path, BPM, key and search forms. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: input-retaining, first-invalid-focus validation contract and implementations in `SongDetails.tsx`/`MixSetup.tsx`.**
5. **MI-0138-05 - Define retry identity contracts.** Acceptance: Lost response retries exact operation, no double creation. Required verification: Mocked disconnect/timeout replay tests. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: stable operation-ID and revision-guard contract mapped to frontend/backend idempotence fixtures.**
6. **MI-0138-06 - Document toast and status escalation.** Acceptance: No more than relevant messages; persistent actions remain in Activity. Required verification: Toast burst and delayed Undo simulation. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `web/src/ui/controls.tsx`, `web/src/ui/toasts.tsx`; `web/src/ui/controls.test.tsx`; independent checks pending.**
7. **MI-0138-07 - Audit hover-only affordances.** Acceptance: All essential actions visible to touch and keyboard users. Required verification: Touch/no-hover and keyboard-only walkthrough. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: focus/touch equivalents inventory plus visible controls in shared primitives and `EditorRows.tsx`; physical review remains open.**
8. **MI-0138-08 - Validate user-perceived responsiveness.** Acceptance: Action acknowledgment perceived promptly even when server is delayed. Required verification: Timed interaction tests and 1–5 task confidence. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: feat/finish-checklists @ `49dd09a`; evidence: `web/e2e/mi-responsiveness.e2e.ts` 19/19 passed on 2026-11-11 (slot lock, fresh build): with every answer held back 2 s, each press is acknowledged in 11 to 35 ms against a 100 ms budget, then settles truthfully when answered and when refused with a 500 (Play, Replace and play, Replace and edit, move, remove, add, save as draft, Save a copy, song request, export). Fixes: `web/src/views/Mixes.tsx`, `web/src/views/Adder.tsx`, `web/src/views/EditorRows.tsx`, `web/src/views/Mix.tsx`, `web/src/ui/controls.tsx`. Needs a person: 1 to 5 task confidence ratings from real people doing these actions while the server is slow.**

## Shared invariants and negative cases

Preserve original audio files; current/draft and revision identities; one audio-focus owner; manual Pause authority; explicit bridge consent and atomic join; full eight-lane Studio; existing library/route/search operations; blind-study neutrality; decodable exact-revision FLAC; local-only server and truthful LRCLIB metadata disclosure. **No desktop packager, native/browser folder-picker bridge, accounts, SaaS, cloud media upload, subscriptions, remote telemetry or sound effects.**

Review idle, hovered, focused, pressed, selected, queued, rendering, ready, blocked, failed, retry, cancellation, stale response, missing metadata, long/RTL names, low-resource mode and offline recovery. Run dark/light/system, forced colors, 320–2560px, 200/400% zoom, coarse touch, keyboard, NVDA/Edge, reduced-motion and audio-continuity checks as applicable. Automated screenshots/test passes are not human validation.

## Status, dependencies and records

PR #31 records code implementation with referenced source and automation. **Implemented is not independently Verified**; a named reviewer must still record all required real-world theme, accessibility, audio, performance and user results before Yes or owner Acceptance. [Immersive programme roadmap](selecta-microinteraction-roadmap.md) · [240-task checklist](selecta-microinteraction-implementation-checklist.md) · [evidence ledger](selecta-microinteraction-evidence.md) · [state and motion matrix](selecta-microinteraction-motion-matrix.md) · [release gates](selecta-microinteraction-release-gates.md).
