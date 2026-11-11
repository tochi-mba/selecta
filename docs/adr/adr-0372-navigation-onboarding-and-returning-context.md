# ADR-0372 - Navigation, first-run readiness and returning-work continuity

- **Decision:** Accepted (requester approved all 24 UF ADRs on 2026-11-08; implementation and independent acceptance remain separate).
- **Implementation:** 5/8 Not started; 0/8 In progress; 3/8 Implemented (1/8 ticked in the checklist with automated evidence, 2026-11-10).
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Selecta Unified Experience Finish (UF); 2026-11-08; `main` `f17944530d54203e49baebdabc08a57ee9f40526`.
- **Priority / phase:** P0 / 03 Navigation. **Owner:** Unassigned. **Implementing PR/SHA:** -.
- **Existing ADR owners:** ADR-0208, ADR-0229, ADR-0256, ADR-0280, ADR-0282, ADR-0340, ADR-0353; unchanged.
- **Source touchpoints (review, not implementation):** `web/src/shell/manifest.ts`; `web/src/router.ts`; `web/src/views/Start.tsx`.

## Context and evidence boundary

The current UI already supports significant parts of this workflow. No code, browser, accessibility, real-audio or human task evaluation is claimed by this documentation proposal. A new UF acceptance item does not prove that matching source functionality is absent. Reconcile each item against current source, tests and previous accepted ADR decisions at the later implementing SHA.

## Proposed decision

Build on the existing five-intent shell and first-run flow without breaking deep links or silently changing music.

## User outcome and interaction contract

Users complete the named journey with clear action consequences, predictable controls and recoverable failure states. Test empty, partial, loading, stale, offline, failed, duplicate/long/RTL metadata, mobile, high zoom and relevant audio interruptions. Evidence must show the design improves comprehension without changing protected musical behaviour.

**Preservation and trade-offs:** Keep original music local/unchanged, one authoritative audio owner and deliberate Pause, exact recording/mix/draft/revision/occurrence/seam identities, guarded Undo, consented atomic request bridges, real valid ready-only seams, eight Studio lanes/8–64 cells, true library readiness and lyric provenance, frozen-revision decodable FLAC and blinded human evaluation. No SaaS, telemetry, engine rewrite or unsolicited upload.

## Implementation checklist - 3/8 Implemented; 0/8 independently Verified

1. **UF-0372-01 - Validate five destination intents.** **Acceptance:** Listen, Make a Mix, My Mixes, Library and Workspace remain understandable. **Required verification:** Uncoached route selection. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-10, coordinator commits); **Evidence/reviewer:** the five destinations exist in the navigation manifest; route inventory checked by web/src/ufBaseline.test.ts (ADR-0366) (2026-11-10); Needs a person: uncoached route-selection study. Independent reviewer -.
2. **UF-0372-02 - Preserve URL meaning.** **Acceptance:** Back, forward, aliases and refresh retain exact draft/conversation/tab target. **Required verification:** Router regression. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
3. **UF-0372-03 - Explain music-folder entry.** **Acceptance:** Local path, access errors and scan consequences are clear without promising unsupported folder pickers. **Required verification:** Setup walkthrough. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
4. **UF-0372-04 - Separate readiness stages.** **Acceptance:** Imported, analysed and mix-ready are distinct and actionable. **Required verification:** No-ready/partial-ready fixtures. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
5. **UF-0372-05 - Protect first playback.** **Acceptance:** Only genuinely eligible sets can be offered as ready; no unrequested autoplay. **Required verification:** Cold-library player test. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-10, coordinator commits); **Evidence:** web/e2e/uf-creation-entry.e2e.ts 'UF-0372-05 opening the app, Make a Mix, Listen and Library never starts music by itself' (1/1 passed, dist-r3e); web/src/views/Mixes.test.tsx 'waits for six mix-ready songs even when audio analysis has finished on more' (23/23 passed) (2026-11-10); **Evidence/reviewer:** independent reviewer -.
6. **UF-0372-06 - Restore returning work.** **Acceptance:** Recent drafts and route context return without replacing music. **Required verification:** Restart and route-state test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
7. **UF-0372-07 - Remove shell occlusion.** **Acceptance:** Rail, mobile bottom bar, context header and mini-player leave actions usable. **Required verification:** Narrow/short/zoom geometry. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
8. **UF-0372-08 - Keep focus navigation obvious.** **Acceptance:** Keyboard palette, landmarks and active destination remain coherent. **Required verification:** NVDA/VoiceOver and tab order. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-10, coordinator commits); **Evidence/reviewer:** automated part owned by MP-0280: skip link, landmarks and focused destination in web/e2e/mp-0280-navigation.e2e.ts MP-0280-06 (2026-11-10); Needs a person: NVDA/VoiceOver and physical tab-order session. Independent reviewer -.

## Verification and release boundaries

Compare baseline/candidate at the same route, viewport, theme, density, fixture, current player/revision and scroll. Test Light/Dark/System/forced-colours, 320–3840px, short landscape, 200/400% zoom, keyboard/touch/AT and reduced motion where relevant. Synthetic muted browser tests and screenshots alone do not prove real-audio quality, independent accessibility acceptance or user comprehension.

**Research:** [Existing UI/UX research](../research/ui-ux.md) · [Polish research](../research/ui-ux-polish.md) · [WCAG 2.2](https://www.w3.org/TR/WCAG22/) · [ARIA APG](https://www.w3.org/WAI/ARIA/apg/patterns/) · [NN/g progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) · [Microsoft human-AI](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/).

## Decision, implementation and independent verification

**Accepted** by requester on 2026-11-08; future supersession requires owner/date/rationale. Implementation Not started → In progress → Implemented only after exact source/test PR, SHA and item-specific evidence. Independent verification No → Yes only with separate reviewer/date/device/OS/browser/AT and relevant real user/audio/visual measurements. Update ADR, checklist, evidence ledger and JSON together; preserve older status histories.

[Roadmap](selecta-unified-finish-roadmap.md) · [192-task checklist](selecta-unified-finish-implementation-checklist.md) · [evidence](selecta-unified-finish-implementation-evidence.md) · [JSON](selecta-unified-finish-code-status.json) · [parity](selecta-unified-finish-overlap-and-parity.md) · [interaction contract](selecta-unified-finish-experience-contract.md) · [verification](selecta-unified-finish-verification-matrix.md) · [reconciliation](selecta-unified-finish-status-reconciliation.md) · [release](selecta-unified-finish-release-gates.md)
