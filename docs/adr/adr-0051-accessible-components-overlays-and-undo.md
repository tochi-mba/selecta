# ADR-0051: Accessible primitives, overlays, feedback and durable undo

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** In progress: 8 of 8 tasks implemented with automated evidence on 2026-11-10; 0 need a person; 0 still open
- **Documentation status:** Drafted in the Selecta 3.0 documentation-only proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.0 complete experience overhaul
- **Phase:** 2 - Foundations
- **Extends existing decisions:** ADR-0004, ADR-0023, ADR-0035
- **Dependencies:** [programme roadmap](selecta-3-roadmap.md) and verified baseline; see phase order.
- **Work item statuses:** Recorded on each item below (2026-11-10). Implemented means its automated evidence ran green; nothing here is independently Verified.

## Context and rationale

The application has Action, Overlay, Menu, Tooltip, toast and loading primitives. However, each visual overhaul creates a risk of losing keyboard behavior, allowing inaccessible nested overlays or burying recovery under temporary notifications.

## Decision proposed

Build one typed, tested presentation component library. Distinguish transient messages from durable recovery actions and make every modal, sheet, menu, grid, tab and busy button obey an explicit interaction contract.

## Experience and frontend architecture

- Buttons and async actions must expose disabled/busy/retry states, prevent duplicate submission and never claim success early. Menus own arrow/Escape keyboard behavior and return focus. Dialogs have labeled titles, inert backgrounds, appropriate initial focus and predictable dismissal.

- Undo refers to the specific confirmed operation, revision and resource scope; a durable recovery surface stores available Undo commands while transient toasts provide immediate confirmation. The UI must not silently remove the only reversible action.

- The component gallery is the review gate. Test normal, hover, focus, pressed, selected, saving, offline, error, long label, unknown data, nested overlay and 400% zoom states before broad adoption.

## Detailed implementation work

1. **S3-0051-01 - Implemented.** Specify and implement Action/IconButton/Menu/Popover/Tooltip/Tabs/Dialog/Sheet/Drawer/Input/Slider/Search/Grid contracts. **Evidence:** web/src/ui/controls.tsx (Action, Dialog, Sheet, Menu, Tooltip, Tabs, SearchField) and the Studio grid; web/src/ui/controls.test.tsx 'are named, and modal', 'opens, moves with the arrow keys, and closes with Escape, back on its button' and 'describes the control to a screen reader as well'; web/src/views/Studio.test.tsx 'is one tab stop, moves with the arrow keys, and Space turns a square on or off'; web/e2e/pages.e2e.ts 'dialogs and drawers pass the automatic accessibility checks too' (passed 2026-11-10).
2. **S3-0051-02 - Implemented.** Normalize aria-label, described-by, invalid, busy, live-region and focus-restoration behavior and document exceptions. **Evidence:** docs/adr/selecta-3-accessibility.md (patterns and exceptions); web/src/ui/controls.test.tsx 'problems are announced as problems', 'take focus, keep it inside, and give it back' and 'shows it’s working from the moment it’s pressed until that finishes' (passed 2026-11-10).
3. **S3-0051-03 - Implemented.** Create a durable activity/recovery area, retaining scoped Undo without unbounded toast growth. **Evidence:** web/src/state/activity.ts and web/src/ui/ActivityPanel.tsx; web/src/ui/controls.test.tsx 'keeps older Undo blocked while the newer one runs and after it fails' and 'retains the exact Undo notification while the server is still responding'; web/src/shell/Shell.test.tsx 'undoes the mix it was about, even after moving to another page' (passed 2026-11-10).
4. **S3-0051-04 - Implemented.** Define notification suppression, stacking, dismissal and announcement policies for navigation and Stage. **Evidence:** setToastsQuiet and the three-toast cap in web/src/ui/toasts.tsx; web/src/ui/toastsStage.test.ts 'keeps only problems in front, while every message is still kept in Activity' and 'never stacks more than three, and says routine words once'; web/src/ui/controls.test.tsx 'never shows more than a few at once' and 'the same words twice is one message' (passed 2026-11-10).
5. **S3-0051-05 - Implemented.** Ensure overlay scrolling works under mobile keyboard, safe areas and large text with inert background. **Evidence:** web/src/ui/controls.test.tsx 'makes the parent inert during a nested dialog and restores the nested opener'; web/e2e/finishing.e2e.ts 'with an on-screen keyboard up, what’s being typed gets the room'; web/e2e/overlay-arbitration.e2e.ts 'software keyboard makes notification chrome yield without removing notices or the mini-player'; web/e2e/pages.e2e.ts 'nothing goes wider than the window in landscape, or zoomed in as far as browsers go' (passed 2026-11-10).
6. **S3-0051-06 - Implemented.** Give all destructive actions explicit labels and appropriate confirmation or reliable restore routes. **Evidence:** web/src/views/Drafts.test.tsx 'confirms before deleting, preserves the draft on cancel and supports Undo'; web/src/views/Mix.test.tsx 'deleting closes it, goes back to the list, and can be undone'; web/src/views/Library.test.tsx 'shows exact current flags before confirming a batch edit'; web/src/ui/destructiveIcons.test.ts 'gives every iconned Delete or Remove the trash can and a visible word' (passed 2026-11-10).
7. **S3-0051-07 - Implemented.** Create component stories/fixtures across both themes, motion preferences, widths and error states. **Evidence:** web/src/ui/ControlGallery.tsx (Workspace > Diagnostics in development builds and in test builds made with VITE_SELECTA_GALLERY=1) captured as fixtures by web/e2e/s3-0051-gallery-matrix.e2e.ts 'S3-0051-07 gallery fixture in {light,dark} with {reduce,no-preference} motion at every width' (320, 768 and 1440 px; invalid field, failed load with retry and failed status shown; no horizontal overflow; reduced motion leaves nothing running; dialog Escape restores focus; a screenshot attached per combination) and 'S3-0051-07 the light and dark fixtures really are different themes' (5 passed 2026-11-10 on a VITE_SELECTA_GALLERY=1 build). Screenshots are capture, not visual approval.
8. **S3-0051-08 - Implemented.** Protect against stale async callbacks, double activation, repeated Escape, menu-inside-sheet and focus target removal. **Evidence:** web/src/ui/controls.test.tsx 'can’t be pressed twice while it’s going', 'doesn’t mind the page going away before it’s finished', 'does not swallow a dialog Escape when its menu is closed', 'dismisses only the tooltip on the first Escape inside a dialog', 'moves forward to the following control when the selected item disappears' and 'keep focus when a control in them goes away once it has done its job, so Escape still closes them' (passed 2026-11-10).

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
| 2026-11-10 | Accepted | In progress (7/8) | Task-by-task evidence on each item; 0 need a person, 1 still open |
| 2026-11-11 | Accepted | In progress (8/8) | S3-0051-07 gallery fixtures captured across themes, motion and widths |

## References

- [Selecta 3.0 roadmap and ADR status index](selecta-3-roadmap.md)
- [Selecta 3.0 implementation checklist](selecta-3-implementation-checklist.md)
- [Selecta 3.0 verification matrix](selecta-3-verification-matrix.md)
- [Prior feature preservation contract](feature-parity.md)
- [Prior test coverage](test-coverage-matrix.md)
