# ADR-0385 - Workspace hierarchy, diagnostics, sources, storage and local backups

- **Decision:** Accepted (requester approved all 24 UF ADRs on 2026-11-08; implementation and independent acceptance remain separate).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Selecta Unified Experience Finish (UF); 2026-11-08; `main` `f17944530d54203e49baebdabc08a57ee9f40526`.
- **Priority / phase:** P1 / 07 Supporting. **Owner:** Unassigned. **Implementing PR/SHA:** -.
- **Existing ADR owners:** ADR-0230, ADR-0253, ADR-0263, ADR-0293; unchanged.
- **Source touchpoints (review, not implementation):** `web/src/views/Workshop.tsx`; `web/src/views/WorkshopPanels.tsx`; `web/src/views/LocalBackup.tsx`.

## Context and evidence boundary

The current app already contains major parts of this workflow. New UF tasks are additive integration and verification acceptance, not claims that existing features are missing. Nothing in this documentation PR changes app code, tests, server, audio or prior ADR histories. Current capabilities must be inspected again at the exact implementing SHA before any change or status advancement.

## Proposed decision

Existing local operations need action-first hierarchy, honest background work and safe data recovery.

## User outcome and interaction contract

Users understand what is actually available, which exact music object they are affecting and what action will occur. Every screen includes meaningful loading, empty, stale, failed, recovery, mobile, zoom, long-metadata and relevant audio-interruption states, tested rather than assumed.

**Preservation and trade-offs:** Preserve local original music, one authoritative player and deliberate Pause; exact recording/draft/mix/revision/occurrence/seam IDs; revision-guarded mutations and scoped Undo; explicit consent and atomic bridges; actual on-disk valid ready-only seams (K songs need K−1 edges); eight Studio lanes and 8–64-cell arrangement; truthful source/readiness; frozen-revision decodable FLAC; unbiased human listening. No accounts, SaaS, telemetry, remote audio upload or engine rewrite.

## Implementation checklist - 0/8 Implemented; 0/8 independently Verified

1. **UF-0385-01 - Prioritise actionable issues.** **Acceptance:** Overview separates problems requiring action from healthy job counts. **Required verification:** Task triage review. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
2. **UF-0385-02 - Explain analysis lifecycle.** **Acceptance:** Queued, running, paused and resumed state reflects true server jobs. **Required verification:** Interrupt/resume test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
3. **UF-0385-03 - Protect source-folder handling.** **Acceptance:** Disappearing or re-linked drives do not imply mass deletion. **Required verification:** Folder missing/return fixture. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
4. **UF-0385-04 - Clarify storage budget.** **Acceptance:** Disposable cache, priority stems and durable originals are visibly different. **Required verification:** Eviction threshold test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
5. **UF-0385-05 - Make diagnostics interpretable.** **Acceptance:** Plain explanation and deeper detail when asked support different skill levels. **Required verification:** Comprehension task. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
6. **UF-0385-06 - Show backup data scope.** **Acceptance:** Local archive of app data is not misrepresented as containing original music. **Required verification:** Archive/task inspection. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
7. **UF-0385-07 - Guard staged restore.** **Acceptance:** Preview replacement/skips, restart and rollback before confirming. **Required verification:** Injected failure/restore test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.
8. **UF-0385-08 - Keep interface settings isolated.** **Acceptance:** Theme, density and motion changes affect no stored mix/audio state. **Required verification:** Preference regression. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** -.

## Verification and release boundaries

Use matched baseline and candidate with same route/data/player/revision/scroll/theme/viewport, plus keyboard, touch, assisted technologies, 320–3840px, 200/400% zoom, short landscape, Light/Dark/System/forced-colours and reduced motion where meaningful. Real music and independent human accessibility/visual/usability evidence are mandatory where relevant: synthetic muted browser automation and candidate screenshots are not proof.

**Research:** [Existing UI/UX research](../research/ui-ux.md) · [Polish research](../research/ui-ux-polish.md) · [WCAG 2.2](https://www.w3.org/TR/WCAG22/) · [ARIA APG](https://www.w3.org/WAI/ARIA/apg/patterns/) · [NN/g progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) · [Microsoft human-AI](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/) · [web.dev Web Vitals](https://web.dev/articles/vitals).

## Decision, implementation and independent verification

Decision remains **Proposed** until named owner/date/rationale accepts/rejects/supersedes. Implementation Not started → In progress → Implemented needs exact matching source/test PR+SHA. Independent verification No → Yes needs separate reviewer/date/platform/device/AT and appropriate visual/human/performance/real-audio evidence. All four tracking representations must update together and existing histories remain untouched.

[Roadmap](selecta-unified-finish-roadmap.md) · [192-task checklist](selecta-unified-finish-implementation-checklist.md) · [evidence](selecta-unified-finish-implementation-evidence.md) · [JSON](selecta-unified-finish-code-status.json) · [parity](selecta-unified-finish-overlap-and-parity.md) · [interaction contract](selecta-unified-finish-experience-contract.md) · [verification](selecta-unified-finish-verification-matrix.md) · [reconciliation](selecta-unified-finish-status-reconciliation.md) · [release](selecta-unified-finish-release-gates.md)
