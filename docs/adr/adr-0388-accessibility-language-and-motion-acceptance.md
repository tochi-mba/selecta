# ADR-0388 - WCAG accessibility, plain-language status and sensory safety

- **Decision:** Accepted (requester approved all 24 UF ADRs on 2026-11-08; implementation and independent acceptance remain separate).
- **Implementation:** 6/8 Not started; 0/8 In progress; 2/8 Implemented (1/8 ticked in the checklist with automated evidence, 2026-11-11).
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Selecta Unified Experience Finish (UF); 2026-11-08; `main` `f17944530d54203e49baebdabc08a57ee9f40526`.
- **Priority / phase:** P0 / 08 Verification. **Owner:** Unassigned. **Implementing PR/SHA:** -.
- **Existing ADR owners:** ADR-0202, ADR-0204, ADR-0205, ADR-0233, ADR-0234, ADR-0257, ADR-0298, ADR-0364; unchanged.
- **Source touchpoints (review, not implementation):** `web/src/ui/primitives.tsx`; `web/src/ui/controls.tsx`; `web/src/ui/useReducedMotion.ts`.

## Context and evidence boundary

The current app already contains major parts of this workflow. New UF tasks are additive integration and verification acceptance, not claims that existing features are missing. Nothing in this documentation PR changes app code, tests, server, audio or prior ADR histories. Current capabilities must be inspected again at the exact implementing SHA before any change or status advancement.

## Proposed decision

Automated ARIA and motion tests do not constitute independent WCAG 2.2 AA or assistive-technology acceptance.

## User outcome and interaction contract

Users understand what is actually available, which exact music object they are affecting and what action will occur. Every screen includes meaningful loading, empty, stale, failed, recovery, mobile, zoom, long-metadata and relevant audio-interruption states, tested rather than assumed.

**Preservation and trade-offs:** Preserve local original music, one authoritative player and deliberate Pause; exact recording/draft/mix/revision/occurrence/seam IDs; revision-guarded mutations and scoped Undo; explicit consent and atomic bridges; actual on-disk valid ready-only seams (K songs need K−1 edges); eight Studio lanes and 8–64-cell arrangement; truthful source/readiness; frozen-revision decodable FLAC; unbiased human listening. No accounts, SaaS, telemetry, remote audio upload or engine rewrite.

## Implementation checklist - 2/8 Implemented; 0/8 independently Verified

