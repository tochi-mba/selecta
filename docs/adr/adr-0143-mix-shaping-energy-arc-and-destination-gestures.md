# ADR-0143 - Mix-shaping controls, expressive energy arc and destination selection

- **Decision:** Accepted by the repository owner on 2026-11-07; implementation and independent verification remain separately evidenced.
- **Implementation:** 7/8 Implemented, 0/8 In progress, 1 Not started (source-level, PR #31).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta immersive experience and microinteractions; 2026-11-07; main `525a49cee6b0a02cae7e71dbe3f336a0141ec2d7` (after merged PR #30).
- **Priority / phase:** P1 / Make a Mix.
- **Related earlier ADRs:** ADR-0117, ADR-0097, ADR-0131; earlier decisions and historical implementation claims remain intact.
- **Source touchpoints:** web/src/views/MixSetup.tsx; web/src/views/Mixes.tsx.

## Context and evidence boundary

Transition feel, stem frequency, five energy stops and a destination song let the user express musical intention. The UI must distinguish preferences for future mixes from a command that edits an already-built set. This is a **new experience delta** to existing code and ADR-0114–0134, not a claim that existing implementations are missing. PR #31 includes source-level implementation and tests, but this proposal remains owner-unaccepted and independently unverified. Human visual, audio, screen-reader, touch and comprehension results are not asserted.

## Proposed decision

- State whether shaping applies to just the next build or persists as future default; avoid the ambiguous impression that an existing mix changed.
- Let users choose energy-arc presets or manipulate five stops, with sliders providing equal keyboard/touch access.
- Show a preview of the requested curve as a preference, never as an achieved measured result.
- Use intentional gestures: a dragged point follows the finger smoothly but snapshots to a meaningful stable value on release.
- Destination search discloses whether the destination is guaranteed, attempted or impossible with current library/cues.
- Maintain Apply/Cancel semantics that preserve prior settings; a failure keeps the user's unsaved choices visible.

## Interaction choreography and visual behavior

- Energy handles follow pointer using transform without easing lag during drag; snap feedback ≤140 ms on release.
- Preset selection morphs curve within 180–240 ms only if the path is truthful; reduced motion redraws instantly.
- Selected tempo/feel chips switch emphasis in ≤120 ms and keep keyboard focus stable.
- Destination selection confirms chosen song once; no celebratory motion that suggests a route is already possible.

## Alternatives, trade-offs and limits

Prefer semantic, truthful feedback over cosmetic animation; static UI is better than invented musical evidence, gratuitous movement or a delayed critical control. Where visual polish conflicts with accurate playback, scope/revision identity, accessibility or control, behavior and safety win. Do not add runtime dependencies, processing APIs, telemetry or new audio assets under this documentation decision.

## Implementation tasks - 5 source-level Implemented, 0 independently Verified

1. **MI-0143-01 - Clarify shaping scope text.** Acceptance: Explicit next-build vs persistent-default meaning in all entry points. Required verification: Comprehension trial and settings state test. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `web/src/views/MixSetup.tsx`, `web/src/styles/listening.css`; `web/src/views/MixSetup.test.tsx`, `web/src/views/Mixes.test.tsx`; independent checks pending.**
2. **MI-0143-02 - Specify arc drawing semantics.** Acceptance: Five editable stops, numeric/slider parity, no hidden mouse-only requirement. Required verification: Keyboard, coarse-pointer and AT tests. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `web/src/views/MixSetup.tsx`, `web/src/styles/listening.css`; `web/src/views/MixSetup.test.tsx`, `web/src/views/Mixes.test.tsx`; independent checks pending.**
3. **MI-0143-03 - Define energy preset morphs.** Acceptance: Curve reflects values exactly and never masquerades as achieved outcome. Required verification: Reference values, reduced motion screenshots. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `web/src/views/MixSetup.tsx`, `web/src/styles/listening.css`; `web/src/views/MixSetup.test.tsx`, `web/src/views/Mixes.test.tsx`; independent checks pending.**
4. **MI-0143-04 - Validate destination search.** Acceptance: Duplicate titles, missing metadata, keyboard selection and clear behavior work. Required verification: Search race/combobox test. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `web/src/views/MixSetup.tsx`, `web/src/styles/listening.css`; `web/src/views/MixSetup.test.tsx`, `web/src/views/Mixes.test.tsx`; independent checks pending.**
5. **MI-0143-05 - Design committed vs unsaved state.** Acceptance: Cancel preserves old values, error retains edits, Apply is authoritative. Required verification: API failure/reload test. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: working-versus-committed shaping and local input/preview behavior mapped in the surface contract to `MixSetup.tsx` and fixtures.**
6. **MI-0143-06 - Specify input and animation performance.** Acceptance: Dragging has no perceptible jitter or input lag on supported hardware. Required verification: Pointer trace, long-task benchmark. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: working-versus-committed shaping and local input/preview behavior mapped in the surface contract to `MixSetup.tsx` and fixtures.**
7. **MI-0143-07 - Preserve request and mix semantics.** Acceptance: Shaping cannot silently mutate active playback or draft. Required verification: Guarded current/draft test. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `web/src/views/MixSetup.tsx`, `web/src/styles/listening.css`; `web/src/views/MixSetup.test.tsx`, `web/src/views/Mixes.test.tsx`; independent checks pending.**
8. **MI-0143-08 - Evaluate musical agency.** Acceptance: Listeners can explain and achieve rough desired journey without technical coaching. Required verification: Observed task and actual resulting mix listening. **Implementation: In progress; Verified: No; owner: Unassigned; PR/SHA: feat/finish-checklists-2 (uncommitted, 2026-11-12); evidence: code part built on 2026-11-12: a sheet recording whether listeners explained and achieved the journey, any coaching (never counted as a pass) and their words, in `src/selecta/audit/mi_study_kit.py` (`python -m selecta.audit.mi_study_kit sheet|check|summary MI-0143-08`) and the study kit section of `docs/adr/selecta-microinteraction-verification-protocols.md`; `tests/test_mi_study_kit.py` 33/33 passed on 2026-11-12. Left In progress and unticked: the acceptance is the people's result, which code cannot produce, and ticking would drop the task from the owner runbook. Needs a person: observe listeners shaping a rough journey without coaching and listen to the resulting mix with them, recorded in a kit record that passes `check`.**

## Shared invariants and negative cases

Preserve original audio files; current/draft and revision identities; one audio-focus owner; manual Pause authority; explicit bridge consent and atomic join; full eight-lane Studio; existing library/route/search operations; blind-study neutrality; decodable exact-revision FLAC; local-only server and truthful LRCLIB metadata disclosure. **No desktop packager, native/browser folder-picker bridge, accounts, SaaS, cloud media upload, subscriptions, remote telemetry or sound effects.**

Review idle, hovered, focused, pressed, selected, queued, rendering, ready, blocked, failed, retry, cancellation, stale response, missing metadata, long/RTL names, low-resource mode and offline recovery. Run dark/light/system, forced colors, 320–2560px, 200/400% zoom, coarse touch, keyboard, NVDA/Edge, reduced-motion and audio-continuity checks as applicable. Automated screenshots/test passes are not human validation.

## Status, dependencies and records

PR #31 records code implementation with referenced source and automation. **Implemented is not independently Verified**; a named reviewer must still record all required real-world theme, accessibility, audio, performance and user results before Yes or owner Acceptance. [Immersive programme roadmap](selecta-microinteraction-roadmap.md) · [240-task checklist](selecta-microinteraction-implementation-checklist.md) · [evidence ledger](selecta-microinteraction-evidence.md) · [state and motion matrix](selecta-microinteraction-motion-matrix.md) · [release gates](selecta-microinteraction-release-gates.md).
