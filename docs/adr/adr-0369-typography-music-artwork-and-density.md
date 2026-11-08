# ADR-0369 — Typography, honest artwork, spatial rhythm and density

- **Decision:** Proposed (owner review pending; no approval recorded).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Selecta Unified Experience Finish (UF); 2026-11-08; `main` `f17944530d54203e49baebdabc08a57ee9f40526`.
- **Priority / phase:** P1 / 02 Foundation. **Owner:** Unassigned. **Implementing PR/SHA:** —.
- **Existing ADR owners:** ADR-0202, ADR-0203, ADR-0206, ADR-0245, ADR-0248, ADR-0273, ADR-0275, ADR-0276; unchanged.
- **Source touchpoints (review, not implementation):** `web/src/styles/tokens.css`; `web/src/ui/MusicObjects.tsx`.

## Context and evidence boundary

The current UI already supports significant parts of this workflow. No code, browser, accessibility, real-audio or human task evaluation is claimed by this documentation proposal. A new UF acceptance item does not prove that matching source functionality is absent. Reconcile each item against current source, tests and previous accepted ADR decisions at the later implementing SHA.

## Proposed decision

Balance expressive Listen and mix identity with precise readable library, timing and music editing UI.

## User outcome and interaction contract

Users complete the named journey with clear action consequences, predictable controls and recoverable failure states. Test empty, partial, loading, stale, offline, failed, duplicate/long/RTL metadata, mobile, high zoom and relevant audio interruptions. Evidence must show the design improves comprehension without changing protected musical behaviour.

**Preservation and trade-offs:** Keep original music local/unchanged, one authoritative audio owner and deliberate Pause, exact recording/mix/draft/revision/occurrence/seam identities, guarded Undo, consented atomic request bridges, real valid ready-only seams, eight Studio lanes/8–64 cells, true library readiness and lyric provenance, frozen-revision decodable FLAC and blinded human evaluation. No SaaS, telemetry, engine rewrite or unsolicited upload.

## Implementation checklist — 0/8 Implemented; 0/8 independently Verified

1. **UF-369-01 — Define type roles.** **Acceptance:** Specify display, headings, body, metadata, lyrics and numeric values. **Required verification:** Full-screen typographic review. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
2. **UF-369-02 — Handle difficult song metadata.** **Acceptance:** Long, CJK, RTL, repeated titles and unknown artists remain identifiable. **Required verification:** Text fixture and AT reading. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
3. **UF-369-03 — Standardise spacing relationships.** **Acceptance:** Use defined token rhythm for peer controls, cards, sections and explanatory text. **Required verification:** Breakpoint geometry snapshots. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
4. **UF-369-04 — Bound decorative surfaces.** **Acceptance:** Cards/elevation express actual object grouping rather than nested chrome. **Required verification:** Page-specific composition review. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
5. **UF-369-05 — Use truthful imagery.** **Acceptance:** Real authorised art or explicitly decorative motifs, never invented album covers. **Required verification:** Artwork provenance/no-art fixture. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
6. **UF-369-06 — Balance scene density.** **Acceptance:** Listen is spacious; Library and Studio preserve expert scan speed. **Required verification:** Novice and expert task comparison. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
7. **UF-369-07 — Protect compact-mode functionality.** **Acceptance:** Density never changes action meaning or makes pointer/touch targets inaccessible. **Required verification:** Comfortable/compact parity checks. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
8. **UF-369-08 — Verify theme image/text balance.** **Acceptance:** Overlays, contrast and focus survive artwork and both themes. **Required verification:** Paired light/dark review. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.

## Verification and release boundaries

Compare baseline/candidate at the same route, viewport, theme, density, fixture, current player/revision and scroll. Test Light/Dark/System/forced-colours, 320–3840px, short landscape, 200/400% zoom, keyboard/touch/AT and reduced motion where relevant. Synthetic muted browser tests and screenshots alone do not prove real-audio quality, independent accessibility acceptance or user comprehension.

**Research:** [Existing UI/UX research](../research/ui-ux.md) · [Polish research](../research/ui-ux-polish.md) · [WCAG 2.2](https://www.w3.org/TR/WCAG22/) · [ARIA APG](https://www.w3.org/WAI/ARIA/apg/patterns/) · [NN/g progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) · [Microsoft human-AI](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/).

## Decision, implementation and independent verification

**Proposed** → Accepted/Rejected/Superseded only by named owner/date/rationale. Implementation Not started → In progress → Implemented only after exact source/test PR, SHA and item-specific evidence. Independent verification No → Yes only with separate reviewer/date/device/OS/browser/AT and relevant real user/audio/visual measurements. Update ADR, checklist, evidence ledger and JSON together; preserve older status histories.

[Roadmap](selecta-unified-finish-roadmap.md) · [192-task checklist](selecta-unified-finish-implementation-checklist.md) · [evidence](selecta-unified-finish-implementation-evidence.md) · [JSON](selecta-unified-finish-code-status.json) · [parity](selecta-unified-finish-overlap-and-parity.md) · [interaction contract](selecta-unified-finish-experience-contract.md) · [verification](selecta-unified-finish-verification-matrix.md) · [reconciliation](selecta-unified-finish-status-reconciliation.md) · [release](selecta-unified-finish-release-gates.md)
