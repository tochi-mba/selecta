# ADR-0128 — Workspace as a calm, actionable operations center

- **Decision:** Proposed (requires named owner acceptance).
- **Implementation:** Not started (0/5 newly defined EX tasks).
- **Verified:** No (0/5 independent acceptance).
- **Proposed:** 2026-11-07. **Baseline:** `main` `6638ec2313ce53843adfaf363306f8e79c4c8c7e` after merged PR #29.
- **Priority / phase:** P2 / Operations.
- **Related:** ADR-0107, ADR-0064, not automatically superseded or verified.
- **Source touchpoints:** `web/src/views/Workshop.tsx`, `web/src/views/WorkshopPanels.tsx`, `web/src/ui/ActivityPanel.tsx`.

## Context and evidence limits

Workspace contains analysis, sources, storage, settings, learning and diagnostics. In a music experience, operations should be discoverable but should not look as important as listening or creating. This is a future design proposal; source-observed current functionality, CI and previous ADRs do not prove an implemented new experience or actual user acceptance.

## Decision proposal

- Make the first Workspace screen prioritize a few issues needing action and genuine current background work, rather than a wall of diagnostics.
- Group analysis, folders, storage, learning, preferences and diagnostics predictably and keep deep operations reachable.
- Use accurate queued/active/blocked/stale/failure states with specific actions instead of optimistic percentages.
- Defer raw diagnostics, while protecting local paths and avoiding remote tracking.
- Make Preferences available predictably without duplicating them on every music page.

## Alternatives and tradeoffs

A permanent diagnostics dashboard suits developers, not most listeners; hiding all job detail would harm trust. Provide quiet overview plus drill-down.

## Consequences, scope and failure modes

Do not conflate source watching with uploads or suggest remote telemetry. Background status cannot promise a time that the backend cannot support. Preserve all existing routes, data, local file safety, listening study integrity, explicit bridge consent, revisions/Undo, single-owner transport and frozen-revision FLAC. Neither desktop packaging nor SaaS migration nor unreviewed backend/audio changes are part of this programme.

## New implementation status per task

1. **EX-0128-01 — Prototype issue-first overview**. **Acceptance:** Users identify one operational blocker and solution. **Verification:** Uncoached recovery test. **Implementation: Not started; Verified: No.**
2. **EX-0128-02 — Preserve all job/source/storage operations**. **Acceptance:** Watch, scan, pause, budget and diagnostics accessible. **Verification:** Action parity/API contract. **Implementation: Not started; Verified: No.**
3. **EX-0128-03 — Audit truth of job state labels**. **Acceptance:** Blocked, paused, queued and failed not conflated. **Verification:** Fault and stale response fixtures. **Implementation: Not started; Verified: No.**
4. **EX-0128-04 — Specify privacy-safe diagnostics**. **Acceptance:** Local file paths not leaked or uploaded. **Verification:** Manual privacy and network review. **Implementation: Not started; Verified: No.**
5. **EX-0128-05 — Verify accessible layout**. **Acceptance:** Warnings and settings reachable at all widths. **Verification:** Both themes, 400% zoom and NVDA. **Implementation: Not started; Verified: No.**

## Independent verification

Review dark/light/system themes, empty/loading/stale/failed/partial states, 320–2560px widths, 200/400% zoom, reduced motion, keyboard/touch/NVDA, long/duplicate/RTL content and concurrent operations. Test actual audio when audible behavior is claimed. Do not mark new tasks done based on PR #29 without task-specific mapping. [WCAG 2.2](https://www.w3.org/TR/WCAG22/), [human-AI interaction research](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/) and [NN/g disclosure](https://www.nngroup.com/articles/progressive-disclosure/) inform patterns, not measured Selecta outcomes. [Checklist](selecta-experience-implementation-checklist.md) · [Evidence](selecta-experience-evidence.md) · [Historical status](selecta-experience-status-reconciliation.md).
