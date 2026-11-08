# ADR-0368 — Semantic design tokens, theme contrast and CSS ownership

- **Decision:** Proposed (owner review pending; no approval recorded).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Selecta Unified Experience Finish (UF); 2026-11-08; `main` `f17944530d54203e49baebdabc08a57ee9f40526`.
- **Priority / phase:** P0 / 02 Foundation. **Owner:** Unassigned. **Implementing PR/SHA:** —.
- **Existing ADR owners:** ADR-0200, ADR-0201, ADR-0203, ADR-0236, ADR-0264, ADR-0273, ADR-0278; unchanged.
- **Source touchpoints (review, not implementation):** `web/src/main.tsx`; `web/src/styles/tokens.css`; `web/src/style.css`; `web/src/styles/polish.css`.

## Context and evidence boundary

The current UI already supports significant parts of this workflow. No code, browser, accessibility, real-audio or human task evaluation is claimed by this documentation proposal. A new UF acceptance item does not prove that matching source functionality is absent. Reconcile each item against current source, tests and previous accepted ADR decisions at the later implementing SHA.

## Proposed decision

Make legacy and modern CSS cascade behaviour intentional while protecting existing warm-dark Selecta identity.

## User outcome and interaction contract

Users complete the named journey with clear action consequences, predictable controls and recoverable failure states. Test empty, partial, loading, stale, offline, failed, duplicate/long/RTL metadata, mobile, high zoom and relevant audio interruptions. Evidence must show the design improves comprehension without changing protected musical behaviour.

**Preservation and trade-offs:** Keep original music local/unchanged, one authoritative audio owner and deliberate Pause, exact recording/mix/draft/revision/occurrence/seam identities, guarded Undo, consented atomic request bridges, real valid ready-only seams, eight Studio lanes/8–64 cells, true library readiness and lyric provenance, frozen-revision decodable FLAC and blinded human evaluation. No SaaS, telemetry, engine rewrite or unsolicited upload.

## Implementation checklist — 0/8 Implemented; 0/8 independently Verified

1. **UF-368-01 — Inventory CSS imports.** **Acceptance:** Record import order, selector ownership and high-specificity exceptions. **Required verification:** Computed-style inventory. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
2. **UF-368-02 — Assign semantic token ownership.** **Acceptance:** One source for text, surface, focus, selection, statuses, borders and spacing. **Required verification:** Static token and reference audit. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
3. **UF-368-03 — Preserve approved visual identity.** **Acceptance:** Retain warm-dark brand and bright accent unless evidence warrants adjustment. **Required verification:** Before/after owner critique. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
4. **UF-368-04 — Reconcile overlapping geometry.** **Acceptance:** Measure panel/card/page values before removing or changing overrides. **Required verification:** Matched CSS geometry report. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
5. **UF-368-05 — Verify theme precedence.** **Acceptance:** Manual Light/Dark/System changes and first-paint state remain stable. **Required verification:** Theme persistence and screenshot suite. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
6. **UF-368-06 — Check contrast at final surfaces.** **Acceptance:** Text and non-text boundaries meet applicable WCAG criteria. **Required verification:** Contrast measurement. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
7. **UF-368-07 — Document new CSS rules.** **Acceptance:** Every shared selector and page-local rule has named ownership and an exception policy. **Required verification:** PR review/lint protocol. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
8. **UF-368-08 — Approve cascade regression proof.** **Acceptance:** No unreviewed style drift under representative themes, sizes or density. **Required verification:** Paired screenshot and computed CSS acceptance. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.

## Verification and release boundaries

Compare baseline/candidate at the same route, viewport, theme, density, fixture, current player/revision and scroll. Test Light/Dark/System/forced-colours, 320–3840px, short landscape, 200/400% zoom, keyboard/touch/AT and reduced motion where relevant. Synthetic muted browser tests and screenshots alone do not prove real-audio quality, independent accessibility acceptance or user comprehension.

**Research:** [Existing UI/UX research](../research/ui-ux.md) · [Polish research](../research/ui-ux-polish.md) · [WCAG 2.2](https://www.w3.org/TR/WCAG22/) · [ARIA APG](https://www.w3.org/WAI/ARIA/apg/patterns/) · [NN/g progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) · [Microsoft human-AI](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/).

## Decision, implementation and independent verification

**Proposed** → Accepted/Rejected/Superseded only by named owner/date/rationale. Implementation Not started → In progress → Implemented only after exact source/test PR, SHA and item-specific evidence. Independent verification No → Yes only with separate reviewer/date/device/OS/browser/AT and relevant real user/audio/visual measurements. Update ADR, checklist, evidence ledger and JSON together; preserve older status histories.

[Roadmap](selecta-unified-finish-roadmap.md) · [192-task checklist](selecta-unified-finish-implementation-checklist.md) · [evidence](selecta-unified-finish-implementation-evidence.md) · [JSON](selecta-unified-finish-code-status.json) · [parity](selecta-unified-finish-overlap-and-parity.md) · [interaction contract](selecta-unified-finish-experience-contract.md) · [verification](selecta-unified-finish-verification-matrix.md) · [reconciliation](selecta-unified-finish-status-reconciliation.md) · [release](selecta-unified-finish-release-gates.md)
