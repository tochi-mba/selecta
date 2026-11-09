# ADR-0380 - Editor sequence, Story/Arrange parity and exact seam identity

- **Decision:** Accepted (requester approved all 24 UF ADRs on 2026-11-08; implementation and independent acceptance remain separate).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Selecta Unified Experience Finish (UF); 2026-11-08; `main` `f17944530d54203e49baebdabc08a57ee9f40526`.
- **Priority / phase:** P1 / 06 Advanced creation. **Owner:** Unassigned. **Implementing PR/SHA:** -.
- **Existing ADR owners:** ADR-0219, ADR-0220, ADR-0222, ADR-0250, ADR-0287; unchanged.
- **Source touchpoints (review, not implementation):** `web/src/views/Mix.tsx`; `web/src/views/EditorRows.tsx`; `web/src/views/EditorStory.tsx`.

## Context and evidence boundary

The current app already contains major parts of this workflow. New UF tasks are additive integration and verification acceptance, not claims that existing features are missing. Nothing in this documentation PR changes app code, tests, server, audio or prior ADR histories. Current capabilities must be inspected again at the exact implementing SHA before any change or status advancement.

## Proposed decision

Song occurrences, directed seam edges and revision-safe editing must remain exact across different visual representations.

## User outcome and interaction contract

Users understand what is actually available, which exact music object they are affecting and what action will occur. Every screen includes meaningful loading, empty, stale, failed, recovery, mobile, zoom, long-metadata and relevant audio-interruption states, tested rather than assumed.

**Preservation and trade-offs:** Preserve local original music, one authoritative player and deliberate Pause; exact recording/draft/mix/revision/occurrence/seam IDs; revision-guarded mutations and scoped Undo; explicit consent and atomic bridges; actual on-disk valid ready-only seams (K songs need K−1 edges); eight Studio lanes and 8–64-cell arrangement; truthful source/readiness; frozen-revision decodable FLAC; unbiased human listening. No accounts, SaaS, telemetry, remote audio upload or engine rewrite.

## Implementation checklist - 0/8 Implemented; 0/8 independently Verified

1. **UF-0380-01 - Keep mode semantics identical.** **Acceptance:** Story and Arrange show same ordered occurrences and seam state. **Required verification:** Mode-toggle equality E2E. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
2. **UF-0380-02 - Distinguish song from seam focus.** **Acceptance:** Selection labels and visuals identify exact object even when a song repeats. **Required verification:** Repeated-song and AT fixture. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
3. **UF-0380-03 - Provide reorder alternatives.** **Acceptance:** Pointer drag, touch and keyboard movement preserve focus and reversibility. **Required verification:** Keyboard/pointer reorder test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
4. **UF-0380-04 - Expose current/draft scope.** **Acceptance:** Editor heading and buttons identify revision being modified. **Required verification:** Multiple-draft scope regression. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
5. **UF-0380-05 - Distinguish energy intent from result.** **Acceptance:** Requested arc and achieved measurements have clear source-backed labels. **Required verification:** Energy state fixture. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
6. **UF-0380-06 - Keep inspector in reach.** **Acceptance:** Desktop pane and mobile sheet never cover selection or navigation controls. **Required verification:** 320px/400%/short viewport geometry. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
7. **UF-0380-07 - Show undo and save provenance.** **Acceptance:** Each mutation communicates scope and remaining recovery. **Required verification:** Revision-guard/undo test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
8. **UF-0380-08 - Measure lengthy mix editing.** **Acceptance:** 40+ song sequence remains fast and navigable at realistic widths. **Required verification:** Named-device profile. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.

## Verification and release boundaries

Use matched baseline and candidate with same route/data/player/revision/scroll/theme/viewport, plus keyboard, touch, assisted technologies, 320–3840px, 200/400% zoom, short landscape, Light/Dark/System/forced-colours and reduced motion where meaningful. Real music and independent human accessibility/visual/usability evidence are mandatory where relevant: synthetic muted browser automation and candidate screenshots are not proof.

**Research:** [Existing UI/UX research](../research/ui-ux.md) · [Polish research](../research/ui-ux-polish.md) · [WCAG 2.2](https://www.w3.org/TR/WCAG22/) · [ARIA APG](https://www.w3.org/WAI/ARIA/apg/patterns/) · [NN/g progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) · [Microsoft human-AI](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/) · [web.dev Web Vitals](https://web.dev/articles/vitals).

## Decision, implementation and independent verification

Decision remains **Proposed** until named owner/date/rationale accepts/rejects/supersedes. Implementation Not started → In progress → Implemented needs exact matching source/test PR+SHA. Independent verification No → Yes needs separate reviewer/date/platform/device/AT and appropriate visual/human/performance/real-audio evidence. All four tracking representations must update together and existing histories remain untouched.

[Roadmap](selecta-unified-finish-roadmap.md) · [192-task checklist](selecta-unified-finish-implementation-checklist.md) · [evidence](selecta-unified-finish-implementation-evidence.md) · [JSON](selecta-unified-finish-code-status.json) · [parity](selecta-unified-finish-overlap-and-parity.md) · [interaction contract](selecta-unified-finish-experience-contract.md) · [verification](selecta-unified-finish-verification-matrix.md) · [reconciliation](selecta-unified-finish-status-reconciliation.md) · [release](selecta-unified-finish-release-gates.md)
