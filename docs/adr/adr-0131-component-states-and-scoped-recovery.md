# ADR-0131 — Shared component contracts, honest async states and scoped recovery

- **Decision:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation:** Not started (0/5 new EX tasks).
- **Verification:** No (0/5 tasks independently Verified).
- **Programme/date/baseline:** Experience-first UI/UX; 2026-11-07; `main` `6638ec2313ce53843adfaf363306f8e79c4c8c7e`, after merged PR #29.
- **Priority / phase:** P0 / Foundation.
- **Related earlier ADRs:** ADR-0094, ADR-0095, ADR-0080. Historical decisions are preserved, not automatically superseded.
- **Source touchpoints:** `web/src/ui/controls.tsx`, `web/src/ui/ActivityPanel.tsx`, `web/src/ui/Skeleton.tsx`, `web/src/state/async.ts`.

## Context and limits of current evidence

Reusable Action, Status, overlays, Skeleton, Activity and Undo exist and provide a solid base. Their visual and semantic promises must be tested against slow servers, multiple tabs and failure races, not just happy-path snapshots. Source observations and earlier planning are not proof of user task outcomes, accessible operation or current visual quality.

## Proposed decision

- Define consistent idle/hover/focus/pressed/selected/pending/disabled/success/failed/blocked/recovering states with readable copy and semantic roles.
- Provide immediate truthful feedback without treating queued work as complete or letting stale requests overwrite newer state.
- Use content-shaped skeleton geometry for real loading, separate empty states from unavailable/error states, and never invent percentages.
- Make Undo accessible in the context of an edit and in Activity with exact scope and availability, even after transient toasts disappear.
- Guarantee dialog/drawer/menu focus entry, confinement, nested Escape, restoration and correct live-region restraint.

## Alternatives and rationale

Bespoke widgets are flexible but inconsistent; generic single-spinner behavior discards context. Keep shared semantics plus domain-specific state copy.

## Consequences and boundaries

Undo cannot be described as durable after reload where underlying server guarantees do not support it. Accessibility tests must include manual NVDA and keyboard. Preserve old routes, preferences, original media, current/draft/revision identity, single audio owner, Undo, consented atomic bridges, full Studio control, blind study integrity and correct FLAC. No near-term desktop packaging or SaaS migration, no silent backend/audio/API changes or remote telemetry.

## Implementation tasks (all Not started; Verified: No)

1. **EX-0131-01 — Write interaction state matrix**. Acceptance: Every shared component state has visuals, copy and ARIA meaning. Required verification: Gallery plus automated/manual check. **Implementation: Not started; Verified: No.**
2. **EX-0131-02 — Validate overlay and focus behavior**. Acceptance: Nested overlays trap and restore focus correctly. Required verification: WAI-ARIA APG, keyboard and NVDA. **Implementation: Not started; Verified: No.**
3. **EX-0131-03 — Protect async consistency**. Acceptance: Old/failed responses never overwrite current revision. Required verification: Race, two-tab and slow-network E2E. **Implementation: Not started; Verified: No.**
4. **EX-0131-04 — Improve loading/empty/error feedback**. Acceptance: No fake success, unreachable retry or loading-as-empty. Required verification: Deterministic visual fixtures. **Implementation: Not started; Verified: No.**
5. **EX-0131-05 — Preserve scoped Undo and recovery**. Acceptance: Recovery action remains discoverable and exact. Required verification: Toast burst, stale mix and failure tests. **Implementation: Not started; Verified: No.**

## Verification and sources

Test dark/light/system themes, long/RTL metadata, 320–2560px viewports and 200/400% zoom, keyboard/touch/NVDA, reduced motion and async failure/race states. Real media and export must be heard/decoded as applicable. [WCAG 2.2](https://www.w3.org/TR/WCAG22/) · [WAI-ARIA APG](https://www.w3.org/WAI/ARIA/apg/patterns/grid/) · [Playwright visual testing](https://playwright.dev/docs/test-snapshots) · [web.dev INP](https://web.dev/articles/inp). These sources inform design methods, not reported Selecta test results. See [roadmap](selecta-experience-roadmap.md), [checklist](selecta-experience-implementation-checklist.md), [evidence](selecta-experience-evidence.md), [historical reconciliation](selecta-experience-status-reconciliation.md).
