# ADR-0051: Accessible primitives, overlays, feedback and durable undo

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** Not started
- **Documentation status:** Drafted in the Selecta 3.0 documentation-only proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.0 complete experience overhaul
- **Phase:** 2 - Foundations
- **Extends existing decisions:** ADR-0004, ADR-0023, ADR-0035
- **Dependencies:** [programme roadmap](selecta-3-roadmap.md) and verified baseline; see phase order.
- **Work item statuses:** Every S3-0051-XX item below is **Not started**. No runtime feature, test or UI change is claimed by this ADR.

## Context and rationale

The application has Action, Overlay, Menu, Tooltip, toast and loading primitives. However, each visual overhaul creates a risk of losing keyboard behavior, allowing inaccessible nested overlays or burying recovery under temporary notifications.

## Decision proposed

Build one typed, tested presentation component library. Distinguish transient messages from durable recovery actions and make every modal, sheet, menu, grid, tab and busy button obey an explicit interaction contract.

## Experience and frontend architecture

- Buttons and async actions must expose disabled/busy/retry states, prevent duplicate submission and never claim success early. Menus own arrow/Escape keyboard behavior and return focus. Dialogs have labeled titles, inert backgrounds, appropriate initial focus and predictable dismissal.

- Undo refers to the specific confirmed operation, revision and resource scope; a durable recovery surface stores available Undo commands while transient toasts provide immediate confirmation. The UI must not silently remove the only reversible action.

- The component gallery is the review gate. Test normal, hover, focus, pressed, selected, saving, offline, error, long label, unknown data, nested overlay and 400% zoom states before broad adoption.

## Detailed implementation work (all Not started)

1. **S3-0051-01 - Not started.** Specify and implement Action/IconButton/Menu/Popover/Tooltip/Tabs/Dialog/Sheet/Drawer/Input/Slider/Search/Grid contracts.
2. **S3-0051-02 - Not started.** Normalize aria-label, described-by, invalid, busy, live-region and focus-restoration behavior and document exceptions.
3. **S3-0051-03 - Not started.** Create a durable activity/recovery area, retaining scoped Undo without unbounded toast growth.
4. **S3-0051-04 - Not started.** Define notification suppression, stacking, dismissal and announcement policies for navigation and Stage.
5. **S3-0051-05 - Not started.** Ensure overlay scrolling works under mobile keyboard, safe areas and large text with inert background.
6. **S3-0051-06 - Not started.** Give all destructive actions explicit labels and appropriate confirmation or reliable restore routes.
7. **S3-0051-07 - Not started.** Create component stories/fixtures across both themes, motion preferences, widths and error states.
8. **S3-0051-08 - Not started.** Protect against stale async callbacks, double activation, repeated Escape, menu-inside-sheet and focus target removal.

## Preservation and integration constraints

This work must preserve all applicable capabilities in [the existing feature-parity ledger](feature-parity.md): original source music and library data; drafts, user corrections, ratings and preferences; correct current-versus-draft mutation isolation; original routes; honest playable/render readiness; a single audio owner with no unintended stop or overlap; explicit request bridge consent and atomic insertion; accurate revision-bound FLAC; and secure localhost/origin privacy. New dependencies, API fields or native integration require separately reviewed contracts; the design does not itself authorize backend replacement.

## Required tests and edge-case verification (not yet executed)

- Automated axe plus manual NVDA/VoiceOver/keyboard checks for modal, menu, tabs, listbox, combobox and undo.
- Rapidly open and dismiss nested surfaces; verify focus returns to a meaningful surviving control.
- Trigger multiple scoped Undos in two drafts; ensure actions cannot be applied to the wrong revision.

General test dimensions: dark and light; initial/populated/empty/partial/refreshing/busy/failed/offline/recovery; 320px–4K; zoom, pointer and keyboard; realistic long/missing/duplicate/RTL metadata; accessibility checks; stale response and race tests; representative local-audio playback where relevant. Existing tests may be adapted to accessible semantics but not deleted or weakened.

## Alternatives, risks and trade-offs

Keep independently styled controls: faster for individual screens but grows inconsistent state behavior. A full external UI library may be viable only after bundle, keyboard and maintenance evaluation; no mandatory dependency is implied.

## Acceptance and evidence

Every core control passes the interaction matrix and no critical task depends on a vanishing toast or mouse-only affordance.

Before marking **Implemented**, link implementing PR(s), commit(s), contract tests, component/integration/E2E tests, screenshots and rollback disposition in [the evidence ledger](selecta-3-evidence.md). Before marking **Verified**, additionally record human task testing, assistive technology and audible checks wherever the change affects them. No prospective metric is a completed observation.

## Status history

| Date | Decision | Implementation | Evidence |
|---|---|---|---|
| 2026-11-07 | Proposed | Not started | Documentation-only ADR; no application or test changes |
| 2026-11-08 | Accepted | Not started | Owner accepted all proposed ADRs ([#37](https://github.com/tochi-mba/selecta/pull/37)) |

## References

- [Selecta 3.0 roadmap and ADR status index](selecta-3-roadmap.md)
- [Selecta 3.0 implementation checklist](selecta-3-implementation-checklist.md)
- [Selecta 3.0 verification matrix](selecta-3-verification-matrix.md)
- [Prior feature preservation contract](feature-parity.md)
- [Prior test coverage](test-coverage-matrix.md)
