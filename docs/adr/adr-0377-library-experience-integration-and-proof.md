# ADR-0377 - Library integration, LX ownership and exact-recording safety

- **Decision:** Accepted (requester approved all 24 UF ADRs on 2026-11-08; implementation and independent acceptance remain separate).
- **Implementation:** 7/8 Not started; 1/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Selecta Unified Experience Finish (UF); 2026-11-08; `main` `f17944530d54203e49baebdabc08a57ee9f40526`.
- **Priority / phase:** P0 / 05 Creation entry. **Owner:** Unassigned. **Implementing PR/SHA:** -.
- **Existing ADR owners:** ADR-0226, ADR-0227, ADR-0267, ADR-0291, ADR-0340, ADR-0342, ADR-0347, ADR-0350, ADR-0365; unchanged.
- **Source touchpoints (review, not implementation):** `web/src/views/Library.tsx`; `web/src/views/SongDetails.tsx`; `src/selecta/routes/library.py`.

## Context and evidence boundary

The current UI already supports significant parts of this workflow. No code, browser, accessibility, real-audio or human task evaluation is claimed by this documentation proposal. A new UF acceptance item does not prove that matching source functionality is absent. Reconcile each item against current source, tests and previous accepted ADR decisions at the later implementing SHA.

## Proposed decision

LX-0340–0352 remain primary Library design owners; UF only closes cross-app data, scope and evidence gaps.

## User outcome and interaction contract

Users complete the named journey with clear action consequences, predictable controls and recoverable failure states. Test empty, partial, loading, stale, offline, failed, duplicate/long/RTL metadata, mobile, high zoom and relevant audio interruptions. Evidence must show the design improves comprehension without changing protected musical behaviour.

**Preservation and trade-offs:** Keep original music local/unchanged, one authoritative audio owner and deliberate Pause, exact recording/mix/draft/revision/occurrence/seam identities, guarded Undo, consented atomic request bridges, real valid ready-only seams, eight Studio lanes/8–64 cells, true library readiness and lyric provenance, frozen-revision decodable FLAC and blinded human evaluation. No SaaS, telemetry, engine rewrite or unsolicited upload.

## Implementation checklist - 0/8 Implemented; 0/8 independently Verified

1. **UF-0377-01 - Crosswalk LX Library work.** **Acceptance:** Avoid restating LX-0340–0352 as unimplemented functionality. **Required verification:** Owner/parity decision audit. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
2. **UF-0377-02 - Protect recording ID navigation.** **Acceptance:** Playback and mix actions use stable exact ID, not row position or title. **Required verification:** Duplicate-title fixture. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
3. **UF-0377-03 - Preserve search URL and Back.** **Acceptance:** Filter, sort and selected detail survive history/reload as intended. **Required verification:** Route-state test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
4. **UF-0377-04 - Reconcile readiness counts.** **Acceptance:** Library, Make a Mix and Workspace use canonical source status. **Required verification:** Cross-route fixture. **Implementation:** In progress; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** #41 / `471bcdfb50e96188f2f3a7c252b0bedc33cbff06`; **Evidence/reviewer:** `web/src/state/readiness.ts` and readiness tests; cross-route audit pending.
5. **UF-0377-05 - Protect loaded batch selection.** **Acceptance:** Large filtered libraries never mutate outside confirmed selected IDs. **Required verification:** 200-loaded/20k test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
6. **UF-0377-06 - Measure collection scale.** **Acceptance:** Search, scrolling and batch interaction budgets tested on 20k fixture. **Required verification:** Named-device benchmark. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
7. **UF-0377-07 - Ensure inspector and player parity.** **Acceptance:** Details overlay does not lose focus or obscure player at zoom. **Required verification:** Mobile/keyboard test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
8. **UF-0377-08 - Record real integration deltas.** **Acceptance:** Only changes not owned by LX get a UF implementation task; update statuses independently. **Required verification:** Source-to-ADR review. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.

## LX crosswalk and real integration deltas (UF-0377-01 and UF-0377-08, recorded 2026-11-10)

Library design and behaviour belong to LX-0340 to LX-0352 and are not restated here as missing. Only the deltas below were UF's own:

| UF task | LX / earlier owner | Classification | Proof |
|---|---|---|---|
| UF-0377-02 exact recording ID | LX-0340-05, LX-0344-01, LX-0345-03, GP-0258 | already satisfied | `web/e2e/lx-library.e2e.ts` LX-0340-05, `web/src/views/gp-0258-batch.test.tsx` |
| UF-0377-03 search URL and Back | LX-0342-02, LX-0343-03 | already satisfied | `web/e2e/lx-library.e2e.ts` LX-0342-02, `web/src/router.test.tsx` "remembers filters in the address, without adding to Back" |
| UF-0377-04 readiness counts | ADR-0227, LX-0341 | UF delta: one canonical count across Library, Make a Mix and Workspace | `web/src/views/readinessCounts.test.tsx` |
| UF-0377-05 loaded batch selection | LX-0347, GP-0258 | already satisfied | `web/src/views/gp-0258-batch.test.tsx` "sends exactly the selected IDs", `web/e2e/lx-library.e2e.ts` LX-0347-04 |
| UF-0377-06 collection scale | LX-0350, MP-0291-07 | verification only (named-device benchmark needs a person) | `web/e2e/mp-0291-library.e2e.ts` MP-0291-07 (20,000 songs, lab) |
| UF-0377-07 inspector and player parity | LX-0348, LX-0351 | UF delta: 400% zoom focus and player reachability | `web/e2e/uf-creation-entry.e2e.ts` UF-0377-07 |

## Verification and release boundaries

Compare baseline/candidate at the same route, viewport, theme, density, fixture, current player/revision and scroll. Test Light/Dark/System/forced-colours, 320–3840px, short landscape, 200/400% zoom, keyboard/touch/AT and reduced motion where relevant. Synthetic muted browser tests and screenshots alone do not prove real-audio quality, independent accessibility acceptance or user comprehension.

**Research:** [Existing UI/UX research](../research/ui-ux.md) · [Polish research](../research/ui-ux-polish.md) · [WCAG 2.2](https://www.w3.org/TR/WCAG22/) · [ARIA APG](https://www.w3.org/WAI/ARIA/apg/patterns/) · [NN/g progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) · [Microsoft human-AI](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/).

## Decision, implementation and independent verification

**Accepted** by requester on 2026-11-08; future supersession requires owner/date/rationale. Implementation Not started → In progress → Implemented only after exact source/test PR, SHA and item-specific evidence. Independent verification No → Yes only with separate reviewer/date/device/OS/browser/AT and relevant real user/audio/visual measurements. Update ADR, checklist, evidence ledger and JSON together; preserve older status histories.

[Roadmap](selecta-unified-finish-roadmap.md) · [192-task checklist](selecta-unified-finish-implementation-checklist.md) · [evidence](selecta-unified-finish-implementation-evidence.md) · [JSON](selecta-unified-finish-code-status.json) · [parity](selecta-unified-finish-overlap-and-parity.md) · [interaction contract](selecta-unified-finish-experience-contract.md) · [verification](selecta-unified-finish-verification-matrix.md) · [reconciliation](selecta-unified-finish-status-reconciliation.md) · [release](selecta-unified-finish-release-gates.md)
