# ADR-275 — Typography scale, text wrapping and numeric metadata

- **Decision:** Proposed (owner review pending).
- **Implementation:** 7/8 Not started; 0/8 In progress; 1/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme:** Selecta measured micro-polish (MP). **Priority:** P0. **Baseline:** `100df40463d05b3d6a4cba8f5d06cbe193a1b0c4`. **Owner:** Unassigned.
- **Existing ADR owners:** ADR-0202, ADR-0248, ADR-0257; old statuses unchanged.
- **Source touchpoints:** `web/src/styles/tokens.css`; `web/src/views/Now.tsx`; `web/src/views/Library.tsx`.

## Context and evidence boundary

Selecta already has extensive implemented UI, functional tests and earlier accepted design work. This ADR adds **measurable visual acceptance**, not a claim that these features are absent or defective. Existing source and historical criteria must be reconciled before implementation; a code observation alone is not proof of a visible usability problem.

## Proposed decision and alternatives

Audit the same route, state, theme, viewport, zoom and synthetic music data before and after any pixel-level change. Adopt the smallest change justified by measured layout and human review. Preserve existing design where it already passes and record specialist exceptions. Avoid unrelated feature additions or wholesale redesign.

## Implementation checklist — 1/8 Implemented; 0/8 independently Verified

1. **MP-0275-01 — Map typographic hierarchy.** **Acceptance:** Display, page, section, track title, caption and metadata have distinct roles. **Required verification:** source-linked same-state geometry or screenshots, appropriate keyboard/functional regression and independent visual/AT/real-audio review where applicable. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
2. **MP-0275-02 — Resolve duplicate display styling.** **Acceptance:** Global and later .display line-height/font rules have intentional ownership. **Required verification:** source-linked same-state geometry or screenshots, appropriate keyboard/functional regression and independent visual/AT/real-audio review where applicable. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** #38 / `6a55b1643b0b`; **Evidence/reviewer:** display/small typography in style.css; duplicate in polish.css removed; E2E test added (unrun); independent reviewer —.
3. **MP-0275-03 — Keep focal song names readable.** **Acceptance:** Listen, Stage and details favour complete titles over arbitrary shrinking. **Required verification:** source-linked same-state geometry or screenshots, appropriate keyboard/functional regression and independent visual/AT/real-audio review where applicable. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
4. **MP-0275-04 — Truncate dense rows accessibly.** **Acceptance:** Full identity remains accessible when Library/Editor visually ellipsises. **Required verification:** source-linked same-state geometry or screenshots, appropriate keyboard/functional regression and independent visual/AT/real-audio review where applicable. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
5. **MP-0275-05 — Use stable numbers.** **Acceptance:** Time, BPM, percentages and song counts preserve alignment while changing. **Required verification:** source-linked same-state geometry or screenshots, appropriate keyboard/functional regression and independent visual/AT/real-audio review where applicable. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
6. **MP-0275-06 — Balance secondary copy.** **Acceptance:** Supporting artist/readiness labels are quieter but sufficiently contrasted. **Required verification:** source-linked same-state geometry or screenshots, appropriate keyboard/functional regression and independent visual/AT/real-audio review where applicable. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
7. **MP-0275-07 — Protect text zoom.** **Acceptance:** 200% and 400% zoom never clip or obscure text and key controls. **Required verification:** source-linked same-state geometry or screenshots, appropriate keyboard/functional regression and independent visual/AT/real-audio review where applicable. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
8. **MP-0275-08 — Check international typesetting.** **Acceptance:** RTL, CJK, emoji, accented and mixed-script punctuation preserve meaning. **Required verification:** source-linked same-state geometry or screenshots, appropriate keyboard/functional regression and independent visual/AT/real-audio review where applicable. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.

## Negative tests and proof

**Common cases:** Light/Dark/System, forced colours, 320–3840px incl. short landscape, 200/400% zoom, keyboard/touch/NVDA, reduced motion, long/RTL/CJK/duplicate metadata, initial/loading/empty/partial/working/failed/offline/recovery and actual sound where relevant.

**Preservation:** Original local music unchanged; one player/audio-focus owner and deliberate Pause; real timing and song/seam occurrence; scoped current/draft revision and Undo; consented atomic request bridges; eight Studio lanes and 8–64 cells; canonical Library readiness and LRCLIB metadata disclosure; unbiased listening studies; frozen-revision decodable FLAC. Do not introduce a launcher, native folder picker, SaaS, accounts, telemetry or cloud audio.

**Proof:** An implementing PR/test SHA must be recorded for source status. A named independent reviewer, date, platform and concrete evidence are required to mark Verified. Synthetic or muted screenshots do not prove aesthetics or real audio. Docs-only work never advances implementation.

## Status governance

Decision Proposed → Accepted/Rejected/Superseded needs owner/date/rationale. Not started → In progress → Implemented needs an actual source/test PR and acceptance evidence. Independently Verified No → Yes needs separate required proof. Old programmes and task histories are untouched.

[Roadmap](selecta-measured-micro-polish-roadmap.md) · [Checklist](selecta-measured-micro-polish-implementation-checklist.md) · [Evidence](selecta-measured-micro-polish-implementation-evidence.md) · [Verification](selecta-measured-micro-polish-verification-matrix.md) · [Release](selecta-measured-micro-polish-release-gates.md).
