# ADR-0169 — Energy Horizon, tactile shaping and destination scope

- **Decision:** Proposed (owner acceptance not recorded).
- **Implementation:** Not started (0/7 Implemented, 0/7 In progress, 7/7 Not started).
- **Independent verification:** No (0/7).
- **Programme/date/baseline:** Selecta creative-interface synthesis; 2026-11-08; main 4c2f9f03b8b7e185a7a5021979f4b443e40299dd.
- **Priority / phase:** P0 / Create.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0143, ADR-0111, ADR-0150; no prior decision or status is changed by this proposal.
- **Existing source touchpoints:** web/src/views/MixSetup.tsx; web/src/views/Mix.tsx; web/src/styles/creation.css.

## Context and evidence boundary

The five-stop energy arc already has drawing, presets, sliders and numbers. This ADR proposes making that expressive intention the same recognizable visual element from selection through draft/editor, while explicitly preserving the current global-defaults semantics and honest scaling.

This is a **new, unimplemented design and acceptance delta**. Similar existing source, earlier implementation checkmarks and this docs PR cannot demonstrate that a CI task is implemented or independently verified.

## Proposed decision

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

## Implementation checklist — 0/7 Implemented, 0/7 Verified

1. **CI-0169-01 — Design reusable five-stop horizon.** **Acceptance:** Same semantic start/finish form works in builder/draft/editor. **Required verification:** Responsive and state specimens. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
2. **CI-0169-02 — Specify finger/stylus drawing precision.** **Acceptance:** Pointer capture, scroll behaviour and cancellation are deterministic. **Required verification:** Touch and stylus trace tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
3. **CI-0169-03 — Preserve numeric and keyboard equivalence.** **Acceptance:** Every point editable at 400% zoom without SVG interaction. **Required verification:** NVDA and keyboard tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
4. **CI-0169-04 — Separate intended and measured arc scales.** **Acceptance:** No misleading comparison or invented song energy. **Required verification:** Data and copy validation. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
5. **CI-0169-05 — Create overlap-style mini diagrams.** **Acceptance:** Smooth/punchy/adaptive visually meaningful but no audio claim. **Required verification:** Expert comprehension and static fallback. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
6. **CI-0169-06 — Clarify destination and settings scope.** **Acceptance:** User understands future defaults, fallback and cancellation. **Required verification:** Reload/error/global-setting scenario tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
7. **CI-0169-07 — Measure perceived creative control.** **Acceptance:** User can describe and achieve different journeys. **Required verification:** Uncoached task and actual musical-result review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.

## Invariants and required negative cases

Preserve single audio owner, manual Pause, original audio files, disclosed LRCLIB metadata lookup, current/draft revision guards and Undo, exact seam identity, bridge consent and atomic join, full eight-lane Studio with recovery, existing routes and Library workflows, blind A/B neutrality, frozen-revision decodable FLAC and local operation. Test missing/RTL titles, stale responses, failure, cancel, offline, 320–2560px, zoom, high-contrast, reduced motion, touch, keyboard and real audio as relevant.

## Dependencies, evidence and status

- **Depends on:** ADR-0143, ADR-0111, ADR-0150; reconcile old task implementation rather than claiming it incomplete.
- **Next sequence:** owner decision → object/state prototype → explicit test fixtures → scoped implementation PR → separate human/AT/audio/performance review → recorded GO/NO-GO.
- **Now:** Decision Proposed; Implementation Not started; Independently Verified No; no implementing PR/SHA.
- [Roadmap](selecta-creative-interface-roadmap.md) · [140-task checklist](selecta-creative-interface-implementation-checklist.md) · [Evidence](selecta-creative-interface-implementation-evidence.md) · [Parity](selecta-creative-interface-feature-parity.md) · [Interaction matrix](selecta-creative-interface-interaction-matrix.md) · [Verification](selecta-creative-interface-verification-matrix.md) · [Gates](selecta-creative-interface-release-gates.md).
