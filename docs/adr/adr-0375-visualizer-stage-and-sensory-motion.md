# ADR-0375 - Existing fifteen visualisers, Stage and sensory-safe motion

- **Decision:** Accepted (requester approved all 24 UF ADRs on 2026-11-08; implementation and independent acceptance remain separate).
- **Implementation:** 7/8 Not started; 0/8 In progress; 1/8 Implemented (0/8 ticked in the checklist with automated evidence, 2026-11-10).
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Selecta Unified Experience Finish (UF); 2026-11-08; `main` `f17944530d54203e49baebdabc08a57ee9f40526`.
- **Priority / phase:** P1 / 04 Listen. **Owner:** Unassigned. **Implementing PR/SHA:** -.
- **Existing ADR owners:** ADR-0205, ADR-0212, ADR-0213, ADR-0266, ADR-0285, ADR-0296; unchanged.
- **Source touchpoints (review, not implementation):** `web/src/views/spectrumVisuals.ts`; `web/src/views/Now.tsx`; `web/src/ui/useReducedMotion.ts`.

## Context and evidence boundary

The current UI already supports significant parts of this workflow. No code, browser, accessibility, real-audio or human task evaluation is claimed by this documentation proposal. A new UF acceptance item does not prove that matching source functionality is absent. Reconcile each item against current source, tests and previous accepted ADR decisions at the later implementing SHA.

## Proposed decision

Curate existing visualisers and motion preferences rather than rebuilding modes or faking music visuals.

## User outcome and interaction contract

Users complete the named journey with clear action consequences, predictable controls and recoverable failure states. Test empty, partial, loading, stale, offline, failed, duplicate/long/RTL metadata, mobile, high zoom and relevant audio interruptions. Evidence must show the design improves comprehension without changing protected musical behaviour.

**Preservation and trade-offs:** Keep original music local/unchanged, one authoritative audio owner and deliberate Pause, exact recording/mix/draft/revision/occurrence/seam identities, guarded Undo, consented atomic request bridges, real valid ready-only seams, eight Studio lanes/8–64 cells, true library readiness and lyric provenance, frozen-revision decodable FLAC and blinded human evaluation. No SaaS, telemetry, engine rewrite or unsolicited upload.

## Implementation checklist - 1/8 Implemented; 0/8 independently Verified

1. **UF-0375-01 - Preserve all fifteen options.** **Acceptance:** No visualiser is accidentally removed; choices remain stable. **Required verification:** Style list regression. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
2. **UF-0375-02 - Use live audio bins only.** **Acceptance:** Pause/silence produce truthful visual stillness. **Required verification:** Known frequency/silence fixture. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
3. **UF-0375-03 - Make visualiser choice accessible.** **Acceptance:** Recommended presentation does not hide full selector. **Required verification:** Preference-switch task. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
4. **UF-0375-04 - Sync effects to real transitions.** **Acceptance:** Visual handoffs correspond to actual audio clock not animation loop. **Required verification:** Recorded correlation. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
5. **UF-0375-05 - Respect reduced motion first.** **Acceptance:** OS preference overrides Subtle/Expressive; Still mode is consistently calm. **Required verification:** Motion matrix. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
6. **UF-0375-06 - Review sensory safety.** **Acceptance:** Flashing, brightness and lyric distraction have conservative defaults. **Required verification:** Sensory and contrast review. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-10, coordinator commits); **Evidence/reviewer:** conservative defaults: OS reduced motion wins and Still mode exists (web/e2e/motion-preference.e2e.ts, MP-0296-06) (2026-11-10); Needs a person: sensory (flashing, brightness, lyric distraction) and contrast review by a person. Independent reviewer -.
7. **UF-0375-07 - Keep Stage usable.** **Acceptance:** Fullscreen entry/exit/escape/focus work across themes and sizes. **Required verification:** Stage keyboard/touch tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
8. **UF-0375-08 - Measure frame and energy costs.** **Acceptance:** Active and hidden-tab visualisation stay within agreed named-device budget. **Required verification:** CPU/frame/memory profile. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.

## Verification and release boundaries

Compare baseline/candidate at the same route, viewport, theme, density, fixture, current player/revision and scroll. Test Light/Dark/System/forced-colours, 320–3840px, short landscape, 200/400% zoom, keyboard/touch/AT and reduced motion where relevant. Synthetic muted browser tests and screenshots alone do not prove real-audio quality, independent accessibility acceptance or user comprehension.

**Research:** [Existing UI/UX research](../research/ui-ux.md) · [Polish research](../research/ui-ux-polish.md) · [WCAG 2.2](https://www.w3.org/TR/WCAG22/) · [ARIA APG](https://www.w3.org/WAI/ARIA/apg/patterns/) · [NN/g progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) · [Microsoft human-AI](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/).

## Decision, implementation and independent verification

**Accepted** by requester on 2026-11-08; future supersession requires owner/date/rationale. Implementation Not started → In progress → Implemented only after exact source/test PR, SHA and item-specific evidence. Independent verification No → Yes only with separate reviewer/date/device/OS/browser/AT and relevant real user/audio/visual measurements. Update ADR, checklist, evidence ledger and JSON together; preserve older status histories.

[Roadmap](selecta-unified-finish-roadmap.md) · [192-task checklist](selecta-unified-finish-implementation-checklist.md) · [evidence](selecta-unified-finish-implementation-evidence.md) · [JSON](selecta-unified-finish-code-status.json) · [parity](selecta-unified-finish-overlap-and-parity.md) · [interaction contract](selecta-unified-finish-experience-contract.md) · [verification](selecta-unified-finish-verification-matrix.md) · [reconciliation](selecta-unified-finish-status-reconciliation.md) · [release](selecta-unified-finish-release-gates.md)