1. **UF-0388-01 - Audit landmarks and accessible names.** **Acceptance:** All routes contain correct headings, labels and keyboard order. **Required verification:** Accessibility tree and human review. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-11, coordinator commits); **Evidence:** automatic WCAG 2.2 AA checks in web/e2e/pages.e2e.ts are queued against a current build; Needs a person: human review of headings, labels and keyboard order on every route (2026-11-11); **Evidence/reviewer:** -.
2. **UF-0388-02 - Validate component keyboard patterns.** **Acceptance:** Menus, dialogs, tabs, comboboxes and grid follow relevant APG patterns. **Required verification:** Physical keyboard/NVDA/VoiceOver. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-11, coordinator commits); **Evidence:** Needs a person: physical keyboard, NVDA and VoiceOver check of menus, dialogs, tabs, comboboxes and the Studio grid against the APG patterns (2026-11-11); **Evidence/reviewer:** -.
3. **UF-0388-03 - Test applicable WCAG 2.2 AA.** **Acceptance:** Contrast, focus, reflow, target size exceptions and drag alternatives verified. **Required verification:** Independent criteria checklist. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-11, coordinator commits); **Evidence:** automatic WCAG 2.2 AA checks in web/e2e/pages.e2e.ts are queued against a current build, and are only part of it; Needs a person: independent WCAG 2.2 AA criteria checklist (2026-11-11); **Evidence/reviewer:** -.
4. **UF-0388-04 - Verify non-colour state language.** **Acceptance:** Planned/ready/failed/selected survive forced colours, grayscale and AT. **Required verification:** Screenshots and spoken output. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-11, coordinator commits); **Evidence:** Needs a person: forced-colours and grayscale screenshots, and spoken output, for planned, ready, failed and selected states (2026-11-11); **Evidence/reviewer:** -.
5. **UF-0388-05 - Unify musical terminology.** **Acceptance:** Ready, analysed, proposed, queued, saved and playing are consistent and explainable. **Required verification:** Copy audit and task study. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-11, coordinator commits); **Evidence:** Needs a person: copy audit and task study of ready, analysed, proposed, queued, saved and playing (2026-11-11); **Evidence/reviewer:** -.
6. **UF-0388-06 - Enforce motion preference hierarchy.** **Acceptance:** OS reduced-motion overrides expressive user setting and visual effects. **Required verification:** Motion tests. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-11, coordinator commits); **Evidence:** web/src/views/ufOperations.test.tsx 'turns page animations off under reduced motion even when Expressive is chosen', 'zeroes every motion token under reduced motion whatever motion the app has set' (4/4 passed); web/src/shell/sceneTransition.test.ts 'stays instant under reduced motion, Still or Subtle motion, or with the flag off' (5/5 passed); web/src/styles/tokens.css reduced-motion block overrides :root[data-motion] (2026-11-11); **Evidence/reviewer:** -.
7. **UF-0388-07 - Prevent announcement overload.** **Acceptance:** Long Lucy streams and background jobs do not spam live regions. **Required verification:** Assistive long-session review. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-11, coordinator commits); **Evidence:** Needs a person: long assistive-technology session with Lucy streaming and background jobs running (2026-11-11); **Evidence/reviewer:** -.
8. **UF-0388-08 - Require real AT journey success.** **Acceptance:** Critical first mix, Library, Lucy, editor and Studio tasks have reviewer/device evidence. **Required verification:** Independent completion log. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-11, coordinator commits); **Evidence:** Needs a person: reviewer and device evidence for first mix, Library, Lucy, editor and Studio with assistive technology (2026-11-11); **Evidence/reviewer:** -.

## Verification and release boundaries

Use matched baseline and candidate with same route/data/player/revision/scroll/theme/viewport, plus keyboard, touch, assisted technologies, 320–3840px, 200/400% zoom, short landscape, Light/Dark/System/forced-colours and reduced motion where meaningful. Real music and independent human accessibility/visual/usability evidence are mandatory where relevant: synthetic muted browser automation and candidate screenshots are not proof.

**Research:** [Existing UI/UX research](../research/ui-ux.md) · [Polish research](../research/ui-ux-polish.md) · [WCAG 2.2](https://www.w3.org/TR/WCAG22/) · [ARIA APG](https://www.w3.org/WAI/ARIA/apg/patterns/) · [NN/g progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) · [Microsoft human-AI](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/) · [web.dev Web Vitals](https://web.dev/articles/vitals).

## Decision, implementation and independent verification

Decision remains **Proposed** until named owner/date/rationale accepts/rejects/supersedes. Implementation Not started → In progress → Implemented needs exact matching source/test PR+SHA. Independent verification No → Yes needs separate reviewer/date/platform/device/AT and appropriate visual/human/performance/real-audio evidence. All four tracking representations must update together and existing histories remain untouched.

[Roadmap](selecta-unified-finish-roadmap.md) · [192-task checklist](selecta-unified-finish-implementation-checklist.md) · [evidence](selecta-unified-finish-implementation-evidence.md) · [JSON](selecta-unified-finish-code-status.json) · [parity](selecta-unified-finish-overlap-and-parity.md) · [interaction contract](selecta-unified-finish-experience-contract.md) · [verification](selecta-unified-finish-verification-matrix.md) · [reconciliation](selecta-unified-finish-status-reconciliation.md) · [release](selecta-unified-finish-release-gates.md)
