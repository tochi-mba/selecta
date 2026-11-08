# ADR-0379 — My Mixes, current/draft identity and render-line hierarchy

- **Decision:** Accepted (requester approved all 24 UF ADRs on 2026-11-08; implementation and independent acceptance remain separate).
- **Implementation:** 5/8 Not started; 3/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Selecta Unified Experience Finish (UF); 2026-11-08; `main` `f17944530d54203e49baebdabc08a57ee9f40526`.
- **Priority / phase:** P1 / 05 Creation. **Owner:** Unassigned. **Implementing PR/SHA:** —.
- **Existing ADR owners:** ADR-0228, ADR-0255, ADR-0269, ADR-0286; unchanged.
- **Source touchpoints (review, not implementation):** `web/src/views/MyMixes.tsx`; `web/src/views/Drafts.tsx`; `web/src/views/CurrentMix.tsx`.

## Context and evidence boundary

The current app already contains major parts of this workflow. New UF tasks are additive integration and verification acceptance, not claims that existing features are missing. Nothing in this documentation PR changes app code, tests, server, audio or prior ADR histories. Current capabilities must be inspected again at the exact implementing SHA before any change or status advancement.

## Proposed decision

Existing draft storage, current mix and priority rendering need easily distinguishable identity and consequence.

## User outcome and interaction contract

Users understand what is actually available, which exact music object they are affecting and what action will occur. Every screen includes meaningful loading, empty, stale, failed, recovery, mobile, zoom, long-metadata and relevant audio-interruption states, tested rather than assumed.

**Preservation and trade-offs:** Preserve local original music, one authoritative player and deliberate Pause; exact recording/draft/mix/revision/occurrence/seam IDs; revision-guarded mutations and scoped Undo; explicit consent and atomic bridges; actual on-disk valid ready-only seams (K songs need K−1 edges); eight Studio lanes and 8–64-cell arrangement; truthful source/readiness; frozen-revision decodable FLAC; unbiased human listening. No accounts, SaaS, telemetry, remote audio upload or engine rewrite.

## Implementation checklist — 0/8 Implemented; 0/8 independently Verified

1. **UF-0379-01 — Differentiate current and saved drafts.** **Acceptance:** Prominent exact current/draft/revision status and action context. **Required verification:** Same-name draft comprehension test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
2. **UF-0379-02 — Clarify draft commands.** **Acceptance:** Edit/copy/prioritize/play/delete appear in safe hierarchy and exact scope. **Required verification:** Action order task study. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
3. **UF-0379-03 — Make queue causality visible.** **Acceptance:** Prioritized drafts and current rendering show actual order, not misleading parallel promise. **Required verification:** Job queue fixture. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
4. **UF-0379-04 — Show genuine render progression.** **Acceptance:** Queued, failed, blocked by storage and ready are separate recoverable states. **Required verification:** Interrupted job E2E. **Implementation:** In progress; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** #41 / `471bcdfb50e96188f2f3a7c252b0bedc33cbff06`; **Evidence/reviewer:** `web/src/state/readiness.ts` and readiness tests; queue/storage validation pending.
5. **UF-0379-05 — Restore recent work context.** **Acceptance:** Returning to a draft preserves scope without switching audio. **Required verification:** Reload/back/forward fixture. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
6. **UF-0379-06 — Protect swap and Undo.** **Acceptance:** Playback of draft communicates current/draft exchange and recovery. **Required verification:** Revision and Undo integration. **Implementation:** In progress; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** #41 / `7ebfff8fc12e5a98d0ac5fa06e92f4eaf12c243c`; **Evidence/reviewer:** Draft activation operation identity and replacement guards, App.tsx/App.test.tsx; lost-ack E2E pending; independent reviewer pending.
7. **UF-0379-07 — Keep large draft collections usable.** **Acceptance:** Duplicate titles, long names and many drafts scan without losing actions. **Required verification:** Scale and AT review. **Implementation:** In progress; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** #41 / `dd07cf13ec4833c603695a06dbefa2825d385dd4`; **Evidence/reviewer:** Progressive 40-draft rendering and stable actions, Drafts.tsx/Drafts.test.tsx; scale audit pending; independent reviewer pending.
8. **UF-0379-08 — Design empty My Mixes path.** **Acceptance:** No saved mixes gives one direct creation action instead of decorative dead end. **Required verification:** First-use walkthrough. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.

## Verification and release boundaries

Use matched baseline and candidate with same route/data/player/revision/scroll/theme/viewport, plus keyboard, touch, assisted technologies, 320–3840px, 200/400% zoom, short landscape, Light/Dark/System/forced-colours and reduced motion where meaningful. Real music and independent human accessibility/visual/usability evidence are mandatory where relevant: synthetic muted browser automation and candidate screenshots are not proof.

**Research:** [Existing UI/UX research](../research/ui-ux.md) · [Polish research](../research/ui-ux-polish.md) · [WCAG 2.2](https://www.w3.org/TR/WCAG22/) · [ARIA APG](https://www.w3.org/WAI/ARIA/apg/patterns/) · [NN/g progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) · [Microsoft human-AI](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/) · [web.dev Web Vitals](https://web.dev/articles/vitals).

## Decision, implementation and independent verification

Decision remains **Proposed** until named owner/date/rationale accepts/rejects/supersedes. Implementation Not started → In progress → Implemented needs exact matching source/test PR+SHA. Independent verification No → Yes needs separate reviewer/date/platform/device/AT and appropriate visual/human/performance/real-audio evidence. All four tracking representations must update together and existing histories remain untouched.

[Roadmap](selecta-unified-finish-roadmap.md) · [192-task checklist](selecta-unified-finish-implementation-checklist.md) · [evidence](selecta-unified-finish-implementation-evidence.md) · [JSON](selecta-unified-finish-code-status.json) · [parity](selecta-unified-finish-overlap-and-parity.md) · [interaction contract](selecta-unified-finish-experience-contract.md) · [verification](selecta-unified-finish-verification-matrix.md) · [reconciliation](selecta-unified-finish-status-reconciliation.md) · [release](selecta-unified-finish-release-gates.md)
