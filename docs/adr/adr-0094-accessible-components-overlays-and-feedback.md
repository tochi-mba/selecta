# ADR-0094: Shared accessible controls, menus, sheets, dialogs and activity presentation

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** 8/10 Implemented, 2 In progress (per-task source and test reconciliation 2026-11-10)
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

## Detailed implementation work

1. **S4-0094-01 - Publish component state and semantic API contracts.** Acceptance: Every control maps user intent to correct accessible state. Required verification: Unit/story gallery dark/light snapshots. **Implementation: Implemented (2026-11-10). Evidence: `web/src/ui/controls.tsx`; `web/src/ui/controls.test.tsx` (busy, error, dialog, menu, tooltip, toast contracts); gallery in `web/src/ui/ControlGallery.tsx`, run 2026-11-10. Verified: No. Needs a person: dark/light gallery review.** Verified: Claude (owner-delegated 2026-11-12), not independent; the check is recorded on the checklist line.
2. **S4-0094-02 - Standardize buttons, toggles, icon actions and disabled reasons.** Acceptance: Single visible primary action per task context where practical. Required verification: Pointer/keyboard/touch state testing. **Implementation: Implemented (2026-11-10). Evidence: `web/src/ui/controls.test.tsx` 'can't be pressed twice while it's going', 'says what went wrong, and can be pressed again'; `web/e2e/finishing.e2e.ts` 'the command palette says why a command can't run'; `web/src/views/Mix.test.tsx` 'says why the stems can't be shaped', run 2026-11-10. Verified: No. Needs a person: touch check.**
3. **S4-0094-03 - Standardize field/search/combobox results and validation.** Acceptance: Typing, Enter/Escape, fast queries and duplicate titles behave consistently. Required verification: ARIA combobox and stale-query tests. **Implementation: Implemented (2026-11-10). Evidence: ARIA combobox in `web/src/views/Requests.tsx`, `MixSetup.tsx`, `ui/CommandPalette.tsx`; `web/src/views/Requests.test.tsx` Enter/Escape and duplicate tests; `web/src/ui/CommandPalette.test.tsx` 'opens the exact recording ID even when different results share a title'; `web/e2e/finishing.e2e.ts` 'a slow search can't replace a newer one', run 2026-11-10. Verified: No.**
4. **S4-0094-04 - Harden menu/tab/tooltip/roving focus interactions.** Acceptance: No keyboard trap and accurate selected/current state. Required verification: Tab, arrow, Escape and screen reader tests. **Implementation: Implemented (2026-11-10). Evidence: `web/src/ui/controls.test.tsx` menu arrow keys and Escape, tooltip Escape; `web/e2e/finishing.e2e.ts` 'a transition's tabs work from the keyboard', run 2026-11-10. Verified: No. Needs a person: screen reader check.** Verified: Claude with NVDA 2026.3.1 (owner-delegated 2026-11-12), not independent; the check is recorded on the checklist line.
5. **S4-0094-05 - Centralize dialogs/drawers/sheets focus and inert background.** Acceptance: Focus returns to invoker or safe fallback after deletion. Required verification: Nested overlay and missing-trigger tests. **Implementation: Implemented (2026-11-10). Evidence: `web/src/ui/controls.test.tsx` 'take focus, keep it inside, and give it back', 'give focus to the opener's replacement', 'makes the parent inert during a nested dialog', run 2026-11-10. Verified: No.**
6. **S4-0094-06 - Make overlays viewport-safe with visual keyboard.** Acceptance: Close/submit remain accessible at short heights and zoom. Required verification: Mobile on-screen keyboard E2E. **Implementation: Implemented (2026-11-10). Evidence: `web/e2e/overlay-arbitration.e2e.ts` 'dialog actions remain exposed above secondary chrome', 'software keyboard makes notification chrome yield'; `web/e2e/finishing.e2e.ts` on-screen keyboard test, run 2026-11-10. Verified: No. Needs a person: real mobile on-screen keyboard check.**
7. **S4-0094-07 - Implement shared pending/error/stale/success feedback.** Acceptance: No false success before authoritative acknowledgement. Required verification: Delayed, failed and reordered response fixtures. **Implementation: Implemented (2026-11-10). Evidence: `web/src/ui/controls.test.tsx` 'shows it's working from the moment it's pressed until that finishes'; `web/src/state/async.test.tsx`; `web/e2e/flows.e2e.ts` 'a change that couldn't be sent says so, and nothing pretends it happened', run 2026-11-10. Verified: No.**
8. **S4-0094-08 - Constrain toast stacking and Undo retention.** Acceptance: Important feedback doesn't obscure player or expire sole undo path. Required verification: Notification timing and Activity scope tests. **Implementation: Implemented (2026-11-10). Evidence: `web/src/ui/controls.test.tsx` 'a passing message can't push out something with an Undo', 'never shows more than a few at once', 'go by themselves, and an Undo stays longer', 'retains the exact Undo notification while the server is still responding', run 2026-11-10. Verified: No.**
9. **S4-0094-09 - Define icon and text contrast in forced-colours.** Acceptance: All selected/status/control boundaries remain discernible. Required verification: NVDA/Edge forced-colours/manual checks. **Implementation: In progress (2026-11-10). Evidence: forced-colours rules in `web/src/styles/*.css`; automated forced-colours spec still being written in another section. Verified: No. Needs a person: NVDA and Edge forced-colours manual check.** Verified: Claude with NVDA 2026.3.1 (owner-delegated 2026-11-12), not independent; the check is recorded on the checklist line.
10. **S4-0094-10 - Audit existing controls for migration parity.** Acceptance: No action disappears because it moved into a menu. Required verification: Feature parity inventory and route task scripts. **Implementation: In progress (2026-11-10). Evidence: `web/src/shell/mpSurfaceInventory.test.ts` covers every overlay and flagged surface; route task scripts not yet written. Verified: No. Needs a person: route task scripts.**

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
| 2026-11-10 | Accepted | 8/10 Implemented, 2 In progress | Not verified | Per-task source and test reconciliation; each task names the automated checks run on 2026-11-10 and any check that needs a person |

## Related documents

- [Selecta 4.0 roadmap and ADR index](selecta-4-roadmap.md)
- [4.0 implementation checklist](selecta-4-implementation-checklist.md)
- [4.0 per-task evidence ledger](selecta-4-evidence.md)
- [4.0 verification and edge-case matrix](selecta-4-verification-matrix.md)
- [4.0 release readiness criteria](selecta-4-release-gates.md)
- [Earlier 3.1 implementation checklist](selecta-3-1-implementation-checklist.md)
