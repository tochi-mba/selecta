# ADR-277 - Icon sizes, badge baselines and button microgeometry

- **Decision:** Proposed (owner review pending).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme:** Selecta measured micro-polish (MP). **Priority:** P1. **Baseline:** `100df40463d05b3d6a4cba8f5d06cbe193a1b0c4`. **Owner:** Unassigned.
- **Existing ADR owners:** ADR-0204, ADR-0245; old statuses unchanged.
- **Source touchpoints:** `web/src/ui/Icon.tsx`; `web/src/ui/primitives.tsx`.

## Context and evidence boundary

Selecta already has extensive implemented UI, functional tests and earlier accepted design work. This ADR adds **measurable visual acceptance**, not a claim that these features are absent or defective. Existing source and historical criteria must be reconciled before implementation; a code observation alone is not proof of a visible usability problem.

## Proposed decision and alternatives

Audit the same route, state, theme, viewport, zoom and synthetic music data before and after any pixel-level change. Adopt the smallest change justified by measured layout and human review. Preserve existing design where it already passes and record specialist exceptions. Avoid unrelated feature additions or wholesale redesign.

## Implementation checklist - 0/8 Implemented; 0/8 independently Verified

1. **MP-0277-01 - Inventory icon usage.** **Acceptance:** Each icon has a purpose, size, owner and appropriate text or accessible name. **Required verification:** source-linked same-state geometry or screenshots, appropriate keyboard/functional regression and independent visual/AT/real-audio review where applicable. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
2. **MP-0277-02 - Define icon-size slots.** **Acceptance:** Compact, toolbar, standard and hero icons follow deliberate dimensions. **Required verification:** source-linked same-state geometry or screenshots, appropriate keyboard/functional regression and independent visual/AT/real-audio review where applicable. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
3. **MP-0277-03 - Normalise label gaps.** **Acceptance:** Icon-to-text distances remain stable in default, busy and wrapped states. **Required verification:** source-linked same-state geometry or screenshots, appropriate keyboard/functional regression and independent visual/AT/real-audio review where applicable. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
4. **MP-0277-04 - Review stroke consistency.** **Acceptance:** Glyphs appear optically consistent despite different shapes. **Required verification:** source-linked same-state geometry or screenshots, appropriate keyboard/functional regression and independent visual/AT/real-audio review where applicable. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
5. **MP-0277-05 - Align counter badges.** **Acceptance:** Activity and Requests indicators remain centred as digits change. **Required verification:** source-linked same-state geometry or screenshots, appropriate keyboard/functional regression and independent visual/AT/real-audio review where applicable. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
6. **MP-0277-06 - Distinct icon states.** **Acceptance:** Hover, active, focused and disabled meaning never depends on hue alone. **Required verification:** source-linked same-state geometry or screenshots, appropriate keyboard/functional regression and independent visual/AT/real-audio review where applicable. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
7. **MP-0277-07 - Audit icon-only controls.** **Acceptance:** Labels, focus, help and pointer target sizes remain usable. **Required verification:** source-linked same-state geometry or screenshots, appropriate keyboard/functional regression and independent visual/AT/real-audio review where applicable. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
8. **MP-0277-08 - Test RTL and narrow widths.** **Acceptance:** Directional icons and badges remain correctly oriented and unclipped. **Required verification:** source-linked same-state geometry or screenshots, appropriate keyboard/functional regression and independent visual/AT/real-audio review where applicable. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.

## Measured decision (2026-11-10)

- **Slots.** `Icon` now takes `size` (`compact` 14, `toolbar` 16, `standard` 20, `hero` 28) instead of `width`/`height`. Before, its default `width="20"` overwrote any size a caller passed, so every icon drew at 20px whatever the source asked for. The boxes and per-slot strokes live in `web/src/ui/Icon.tsx` and `web/src/styles/tokens.css`, applied by `web/src/styles/icons.css`.
- **Stroke.** Each slot has its own stroke so every glyph draws a line about 1.4px wide on screen (2.4 x 14/24, 2.1 x 16/24, 1.7 x 20/24, 1.2 x 28/24). Every glyph's ink stays on the 24 grid with a 12 to 21 unit extent and a centre within 1.5 units of the middle.
- **Gaps.** `--icon-gap` and `--icon-gap-dense` (ADR-273) now also hold inside a busy `Action`, a Lucy header button (was 6px), a lone mark in small text (`.icon-words`), request results and quality checks.
- **Badges.** Request and Activity counts reserve two tabular digits from their start edge (`min-width: 2ch`), so 1 to 99 moves neither the icon, the first digit nor the control's width, and the digits sit on the icon's vertical centre. Centring the digits inside the reserved box was tried and dropped: it pushed a single digit 12px from its icon, against ADR-273's 8px icon gap.
- **States.** Existing hover, focus, pressed, current and disabled styles were measured and credited: each changes an edge, a fill or ink lightness, a ring or opacity, in Light and Dark.
- **Icon-only controls.** Every one now has a `title` (or `data-tip` in the collapsed rail, or the Listen tooltip), and the mute and side-bar buttons and the attention link reach 44px; touch toasts close on a 44px target.
- **Direction.** No glyph mirrors right to left: transport keeps tape direction as media players do, and up and down are vertical.
- Inventory: `docs/engineering/icon-inventory.md`. Proof: `web/e2e/mp-0277-icon-geometry.e2e.ts` (measuring functions in `web/e2e/icon-measure.ts`) and `web/src/styles/icon-geometry.test.ts`.

## Negative tests and proof

**Common cases:** Light/Dark/System, forced colours, 320–3840px incl. short landscape, 200/400% zoom, keyboard/touch/NVDA, reduced motion, long/RTL/CJK/duplicate metadata, initial/loading/empty/partial/working/failed/offline/recovery and actual sound where relevant.

**Preservation:** Original local music unchanged; one player/audio-focus owner and deliberate Pause; real timing and song/seam occurrence; scoped current/draft revision and Undo; consented atomic request bridges; eight Studio lanes and 8–64 cells; canonical Library readiness and LRCLIB metadata disclosure; unbiased listening studies; frozen-revision decodable FLAC. Do not introduce a launcher, native folder picker, SaaS, accounts, telemetry or cloud audio.

**Proof:** An implementing PR/test SHA must be recorded for source status. A named independent reviewer, date, platform and concrete evidence are required to mark Verified. Synthetic or muted screenshots do not prove aesthetics or real audio. Docs-only work never advances implementation.

## Status governance

Decision Proposed → Accepted/Rejected/Superseded needs owner/date/rationale. Not started → In progress → Implemented needs an actual source/test PR and acceptance evidence. Independently Verified No → Yes needs separate required proof. Old programmes and task histories are untouched.

[Roadmap](selecta-measured-micro-polish-roadmap.md) · [Checklist](selecta-measured-micro-polish-implementation-checklist.md) · [Evidence](selecta-measured-micro-polish-implementation-evidence.md) · [Verification](selecta-measured-micro-polish-verification-matrix.md) · [Release](selecta-measured-micro-polish-release-gates.md).
