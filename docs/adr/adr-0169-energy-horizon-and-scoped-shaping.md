# ADR-0169 - Energy Horizon, tactile shaping and destination scope

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** 6/7 Implemented, 0/7 In progress, 1/7 Need a person, 0/7 Not started (2026-11-10).
- **Independent verification:** No (0/7).
- **Programme/date/baseline:** Selecta creative-interface synthesis; 2026-11-08; main 4c2f9f03b8b7e185a7a5021979f4b443e40299dd.
- **Priority / phase:** P0 / Create.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0143, ADR-0111, ADR-0150; no prior decision or status is changed by this proposal.
- **Existing source touchpoints:** web/src/views/MixSetup.tsx; web/src/views/Mix.tsx; web/src/styles/creation.css.

## Context and evidence boundary

The five-stop energy arc already has drawing, presets, sliders and numbers. This ADR proposes making that expressive intention the same recognizable visual element from selection through draft/editor, while explicitly preserving the current global-defaults semantics and honest scaling.

This is a **new, unimplemented design and acceptance delta**. Similar existing source, earlier implementation checkmarks and this docs PR cannot demonstrate that a CI task is implemented or independently verified.

## Accepted decision

- Name a reusable Energy Horizon with Start, Early, Middle, Late and Finish.
- Provide direct pointer/stylus drawing, numeric input and slider/keyboard parity without false energy precision.
- Morph preset visuals from actual chosen values, not an unrelated sampled animation.
- Keep requested energy shape and separately normalized achieved track energy explicitly differentiated.
- Show smooth/punchy/adaptive overlap examples and a selected destination marker while preserving current future-default scope.
- Treat per-mix shaping override as a separate future contract, not something the UI should falsely imply exists.

## Visual, animation and microinteraction contract

- During drag the path follows the input without easing delay; settle only on release.
- Preset transitions can interpolate 200–350 ms with instant reduced-motion equivalent.
- Never animate an achieved mix curve until the actual ordered song data exists.

## Alternatives and trade-offs

Preserve the current restrained layout when a richer animation does not measurably improve comprehension, creative control or delight. A preview or graphic is illustrative until connected to actual source data. No fake waveform, beat, word timing, quality score, cover art, render status, autoplay sound or processing percentage. Every animated or direct-manipulation state requires an accessible static/keyboard equivalent.

## Implementation checklist - 6/7 Implemented, 0/7 Verified

