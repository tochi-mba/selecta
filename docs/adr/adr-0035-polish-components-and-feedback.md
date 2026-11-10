# ADR-0035: Complete shared control states, overlays and recoverable feedback

- **Decision status:** Accepted (owner requested implementation in PR #23)
- **Implementation status:** In progress: 8/11 tasks Implemented with evidence on 2026-11-10 (P0021, P0023-P0026, P0028-P0030); P0022 measurement not green; P0027 and P0031 need a person. See [the polish evidence ledger](polish-implementation-evidence.md).
- **Proposed:** 2026-11-06
- **Programme:** UI/UX polish
- **Delivery phase:** 2 - Shared components and loading
- **Extends:** [ADR-0004](adr-0004-interaction-primitives-and-notifications.md), [ADR-0023](adr-0023-accessibility.md), [ADR-0028](adr-0028-recovery-and-multitab.md); does not silently supersede their behavioural contracts.
- **Dependencies:** ADR-0033 inventory; ADR-0034 visual roles; ADR-0044 language and motion.
- **Checklist:** P0021–P0031 in [polish implementation checklist](polish-implementation-checklist.md).

> The owner requested implementation in PR #23 after the planning review. Functionality is written first; verification follows. Checkboxes require actual evidence, including any remaining human checks.

## Context and evidence boundary

Action, Dialog, Drawer, Menu, Tooltip, Status and Toaster already exist. The toast queue limits visible entries to three and can discard an older Undo when all entries are actionable. SeamInspector exposes tab roles without a complete roving-focus/tab-panel relationship implementation.

## Proposed decision and rationale

Finish shared controls as interaction contracts before screen-by-screen work. Cover every applicable input and async state, preserve actionable recovery, and use WAI-ARIA patterns where custom widgets are required.

## Compatibility and product invariants

Preserve the existing feature and route inventory, local-first privacy, source files, drafts and ratings, explicit current/draft mutation scope, single audio ownership, bridge approval and atomic joining, and truthful export identity. Do not remove capability or weaken behavioural tests to obtain a cleaner screenshot. New API, schema, engine or platform work requires an explicitly scoped implementing change; this proposal alone does not authorize it.

## Implementation sequence and acceptance details

1. **P0021:** Inventory buttons, icon buttons, links, inputs, selects, sliders, chips, tabs, badges, rows, cards, menus, tooltips and overlays in a development-only state gallery.
2. **P0022:** Specify default/hover/pressed/selected/focus/disabled/busy/success/error states where applicable, including long labels and both themes.
3. **P0023:** Keep action geometry stable while labels change; prevent duplicate submission while preserving understandable busy and disabled semantics.
4. **P0024:** Provide persistent labels, inline validation, required/optional guidance and useful unavailable-action explanations; do not rely on placeholder text or hover alone.
5. **P0025:** Implement complete inspector tab focus, arrow-key navigation, selection and tab-panel relationships; distinguish route navigation links from tab widgets.
6. **P0026:** Verify dialog/drawer focus entry, containment, Escape, restoration, scroll boundaries and stacked overlay behaviour, including dirty-work handling.
7. **P0027:** Verify menus and tooltips with pointer, keyboard and touch; keep essential instructions visible outside tooltips.
8. **P0028:** Retain access to every actionable Undo under notification bursts, including more than three Undo messages; avoid silently evicting the only recovery path.
9. **P0029:** Make persistent failures actionable near their source, deduplicate repeated connectivity notices and avoid notification storms.
10. **P0030:** Keep destructive actions separate and use confirmation only for appropriate destructive consequences; preserve established undoable operations.
11. **P0031:** Run component keyboard/assistive checks and visual state comparisons before migrating consumers.

## Required tests and edge cases

Use the applicable cases in [the polish verification matrix](polish-verification-matrix.md), plus the task-specific cases above. Review both themes, loading-to-content transitions, narrow and wide layouts, keyboard/focus, long or missing metadata and failed/retried operations. For audio-affecting surfaces, include real audio ownership and continuity checks; for data-affecting actions, include current/draft identity and stale-response checks. Mark a case not applicable only with a recorded reason.

## Alternatives and trade-offs

Fixing each screen separately creates divergent focus, loading and recovery behaviour. Replacing all controls with a large new library would add migration risk; improve existing primitives unless a specific limitation justifies replacement.

## Acceptance and status update

Every shared component has reviewed visual and behavioural states; keyboard focus, duplicate-submit prevention and Undo access survive async failures and notification collisions.

The owner accepted proceeding with implementation in PR #23. Implementation progresses Not started → In progress → Implemented → Verified using linked evidence. Only implemented and verified work can satisfy runtime tasks. Record partial work and unperformed human checks in [the polish evidence ledger](polish-implementation-evidence.md); do not infer success from a checkbox in the previous programme.

| Date | Decision status | Implementation status | Evidence |
|---|---|---|---|
| 2026-11-06 | Proposed | Not started | Original documentation-only proposal |
| 2026-11-06 | Accepted | In progress | Owner requested full implementation and merge after green CI in PR #23; verification pending |
| 2026-11-10 | Accepted | In progress (8/11) | Reconciled against current code; P0021, P0023-P0026, P0028-P0030 ticked with tests run that day; independent verification still pending |

## References

- [Polish programme and roadmap](polish-roadmap.md)
- [Polish implementation checklist](polish-implementation-checklist.md)
- [Research and source-inspection notes](../research/ui-ux-polish.md)
- [Existing feature parity](feature-parity.md)
- [Existing test coverage](test-coverage-matrix.md)
