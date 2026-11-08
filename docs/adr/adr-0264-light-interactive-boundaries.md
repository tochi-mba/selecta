# ADR-0264 — Light-theme interactive boundary semantics

- **Decision:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation:** 0/8 Implemented; 0/8 In progress; 8/8 Not started.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Selecta final polish (FP), 2026-11-08; main `5347e7309c5ff8b2e2965c2194bf2089b6ad2721`.
- **Priority / phase:** P0 / Theme foundations.
- **Owner:** Unassigned.
- **Existing primary ADRs:** ADR-0201, ADR-0204, ADR-0234, ADR-0257. Their decisions and implementation histories are not changed.
- **Source touchpoints:** `web/src/styles/tokens.css`; `web/src/styles/foundation.css`; `web/src/styles/shell.css`; `web/src/views/Library.tsx`.

## Context and evidence boundary

Light mode already uses warm cream backgrounds and semantic tokens. The existing --line #D5CFBD against raised --panel #FFFDF6 measures about 1.53:1. This is not automatically a failure for decorative edges, but functional boundaries cannot rely on an imperceptible line. The general theme and WCAG obligations are already owned by ADR-0201/0234.

This is a proposal for additional, *precisely testable* acceptance, not a claim that the existing app or previous ADR is unimplemented. Source observations are not independent human, visual, audio or accessibility verification.

## Novel delta and proposed decision

**New delta:** Define an explicit classification of *interactive* versus *decorative* boundaries on actual light surfaces, and measurable criteria for combined focus, selection and playing states. Do not create a duplicate colour system.

**Decision proposal:** Only functional boundaries that communicate an actionable component or state need applicable non-text contrast (normally at least 3:1); decorative dividers do not. Use semantic edge tokens, shapes and labels rather than darkening all separators. Preserve the filled lime/dark-ink primary action.

**Alternatives:** Do nothing when baseline testing finds no material usability problem; improve the specific existing component over a wholesale scene or token rewrite. Owner may reject or supersede after documenting decision/date.

## Implementation checklist — 0/8 Implemented; 0/8 Verified

1. **FP-0264-01 — Map functional edge roles.** **Acceptance:** Every form control, actionable row, tab, modal, menu and selectable music item has a recorded edge role and adjacent surface; decorative-only lines are explicitly excluded. **Required verification:** Role-by-component inventory; 2 themes and six key UI states **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
2. **FP-0264-02 — Measure real boundary contrast.** **Acceptance:** Sample computed colours at immediate component/surface adjacency and record whether each essential indicator meets applicable 3:1 non-text contrast. **Required verification:** Contrast report with automated fixture values and justified exemptions **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
3. **FP-0264-03 — Specify semantic role tokens.** **Acceptance:** Interactive-edge, decorative-divider, selected-edge, error-edge and focus-edge roles are distinct; raw light-mode hex overrides are prohibited outside palettes. **Required verification:** Token dependency review and component specimen **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
4. **FP-0264-04 — Keep branded lime accessible.** **Acceptance:** Lime remains filled with dark ink for primary emphasis; it is not used as thin sole indicator on cream. **Required verification:** Contrast and colour-blind/grayscale inspection **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
5. **FP-0264-05 — Make concurrent states legible.** **Acceptance:** Focus, selection, playback and error can be perceived when more than one is true, including keyboard-selected current tracks. **Required verification:** Multi-state Library/Editor keyboard snapshots **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
6. **FP-0264-06 — Harden menus and form boundaries.** **Acceptance:** Inputs, dropdowns, comboboxes, dialog affordances and disabled controls are perceivable without relying only on a subtle divider. **Required verification:** NVDA/Edge, keyboard and 400% zoom manual checks **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
7. **FP-0264-07 — Protect dark and forced-colour parity.** **Acceptance:** Any token refinement preserves dark-theme depth and enforced High Contrast state/shape visibility. **Required verification:** Theme-switch E2E and forced-colour matrix **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
8. **FP-0264-08 — Obtain independent sign-off.** **Acceptance:** Every failing functional edge is resolved or explicitly rejected with reason, SHA, reviewer and exact state; automation alone cannot mark Verified. **Required verification:** Dated signed report; zero unreviewed P0 functional boundary defects **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.

## Invariants, negative cases and gates

**Area-specific negatives:** cream on cream; nested panel; selected plus keyboard focus; selected plus playing; disabled versus active; grayscale; forced colors; 320px and 400% zoom.

**Shared matrix:** Both light/dark themes and System, OS forced colours, Still/reduced-motion, 320–2560px and 400% zoom, real long/duplicate/Unicode/RTL metadata, idle/loading/failure/offline/stale, keyboard/touch/NVDA, and real audio when relevant.

**Non-negotiable:** Original local audio is never changed; preserve one audio owner and explicit Pause, song/seam occurrence and revision identity, scoped Undo, consented atomic bridges, eight Studio lanes (8–64 cells), truthful readiness, private local data, neutral blind studies and frozen-revision FLAC. No SaaS/cloud music/telemetry/new account feature.

**Proof:** Computed adjacent-surface contrast table, matched light/dark specimen gallery, NVDA/keyboard and independent visual review. Capture named independent reviewer, device, browser/OS, exact implementing code SHA, actual outcomes and failure cases. Muted synthetic CI/screenshots alone are not independent verification.

## Decision, implementation and verification lifecycle

Decision **Proposed → Accepted/Rejected/Superseded** requires explicit dated owner rationale. Implementation **Not started → In progress → Implemented** requires a linked source/test PR and SHA satisfying each exact task; a docs-only PR is *never* implementation. **Independently Verified = Yes** requires separate reviewer and dated evidence. No previous T/P/S3/S31/S4/EX/MI/CI/SF/GP ledger or status is modified.

[Roadmap](selecta-final-polish-roadmap.md) · [Task register](selecta-final-polish-implementation-checklist.md) · [Evidence](selecta-final-polish-implementation-evidence.md) · [Verification](selecta-final-polish-verification-matrix.md).
