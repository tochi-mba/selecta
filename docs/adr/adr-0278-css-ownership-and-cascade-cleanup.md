# ADR-278 — CSS cascade collisions and visual ownership cleanup

- **Decision:** Proposed (owner review pending).
- **Implementation:** 7/8 Not started; 0/8 In progress; 1/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme:** Selecta measured micro-polish (MP). **Priority:** P0. **Baseline:** `100df40463d05b3d6a4cba8f5d06cbe193a1b0c4`. **Owner:** Unassigned.
- **Existing ADR owners:** ADR-0130, ADR-0236, ADR-0245; old statuses unchanged.
- **Source touchpoints:** `web/src/style.css`; `web/src/styles/polish.css`; `docs/adr/completion/css-ownership.md`.

## Context and evidence boundary

Selecta already has extensive implemented UI, functional tests and earlier accepted design work. This ADR adds **measurable visual acceptance**, not a claim that these features are absent or defective. Existing source and historical criteria must be reconciled before implementation; a code observation alone is not proof of a visible usability problem.

## Proposed decision and alternatives

Audit the same route, state, theme, viewport, zoom and synthetic music data before and after any pixel-level change. Adopt the smallest change justified by measured layout and human review. Preserve existing design where it already passes and record specialist exceptions. Avoid unrelated feature additions or wholesale redesign.

## Implementation checklist — 1/8 Implemented; 0/8 independently Verified

1. **MP-0278-01 — Inventory repeated selectors.** **Acceptance:** Report .card, .panel, .row, .display, .count, .song and .seam overlaps. **Required verification:** source-linked same-state geometry or screenshots, appropriate keyboard/functional regression and independent visual/AT/real-audio review where applicable. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
2. **MP-0278-02 — Assign source owners.** **Acceptance:** Each visual rule belongs to a named component/feature stylesheet. **Required verification:** source-linked same-state geometry or screenshots, appropriate keyboard/functional regression and independent visual/AT/real-audio review where applicable. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
3. **MP-0278-03 — Remove unnecessary overrides.** **Acceptance:** Consolidate duplicates only when effective behaviour is preserved. **Required verification:** source-linked same-state geometry or screenshots, appropriate keyboard/functional regression and independent visual/AT/real-audio review where applicable. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** #38 / `6a55b1643b0b`; **Evidence/reviewer:** duplicate card/panel/display/row overrides consolidated; computed E2E (unrun); independent reviewer —.
4. **MP-0278-04 — Tokenise unexplained literals.** **Acceptance:** Arbitrary margin and padding pixels become tokens or approved exceptions. **Required verification:** source-linked same-state geometry or screenshots, appropriate keyboard/functional regression and independent visual/AT/real-audio review where applicable. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
5. **MP-0278-05 — Prevent generic selector bleed.** **Acceptance:** Library and Requests classes do not unintentionally alter other views. **Required verification:** source-linked same-state geometry or screenshots, appropriate keyboard/functional regression and independent visual/AT/real-audio review where applicable. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
6. **MP-0278-06 — Review breakpoint precedence.** **Acceptance:** 620, 760, 1024 and short-height rules have clear ownership. **Required verification:** source-linked same-state geometry or screenshots, appropriate keyboard/functional regression and independent visual/AT/real-audio review where applicable. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
7. **MP-0278-07 — Preserve technical architecture.** **Acceptance:** Do not change audio, API, data, routing or persisted preferences. **Required verification:** source-linked same-state geometry or screenshots, appropriate keyboard/functional regression and independent visual/AT/real-audio review where applicable. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
8. **MP-0278-08 — Set future review rules.** **Acceptance:** Every CSS change cites owning selector, numeric delta and visual evidence. **Required verification:** source-linked same-state geometry or screenshots, appropriate keyboard/functional regression and independent visual/AT/real-audio review where applicable. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.

## Negative tests and proof

**Common cases:** Light/Dark/System, forced colours, 320–3840px incl. short landscape, 200/400% zoom, keyboard/touch/NVDA, reduced motion, long/RTL/CJK/duplicate metadata, initial/loading/empty/partial/working/failed/offline/recovery and actual sound where relevant.

**Preservation:** Original local music unchanged; one player/audio-focus owner and deliberate Pause; real timing and song/seam occurrence; scoped current/draft revision and Undo; consented atomic request bridges; eight Studio lanes and 8–64 cells; canonical Library readiness and LRCLIB metadata disclosure; unbiased listening studies; frozen-revision decodable FLAC. Do not introduce a launcher, native folder picker, SaaS, accounts, telemetry or cloud audio.

**Proof:** An implementing PR/test SHA must be recorded for source status. A named independent reviewer, date, platform and concrete evidence are required to mark Verified. Synthetic or muted screenshots do not prove aesthetics or real audio. Docs-only work never advances implementation.

## Status governance

Decision Proposed → Accepted/Rejected/Superseded needs owner/date/rationale. Not started → In progress → Implemented needs an actual source/test PR and acceptance evidence. Independently Verified No → Yes needs separate required proof. Old programmes and task histories are untouched.

[Roadmap](selecta-measured-micro-polish-roadmap.md) · [Checklist](selecta-measured-micro-polish-implementation-checklist.md) · [Evidence](selecta-measured-micro-polish-implementation-evidence.md) · [Verification](selecta-measured-micro-polish-verification-matrix.md) · [Release](selecta-measured-micro-polish-release-gates.md).
