# ADR-0366 — Unified finish charter, current-source baseline and ADR parity

- **Decision:** Accepted (requester approved all 24 UF ADRs on 2026-11-08; implementation and independent acceptance remain separate).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Selecta Unified Experience Finish (UF); 2026-11-08; `main` `f17944530d54203e49baebdabc08a57ee9f40526`.
- **Priority / phase:** P0 / 01 Baseline. **Owner:** Unassigned. **Implementing PR/SHA:** —.
- **Existing ADR owners:** ADR-0199, ADR-0239, ADR-0272, ADR-0299, ADR-0365; unchanged.
- **Source touchpoints (review, not implementation):** `docs/adr/README.md`; `web/src/App.tsx`.

## Context and evidence boundary

The current UI already supports significant parts of this workflow. No code, browser, accessibility, real-audio or human task evaluation is claimed by this documentation proposal. A new UF acceptance item does not prove that matching source functionality is absent. Reconcile each item against current source, tests and previous accepted ADR decisions at the later implementing SHA.

## Proposed decision

Establish one additive source-verifiable finishing backlog, without reinterpreting historical statuses or proposing duplicate missing features.

## User outcome and interaction contract

Users complete the named journey with clear action consequences, predictable controls and recoverable failure states. Test empty, partial, loading, stale, offline, failed, duplicate/long/RTL metadata, mobile, high zoom and relevant audio interruptions. Evidence must show the design improves comprehension without changing protected musical behaviour.

**Preservation and trade-offs:** Keep original music local/unchanged, one authoritative audio owner and deliberate Pause, exact recording/mix/draft/revision/occurrence/seam identities, guarded Undo, consented atomic request bridges, real valid ready-only seams, eight Studio lanes/8–64 cells, true library readiness and lyric provenance, frozen-revision decodable FLAC and blinded human evaluation. No SaaS, telemetry, engine rewrite or unsolicited upload.

## Implementation checklist — 0/8 Implemented; 0/8 independently Verified

1. **UF-0366-01 — Pin a real source baseline.** **Acceptance:** Record main SHA, route inventory and exact UI state for the starting candidate. **Required verification:** Compare source, build and capture manifest. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
2. **UF-0366-02 — Map old programme owners.** **Acceptance:** Crosswalk foundational, Flow, gap/final/micro-polish, Lucy and Library decisions. **Required verification:** Independent ADR link and owner audit. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
3. **UF-0366-03 — Classify each candidate gap.** **Acceptance:** Mark already satisfied, refinement, new, verification-only, duplicate or deferred with exact delta. **Required verification:** Sample current source and related evidence. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
4. **UF-0366-04 — Register critical user journeys.** **Acceptance:** Include first-run, listener, expert editor, returning user and errors. **Required verification:** Route and task walkthrough. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
5. **UF-0366-05 — Record preservation invariants.** **Acceptance:** Protect local audio, one player, exact IDs, Undo, consent, eight-lane Studio and FLAC. **Required verification:** Current test/contract traceability review. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
6. **UF-0366-06 — Define exclusions.** **Acceptance:** No engine rewrite, cloud upload, accounts, telemetry or native bridge without separate approval. **Required verification:** Review exact source scope. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
7. **UF-0366-07 — Prioritise by critical risk.** **Acceptance:** Sequence correctness and comprehension ahead of animation and pixel-only polish. **Required verification:** Owner-approved dependency graph. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
8. **UF-0366-08 — Approve unified charter.** **Acceptance:** Record named owner, date, rationale and any rejected proposed decisions. **Required verification:** Independent design decision audit. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.

## Verification and release boundaries

Compare baseline/candidate at the same route, viewport, theme, density, fixture, current player/revision and scroll. Test Light/Dark/System/forced-colours, 320–3840px, short landscape, 200/400% zoom, keyboard/touch/AT and reduced motion where relevant. Synthetic muted browser tests and screenshots alone do not prove real-audio quality, independent accessibility acceptance or user comprehension.

**Research:** [Existing UI/UX research](../research/ui-ux.md) · [Polish research](../research/ui-ux-polish.md) · [WCAG 2.2](https://www.w3.org/TR/WCAG22/) · [ARIA APG](https://www.w3.org/WAI/ARIA/apg/patterns/) · [NN/g progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) · [Microsoft human-AI](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/).

## Decision, implementation and independent verification

**Accepted** by requester on 2026-11-08; future supersession requires owner/date/rationale. Implementation Not started → In progress → Implemented only after exact source/test PR, SHA and item-specific evidence. Independent verification No → Yes only with separate reviewer/date/device/OS/browser/AT and relevant real user/audio/visual measurements. Update ADR, checklist, evidence ledger and JSON together; preserve older status histories.

[Roadmap](selecta-unified-finish-roadmap.md) · [192-task checklist](selecta-unified-finish-implementation-checklist.md) · [evidence](selecta-unified-finish-implementation-evidence.md) · [JSON](selecta-unified-finish-code-status.json) · [parity](selecta-unified-finish-overlap-and-parity.md) · [interaction contract](selecta-unified-finish-experience-contract.md) · [verification](selecta-unified-finish-verification-matrix.md) · [reconciliation](selecta-unified-finish-status-reconciliation.md) · [release](selecta-unified-finish-release-gates.md)