1. **CI-0169-01 - Design reusable five-stop horizon.** **Acceptance:** Same semantic start/finish form works in builder/draft/editor. **Required verification:** Responsive and state specimens. **Implementation:** Implemented (built 2026-11-11); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** feat/finish-checklists (uncommitted); **Evidence:** HORIZON_STOPS, measuredHorizon and MixHorizon in web/src/ui/MusicObjects.tsx, shared by the builder (web/src/views/MixSetup.tsx) and the editor Story view for the current mix and drafts (web/src/views/EditorStory.tsx, scope from web/src/views/Mix.tsx) behind flag editor.energy_horizon; web/src/views/ciEnergyHorizon.test.tsx all 5 tests; web/src/views/MixSetup.test.tsx, web/src/ui/MusicObjects.test.tsx, web/src/views/Mix.test.tsx (vitest, passed 2026-11-11); responsive specimens still need a person.
2. **CI-0169-02 - Specify finger/stylus drawing precision.** **Acceptance:** Pointer capture, scroll behaviour and cancellation are deterministic. **Required verification:** Touch and stylus trace tests. **Implementation:** Implemented (existing code credited); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** feat/finish-checklists (uncommitted); **Evidence:** web/src/views/MixSetup.test.tsx "cancels an interrupted pointer stroke without leaving a half-drawn energy choice"; touch-action none on .energy-horizon.intention in web/src/styles/music-objects.css (vitest, passed 2026-11-10); stylus trace still needs a person.
3. **CI-0169-03 - Preserve numeric and keyboard equivalence.** **Acceptance:** Every point editable at 400% zoom without SVG interaction. **Required verification:** NVDA and keyboard tests. **Implementation:** Implemented (existing code credited); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** feat/finish-checklists (uncommitted); **Evidence:** web/src/views/MixSetup.test.tsx "keeps numeric input, slider and drawn stops on the same exact preference values" (vitest, passed 2026-11-10); web/e2e/pages.e2e.ts zoom overflow (Playwright, passed 2026-11-10); NVDA still needs a person.
4. **CI-0169-04 - Separate intended and measured arc scales.** **Acceptance:** No misleading comparison or invented song energy. **Required verification:** Data and copy validation. **Implementation:** Implemented (existing code credited); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** feat/finish-checklists (uncommitted); **Evidence:** web/src/ui/MusicObjects.test.tsx "keeps requested and measured energy explicitly separate, with no invented measurement" (vitest, passed 2026-11-10).
5. **CI-0169-05 - Create overlap-style mini diagrams.** **Acceptance:** Smooth/punchy/adaptive visually meaningful but no audio claim. **Required verification:** Expert comprehension and static fallback. **Implementation:** Implemented (built 2026-11-10); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** feat/finish-checklists (uncommitted); **Evidence:** FeelDiagram in web/src/ui/MusicObjects.tsx under the Transition feel choice in web/src/views/MixSetup.tsx; web/src/views/CreativeInterface.test.tsx "draws smooth, punchy and each-mix-chooses differently, as decoration only" (vitest, passed 2026-11-10).
6. **CI-0169-06 - Clarify destination and settings scope.** **Acceptance:** User understands future defaults, fallback and cancellation. **Required verification:** Reload/error/global-setting scenario tests. **Implementation:** Implemented (existing code credited); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** feat/finish-checklists (uncommitted); **Evidence:** web/src/views/Mixes.test.tsx "lets the listener set a song as the destination for future mixes", "how mixes get built stays out of the way until it’s wanted, and says it’s for new mixes", "does not claim an energy shape was saved when clearing the shape fails", "serializes rapidly changed feel settings so the last selection wins on the server" (vitest, passed 2026-11-10).
7. **CI-0169-07 - Measure perceived creative control.** **Acceptance:** User can describe and achieve different journeys. **Required verification:** Uncoached task and actual musical-result review. **Implementation:** Needs a person: uncoached task and review of the actual musical result; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.

## Invariants and required negative cases

Preserve single audio owner, manual Pause, original audio files, disclosed LRCLIB metadata lookup, current/draft revision guards and Undo, exact seam identity, bridge consent and atomic join, full eight-lane Studio with recovery, existing routes and Library workflows, blind A/B neutrality, frozen-revision decodable FLAC and local operation. Test missing/RTL titles, stale responses, failure, cancel, offline, 320–2560px, zoom, high-contrast, reduced motion, touch, keyboard and real audio as relevant.

## Dependencies, evidence and status

- **Depends on:** ADR-0143, ADR-0111, ADR-0150; reconcile old task implementation rather than claiming it incomplete.
- **Next sequence:** owner decision → object/state prototype → explicit test fixtures → scoped implementation PR → separate human/AT/audio/performance review → recorded GO/NO-GO.
- **Now:** Decision Accepted; Implementation 6/7 Implemented (0 in progress, 1 need a person) on feat/finish-checklists, 2026-11-10; Independently Verified No.
- [Roadmap](selecta-creative-interface-roadmap.md) · [140-task checklist](selecta-creative-interface-implementation-checklist.md) · [Evidence](selecta-creative-interface-implementation-evidence.md) · [Parity](selecta-creative-interface-feature-parity.md) · [Interaction matrix](selecta-creative-interface-interaction-matrix.md) · [Verification](selecta-creative-interface-verification-matrix.md) · [Gates](selecta-creative-interface-release-gates.md).
