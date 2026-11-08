# ADR-274 — Optical alignment, grid guides and one-pixel details

- **Decision:** Proposed (owner review pending).
- **Implementation:** 7/8 Not started; 1/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme:** Selecta measured micro-polish (MP). **Priority:** P0. **Baseline:** `100df40463d05b3d6a4cba8f5d06cbe193a1b0c4`. **Owner:** Unassigned.
- **Existing ADR owners:** ADR-0203, ADR-0204, ADR-0245; old statuses unchanged.
- **Source touchpoints:** `web/src/styles/shell.css`; `web/src/styles/operations.css`; `web/src/styles/creation.css`.

## Context and evidence boundary

Selecta already has extensive implemented UI, functional tests and earlier accepted design work. This ADR adds **measurable visual acceptance**, not a claim that these features are absent or defective. Existing source and historical criteria must be reconciled before implementation; a code observation alone is not proof of a visible usability problem.

## Proposed decision and alternatives

Audit the same route, state, theme, viewport, zoom and synthetic music data before and after any pixel-level change. Adopt the smallest change justified by measured layout and human review. Preserve existing design where it already passes and record specialist exceptions. Avoid unrelated feature additions or wholesale redesign.

## Implementation checklist — 0/8 Implemented; 0/8 independently Verified

1. **MP-0274-01 — Align page anchors.** **Acceptance:** Titles, breadcrumbs, filters, cards and lists share intended edges. **Required verification:** source-linked same-state geometry or screenshots, appropriate keyboard/functional regression and independent visual/AT/real-audio review where applicable. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
2. **MP-0274-02 — Centre icon glyphs.** **Acceptance:** Icons and labels align optically inside control hitboxes. **Required verification:** source-linked same-state geometry or screenshots, appropriate keyboard/functional regression and independent visual/AT/real-audio review where applicable. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
3. **MP-0274-03 — Stabilise numeric baselines.** **Acceptance:** BPM, timers, progress and counters do not jump on update. **Required verification:** source-linked same-state geometry or screenshots, appropriate keyboard/functional regression and independent visual/AT/real-audio review where applicable. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
4. **MP-0274-04 — Fix wrapped action alignment.** **Acceptance:** Buttons retain intentional card and row baselines when text wraps. **Required verification:** source-linked same-state geometry or screenshots, appropriate keyboard/functional regression and independent visual/AT/real-audio review where applicable. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
5. **MP-0274-05 — Audit border joins.** **Acceptance:** Remove accidental doubled 1px edges, asymmetric corners and clipped focus rings. **Required verification:** source-linked same-state geometry or screenshots, appropriate keyboard/functional regression and independent visual/AT/real-audio review where applicable. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
6. **MP-0274-06 — Audit sticky offsets.** **Acceptance:** Header, editor scope, inspector and Studio ruler never collide. **Required verification:** source-linked same-state geometry or screenshots, appropriate keyboard/functional regression and independent visual/AT/real-audio review where applicable. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
7. **MP-0274-07 — Prevent scrollbar movement.** **Acceptance:** Scrollbar changes do not shift navigation or content anchors. **Required verification:** source-linked same-state geometry or screenshots, appropriate keyboard/functional regression and independent visual/AT/real-audio review where applicable. **Implementation:** In progress; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** #38 / `6a55b1643b0b`; **Evidence/reviewer:** scrollbar-gutter stable added; visual comparisons pending; independent reviewer —.
8. **MP-0274-08 — Approve optical exceptions.** **Acceptance:** Record measured source-owned offsets with independent reviewer rationale. **Required verification:** source-linked same-state geometry or screenshots, appropriate keyboard/functional regression and independent visual/AT/real-audio review where applicable. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.

## Negative tests and proof

**Common cases:** Light/Dark/System, forced colours, 320–3840px incl. short landscape, 200/400% zoom, keyboard/touch/NVDA, reduced motion, long/RTL/CJK/duplicate metadata, initial/loading/empty/partial/working/failed/offline/recovery and actual sound where relevant.

**Preservation:** Original local music unchanged; one player/audio-focus owner and deliberate Pause; real timing and song/seam occurrence; scoped current/draft revision and Undo; consented atomic request bridges; eight Studio lanes and 8–64 cells; canonical Library readiness and LRCLIB metadata disclosure; unbiased listening studies; frozen-revision decodable FLAC. Do not introduce a launcher, native folder picker, SaaS, accounts, telemetry or cloud audio.

**Proof:** An implementing PR/test SHA must be recorded for source status. A named independent reviewer, date, platform and concrete evidence are required to mark Verified. Synthetic or muted screenshots do not prove aesthetics or real audio. Docs-only work never advances implementation.

## Status governance

Decision Proposed → Accepted/Rejected/Superseded needs owner/date/rationale. Not started → In progress → Implemented needs an actual source/test PR and acceptance evidence. Independently Verified No → Yes needs separate required proof. Old programmes and task histories are untouched.

[Roadmap](selecta-measured-micro-polish-roadmap.md) · [Checklist](selecta-measured-micro-polish-implementation-checklist.md) · [Evidence](selecta-measured-micro-polish-implementation-evidence.md) · [Verification](selecta-measured-micro-polish-verification-matrix.md) · [Release](selecta-measured-micro-polish-release-gates.md).
