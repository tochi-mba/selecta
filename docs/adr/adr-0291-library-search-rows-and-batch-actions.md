# ADR-291 - Library search, column alignment, density and selection rail

- **Decision:** Proposed (owner review pending).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme:** Selecta measured micro-polish (MP). **Priority:** P1. **Baseline:** `100df40463d05b3d6a4cba8f5d06cbe193a1b0c4`. **Owner:** Unassigned.
- **Existing ADR owners:** ADR-0226, ADR-0227, ADR-0251, ADR-0258, ADR-0267; old statuses unchanged.
- **Source touchpoints:** `web/src/views/Library.tsx`; `web/src/views/SongDetails.tsx`; `web/src/styles/operations.css`.

## Context and evidence boundary

Selecta already has extensive implemented UI, functional tests and earlier accepted design work. This ADR adds **measurable visual acceptance**, not a claim that these features are absent or defective. Existing source and historical criteria must be reconciled before implementation; a code observation alone is not proof of a visible usability problem.

## Proposed decision and alternatives

Audit the same route, state, theme, viewport, zoom and synthetic music data before and after any pixel-level change. Adopt the smallest change justified by measured layout and human review. Preserve existing design where it already passes and record specialist exceptions. Avoid unrelated feature additions or wholesale redesign.

## Implementation checklist - 0/8 Implemented; 0/8 independently Verified

1. **MP-0291-01 - Align toolbar.** **Acceptance:** Search, filters, sort, density and counts share clean anchors. **Required verification:** source-linked same-state geometry or screenshots, appropriate keyboard/functional regression and independent visual/AT/real-audio review where applicable. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
2. **MP-0291-02 - Align column headers to rows.** **Acceptance:** Track, facts, readiness and actions use matching grid columns. **Required verification:** source-linked same-state geometry or screenshots, appropriate keyboard/functional regression and independent visual/AT/real-audio review where applicable. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
3. **MP-0291-03 - Polish compact/standard density.** **Acceptance:** Both row sizes remain readable with safe targets. **Required verification:** source-linked same-state geometry or screenshots, appropriate keyboard/functional regression and independent visual/AT/real-audio review where applicable. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
4. **MP-0291-04 - Clarify song readiness.** **Acceptance:** Loading, ready, attention, missing and excluded have clear distinct labels. **Required verification:** source-linked same-state geometry or screenshots, appropriate keyboard/functional regression and independent visual/AT/real-audio review where applicable. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
5. **MP-0291-05 - Refine contextual selection.** **Acceptance:** Batch rail only appears with actual selection and correct count/scope. **Required verification:** source-linked same-state geometry or screenshots, appropriate keyboard/functional regression and independent visual/AT/real-audio review where applicable. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
6. **MP-0291-06 - Group song corrections.** **Acceptance:** Measured metadata, user override, error and reset fit logically. **Required verification:** source-linked same-state geometry or screenshots, appropriate keyboard/functional regression and independent visual/AT/real-audio review where applicable. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
7. **MP-0291-07 - Protect 20k library browsing.** **Acceptance:** Pagination, focus and search remain fast without layout jumping. **Required verification:** source-linked same-state geometry or screenshots, appropriate keyboard/functional regression and independent visual/AT/real-audio review where applicable. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
8. **MP-0291-08 - Study safe batch tasks.** **Acceptance:** Person completes exact-ID single and bulk actions without confusion. **Required verification:** source-linked same-state geometry or screenshots, appropriate keyboard/functional regression and independent visual/AT/real-audio review where applicable. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.

## Negative tests and proof

**Common cases:** Light/Dark/System, forced colours, 320–3840px incl. short landscape, 200/400% zoom, keyboard/touch/NVDA, reduced motion, long/RTL/CJK/duplicate metadata, initial/loading/empty/partial/working/failed/offline/recovery and actual sound where relevant.

**Preservation:** Original local music unchanged; one player/audio-focus owner and deliberate Pause; real timing and song/seam occurrence; scoped current/draft revision and Undo; consented atomic request bridges; eight Studio lanes and 8–64 cells; canonical Library readiness and LRCLIB metadata disclosure; unbiased listening studies; frozen-revision decodable FLAC. Do not introduce a launcher, native folder picker, SaaS, accounts, telemetry or cloud audio.

**Proof:** An implementing PR/test SHA must be recorded for source status. A named independent reviewer, date, platform and concrete evidence are required to mark Verified. Synthetic or muted screenshots do not prove aesthetics or real audio. Docs-only work never advances implementation.

## Status governance

Decision Proposed → Accepted/Rejected/Superseded needs owner/date/rationale. Not started → In progress → Implemented needs an actual source/test PR and acceptance evidence. Independently Verified No → Yes needs separate required proof. Old programmes and task histories are untouched.

[Roadmap](selecta-measured-micro-polish-roadmap.md) · [Checklist](selecta-measured-micro-polish-implementation-checklist.md) · [Evidence](selecta-measured-micro-polish-implementation-evidence.md) · [Verification](selecta-measured-micro-polish-verification-matrix.md) · [Release](selecta-measured-micro-polish-release-gates.md).
