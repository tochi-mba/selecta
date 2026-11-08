# ADR-0094: Shared accessible controls, menus, sheets, dialogs and activity presentation

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** Not started (0/10 implemented)
- **Verification status:** Not verified (0/10)
- **Documentation status:** Drafted, documentation-only Selecta 4.0 proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 4.0 complete UI/UX overhaul
- **Phase:** 1 Foundations / 2 Shell
- **Extends, does not automatically supersede:** ADR-0004, ADR-0051, ADR-0080, ADR-0087
- **Source surfaces to reconcile:** `web/src/ui/controls.tsx`; `web/src/ui/primitives.tsx`; `web/src/ui/toasts.tsx`; `web/src/ui/ActivityPanel.tsx`
- **Tasks:** S4-0094-01 through S4-0094-10 in [the Selecta 4.0 checklist](selecta-4-implementation-checklist.md)
- **Baseline:** `main` `9b663f9f10212619f27ce67ce82f602347065cbd` (after merged PRs #25 and #26)

## Context and evidence boundary

Large surfaces become inconsistent when each feature invents button states, loading labels, focus trapping, menus, form validation and Undo notification design.

This is a **proposal**. Source inspection and earlier planning documents establish current contracts and candidate risks; they do not establish verified visual quality, human task success, real audio quality, screen-reader usability or shipped implementation of this ADR. Earlier programme status headings can be stale and are not inherited as verified work.

## Proposed decision

Refine shared primitives rather than blindly migrating to a new UI library. Document state/semantic contracts for buttons, fields, search, tabs, menus, drawers, sheets, dialogs, progress, tooltips and activity.

## Experience, frontend and interaction specification

- Default/hover/focus/pressed/selected/working/disabled/success/error/stale/reduced-motion documented for each primitive.
- Dialog is for short decisions, sheet for object detail, drawer for global activity, and workspace overlay for Studio.
- No essential function depends on hover; icons require discernible names and destructive actions are clearly separated.
- Toast is temporary feedback, Activity is scoped recent actions, durable job progress comes from authoritative stores.

## Detailed implementation work - all Not started

1. **S4-0094-01 - Publish component state and semantic API contracts.** Acceptance: Every control maps user intent to correct accessible state. Required verification: Unit/story gallery dark/light snapshots. **Implementation: Not started; Verified: No.**
2. **S4-0094-02 - Standardize buttons, toggles, icon actions and disabled reasons.** Acceptance: Single visible primary action per task context where practical. Required verification: Pointer/keyboard/touch state testing. **Implementation: Not started; Verified: No.**
3. **S4-0094-03 - Standardize field/search/combobox results and validation.** Acceptance: Typing, Enter/Escape, fast queries and duplicate titles behave consistently. Required verification: ARIA combobox and stale-query tests. **Implementation: Not started; Verified: No.**
4. **S4-0094-04 - Harden menu/tab/tooltip/roving focus interactions.** Acceptance: No keyboard trap and accurate selected/current state. Required verification: Tab, arrow, Escape and screen reader tests. **Implementation: Not started; Verified: No.**
5. **S4-0094-05 - Centralize dialogs/drawers/sheets focus and inert background.** Acceptance: Focus returns to invoker or safe fallback after deletion. Required verification: Nested overlay and missing-trigger tests. **Implementation: Not started; Verified: No.**
6. **S4-0094-06 - Make overlays viewport-safe with visual keyboard.** Acceptance: Close/submit remain accessible at short heights and zoom. Required verification: Mobile on-screen keyboard E2E. **Implementation: Not started; Verified: No.**
7. **S4-0094-07 - Implement shared pending/error/stale/success feedback.** Acceptance: No false success before authoritative acknowledgement. Required verification: Delayed, failed and reordered response fixtures. **Implementation: Not started; Verified: No.**
8. **S4-0094-08 - Constrain toast stacking and Undo retention.** Acceptance: Important feedback doesn't obscure player or expire sole undo path. Required verification: Notification timing and Activity scope tests. **Implementation: Not started; Verified: No.**
9. **S4-0094-09 - Define icon and text contrast in forced-colours.** Acceptance: All selected/status/control boundaries remain discernible. Required verification: NVDA/Edge forced-colours/manual checks. **Implementation: Not started; Verified: No.**
10. **S4-0094-10 - Audit existing controls for migration parity.** Acceptance: No action disappears because it moved into a menu. Required verification: Feature parity inventory and route task scripts. **Implementation: Not started; Verified: No.**

## Required negative cases and regression strategy

- Nested menu inside modal: Escape closes only uppermost surface; focus restores correctly.
- Screen reader should not announce every progress percentage.
- Closing dirty Studio must not falsely promise persisted recovery.
- Exercise light, dark and system themes; empty, loading, partial, ready, stale, failed, offline and recovering states where applicable.
- Exercise 320/375/390/430/768/1024/1280/1440/1920 CSS-pixel widths, short viewports, 200/400% zoom, keyboard, touch, reduced motion, realistic long/missing/duplicate/Unicode/RTL metadata.
- Maintain existing frontend, API, audio and Python assertions; changed markup may require selector updates but never weakened behavioural contracts.

## Preservation and dependencies

Retain the [existing Selecta 3.0 invariants INV-01–INV-20](selecta-3-roadmap.md) and [3.1 preservation contract](selecta-3-1-roadmap.md): no original-file mutation; local-first security and LRCLIB disclosure; no loss of current/draft state, preferences, corrections or ratings; stable old routes; one audio owner; exact request consent and atomic join; truthful requested-versus-rendered state; revision-pinned decodable FLAC; full keyboard alternatives and regression assertions. No backend, schema, audio-engine or dependency rewrite is authorized by this ADR. See [4.0 parity matrix](selecta-4-feature-parity.md) and [verification matrix](selecta-4-verification-matrix.md).

## Alternatives, risks and trade-offs

Small shared primitives keep the bundle and local-first behaviour controlled, but need rigorous accessibility ownership.

## Evidence and advancement rules

An owner must separately **Accept** this decision before it becomes policy. Each implementing PR must name the S4-0094 task IDs, actual commit(s), changed files, pre-existing regression tests, new negative/concurrency cases, theme/viewport screenshots and relevant human/audible/AT evidence. **Implemented** requires merged code and applicable automated checks; **Verified** additionally requires independent real acceptance relevant to the change. An unchecked checkbox means not Verified. A docs merge does not advance these statuses.

## Status history

| Date | Decision | Implementation | Verification | Evidence |
|---|---|---|---|---|
| 2026-11-07 | Proposed | Not started | Not verified | Documentation-only specification; no runtime, test or UI changes |
| 2026-11-08 | Accepted | Not started | Not verified | Owner accepted all proposed ADRs ([#37](https://github.com/tochi-mba/selecta/pull/37)) |

## Related documents

- [Selecta 4.0 roadmap and ADR index](selecta-4-roadmap.md)
- [4.0 implementation checklist](selecta-4-implementation-checklist.md)
- [4.0 per-task evidence ledger](selecta-4-evidence.md)
- [4.0 verification and edge-case matrix](selecta-4-verification-matrix.md)
- [4.0 release readiness criteria](selecta-4-release-gates.md)
- [Earlier 3.1 implementation checklist](selecta-3-1-implementation-checklist.md)
