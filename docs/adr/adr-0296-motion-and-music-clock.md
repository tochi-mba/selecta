# ADR-296 - Motion tokens, interruptions and truthful musical animation

- **Decision:** Proposed (owner review pending).
- **Implementation:** 5/8 Not started; 1/8 In progress; 2/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme:** Selecta measured micro-polish (MP). **Priority:** P1. **Baseline:** `100df40463d05b3d6a4cba8f5d06cbe193a1b0c4`. **Owner:** Unassigned.
- **Existing ADR owners:** ADR-0137, ADR-0205, ADR-0211, ADR-0266; old statuses unchanged.
- **Source touchpoints:** `web/src/styles/tokens.css`; `web/src/styles/polish.css`; `web/src/views/Now.tsx`.

## Context and evidence boundary

Selecta already has extensive implemented UI, functional tests and earlier accepted design work. This ADR adds **measurable visual acceptance**, not a claim that these features are absent or defective. Existing source and historical criteria must be reconciled before implementation; a code observation alone is not proof of a visible usability problem.

## Proposed decision and alternatives

Audit the same route, state, theme, viewport, zoom and synthetic music data before and after any pixel-level change. Adopt the smallest change justified by measured layout and human review. Preserve existing design where it already passes and record specialist exceptions. Avoid unrelated feature additions or wholesale redesign.

## Implementation checklist - 2/8 Implemented; 0/8 independently Verified

1. **MP-0296-01 - Inventory animated surfaces.** **Acceptance:** Button, dialog, card, skeleton, drag, spectrum and lyric motion triggers listed. **Required verification:** source-linked same-state geometry or screenshots, appropriate keyboard/functional regression and independent visual/AT/real-audio review where applicable. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** #51; **Evidence:** docs/engineering/motion-inventory.md (buttons, dialog, sheet, drawer, cards, skeleton, drag, spectrum and lyric surfaces with their triggers, tokens and Still behaviour); web/src/styles/motion-tokens.test.ts 'MP-0296-01 every keyframe animation and every exception is in the motion inventory' (passed 2026-11-10); **Evidence/reviewer:** independent reviewer -.
2. **MP-0296-02 - Use semantic motion tokens.** **Acceptance:** 80/120/160/200/220/240ms choices tied to intended purpose. **Required verification:** source-linked same-state geometry or screenshots, appropriate keyboard/functional regression and independent visual/AT/real-audio review where applicable. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** #51; **Evidence:** web/src/styles/tokens.css (--motion-feedback 80, fast 120, reveal 160, handoff 200, overlay 220, slow 240, all 0ms under Still and reduced motion), docs/engineering/motion-inventory.md purpose table; web/src/styles/motion-tokens.test.ts 'MP-0296-02 the six tokens keep their documented 80 to 240ms values and purposes' and 'MP-0296-02 every stylesheet duration is a motion token or a listed exception' (passed 2026-11-10); **Evidence/reviewer:** independent reviewer -.
3. **MP-0296-03 - Keep click targets stable.** **Acceptance:** Pressed and hovered controls never move out from under pointer. **Required verification:** source-linked same-state geometry or screenshots, appropriate keyboard/functional regression and independent visual/AT/real-audio review where applicable. **Implementation:** In progress; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** #38 / `6a55b1643b0b`; **Evidence/reviewer:** active transform removed; click geometry measurement pending; independent reviewer -.
4. **MP-0296-04 - Bind music movement to clock.** **Acceptance:** Countdown, lyric focus and playhead follow actual player data. **Required verification:** source-linked same-state geometry or screenshots, appropriate keyboard/functional regression and independent visual/AT/real-audio review where applicable. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
5. **MP-0296-05 - Stop interrupted motion.** **Acceptance:** Rapid close/seek/route change cannot leave stale animation. **Required verification:** source-linked same-state geometry or screenshots, appropriate keyboard/functional regression and independent visual/AT/real-audio review where applicable. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
6. **MP-0296-06 - Respect Still and reduced motion.** **Acceptance:** Decorative movement absent while critical data still updates. **Required verification:** source-linked same-state geometry or screenshots, appropriate keyboard/functional regression and independent visual/AT/real-audio review where applicable. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
7. **MP-0296-07 - Protect CPU and battery.** **Acceptance:** Visualizer at most 15fps while playing and idle when hidden. **Required verification:** source-linked same-state geometry or screenshots, appropriate keyboard/functional regression and independent visual/AT/real-audio review where applicable. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
8. **MP-0296-08 - Review long-session comfort.** **Acceptance:** Motion never overwhelms attention or audible transition. **Required verification:** source-linked same-state geometry or screenshots, appropriate keyboard/functional regression and independent visual/AT/real-audio review where applicable. **Implementation:** Not started (Needs a person: a long listening session judging that motion never overwhelms attention or an audible transition); **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence:** automated candidates only: web/e2e/mp-0296-motion.e2e.ts and docs/engineering/motion-inventory.md; **Evidence/reviewer:** independent reviewer -.

## Negative tests and proof

**Common cases:** Light/Dark/System, forced colours, 320–3840px incl. short landscape, 200/400% zoom, keyboard/touch/NVDA, reduced motion, long/RTL/CJK/duplicate metadata, initial/loading/empty/partial/working/failed/offline/recovery and actual sound where relevant.

**Preservation:** Original local music unchanged; one player/audio-focus owner and deliberate Pause; real timing and song/seam occurrence; scoped current/draft revision and Undo; consented atomic request bridges; eight Studio lanes and 8–64 cells; canonical Library readiness and LRCLIB metadata disclosure; unbiased listening studies; frozen-revision decodable FLAC. Do not introduce a launcher, native folder picker, SaaS, accounts, telemetry or cloud audio.

**Proof:** An implementing PR/test SHA must be recorded for source status. A named independent reviewer, date, platform and concrete evidence are required to mark Verified. Synthetic or muted screenshots do not prove aesthetics or real audio. Docs-only work never advances implementation.

## Status governance

Decision Proposed → Accepted/Rejected/Superseded needs owner/date/rationale. Not started → In progress → Implemented needs an actual source/test PR and acceptance evidence. Independently Verified No → Yes needs separate required proof. Old programmes and task histories are untouched.

[Roadmap](selecta-measured-micro-polish-roadmap.md) · [Checklist](selecta-measured-micro-polish-implementation-checklist.md) · [Evidence](selecta-measured-micro-polish-implementation-evidence.md) · [Verification](selecta-measured-micro-polish-verification-matrix.md) · [Release](selecta-measured-micro-polish-release-gates.md).
