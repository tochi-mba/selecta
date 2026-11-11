# ADR-0068: Optional command palette, shortcut registry and expert navigation

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** In progress: 7 of 8 tasks implemented with automated evidence on 2026-11-11; 1 need a person; 0 still open
- **Documentation status:** Drafted in the Selecta 3.0 documentation-only proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.0 complete experience overhaul
- **Phase:** 6 - Cross-cutting quality
- **Extends existing decisions:** ADR-0002, ADR-0006, ADR-0023
- **Dependencies:** [programme roadmap](selecta-3-roadmap.md) and verified baseline; see phase order.
- **Work item statuses:** Recorded on each item below (2026-11-11). Implemented means its automated evidence ran green; nothing here is independently Verified.

## Context and rationale

Advanced users must navigate rapidly among Listen, Library, edits, requests and operations, but custom shortcuts risk conflicting with text inputs, Stem Studio's arrow keys and browser commands.

## Decision proposed

Introduce an optional discoverable Ctrl/Cmd+K command palette and a single shortcut registry without making any feature shortcut-only. Preserve existing supported global transport shortcuts and block them while interacting with editable controls or composite widgets.

## Experience and frontend architecture

- The command palette is a fully labeled combobox/dialog with scoped result actions, arrow/Enter/Escape and stable focus restoration. Search never silently executes a destructive or playback-replacing action. A command is available only when its current conditions are true.

- The shortcut registry defines priority: active modal > focused composite widget/input > route-local actions > global transport, with an explicit exceptions table. Shortcut help is visible and reflects actual bindings. Browser/PWA OS shortcuts are not intercepted unnecessarily.

- Commands for navigation and search are local-first; no new network dependency or telemetry is implied. Disabled commands explain missing prerequisites, such as insufficient mix-ready music.

## Detailed implementation work

1. **S3-0068-01 - Implemented.** Inventory all existing keyboard shortcuts and collision with input, sliders, grid and browser controls. **Evidence:** docs/adr/selecta-3-keyboard.md 'Who gets a key', 'Global shortcuts' (each key with what it collides with and how that is settled) and 'Exceptions'; tests/test_s3_docs_contracts.py test_every_global_shortcut_is_in_the_keyboard_inventory; web/src/state/shortcuts.test.ts 'does not take Ctrl K or Cmd K from text editing', 'leaves Space to real buttons, checkboxes, text and grids' and 'leaves Space to a custom role=button reorder grip and its children' (passed 2026-11-11).
2. **S3-0068-02 - Implemented.** Design searchable command palette with true labels, categories, descriptions and conditions. **Evidence:** web/src/ui/CommandPalette.tsx (combo box and list box, grouped Songs, Your drafts, Go to, Playback and Do, each option with its kind, detail or reason) over web/src/shell/commands.ts; web/src/ui/CommandPalette.test.tsx 'shows exact Undo scope but refuses an unavailable mutation' and 'clamps the active command if a live result list becomes shorter'; web/src/ui/paletteStale.test.tsx 'ignores an older answer that lands after the newer one' (passed 2026-11-11).
3. **S3-0068-03 - Implemented.** Add safe navigation/request/edit/analysis commands, preserving visible alternate entry points. **Evidence:** web/src/shell/commands.ts navigation, request, edit, undo and analysis commands, each a shortcut to a control that already exists; web/src/shell/paletteInventory.test.ts and web/src/shell/commands.test.ts; web/src/views/s3-0064-workspace.test.tsx 'Analysis starts the rest and pauses it again' (the visible Analyse control the palette command mirrors) (passed 2026-11-11).
4. **S3-0068-04 - Implemented.** Define non-destructive default Enter behavior and confirmation for active-mix replacement. **Evidence:** web/e2e/s3-0068-palette-preference.e2e.ts 'Enter on Start a new mix only goes to Explore, and the mix that is playing carries on (S3-0068-04/07)' (passed 2026-11-11).
5. **S3-0068-05 - Implemented.** Implement consistent shortcut arbitration across dialogs, Studio, Stage and waveform. **Evidence:** web/src/state/shortcuts.test.ts 'opens from the page, but not while an overlay owns the keys'; web/e2e/s3-0068-palette-preference.e2e.ts 'the shortcut list turns the palette off and on, and Ctrl K respects dialogs and text boxes (S3-0068-05/06)'; web/src/ui/controls.test.tsx 'does not swallow a dialog Escape when its menu is closed' (passed 2026-11-11).
6. **S3-0068-06 - Implemented.** Provide discoverable keyboard shortcut reference and optional user preference for palette use. **Evidence:** web/e2e/s3-0068-palette-preference.e2e.ts 'the shortcut list turns the palette off and on, and Ctrl K respects dialogs and text boxes (S3-0068-05/06)' (the ? list shows Ctrl K only while it is on, and its checkbox turns the palette off and back on) (passed 2026-11-11).
7. **S3-0068-07 - Implemented.** Add command identity, capability checks, route focus and Escape restoration tests. **Evidence:** command identity: web/src/ui/CommandPalette.test.tsx 'opens the exact recording ID even when different results share a title'; capability checks: 'shows exact Undo scope but refuses an unavailable mutation'; Escape restoration and no replacement of what plays: web/e2e/s3-0068-palette-preference.e2e.ts 'the shortcut list turns the palette off and on, and Ctrl K respects dialogs and text boxes (S3-0068-05/06)' (Escape returns focus to the opener) and 'Enter on Start a new mix only goes to Explore, and the mix that is playing carries on (S3-0068-04/07)' (passed 2026-11-11).
8. **S3-0068-08 - Needs a person.** Usability-test novice discovery versus expert acceleration; revise before implementation freeze. **Status:** Needs a person: usability sessions comparing novice discovery with expert acceleration through the palette, run with real participants before a freeze

## Preservation and integration constraints

This work must preserve all applicable capabilities in [the existing feature-parity ledger](feature-parity.md): original source music and library data; drafts, user corrections, ratings and preferences; correct current-versus-draft mutation isolation; original routes; honest playable/render readiness; a single audio owner with no unintended stop or overlap; explicit request bridge consent and atomic insertion; accurate revision-bound FLAC; and secure localhost/origin privacy. New dependencies, API fields or native integration require separately reviewed contracts; the design does not itself authorize backend replacement.

## Required tests and edge-case verification (not yet executed)

- Space in Studio toggles focused cell not global playback; arrows in slider never navigate grid unexpectedly.
- Ctrl/Cmd+K while input active, modal open, Stage active and offline.
- Command result stale after draft deleted; disabled or reject without wrong-resource action.

General test dimensions: dark and light; initial/populated/empty/partial/refreshing/busy/failed/offline/recovery; 320px–4K; zoom, pointer and keyboard; realistic long/missing/duplicate/RTL metadata; accessibility checks; stale response and race tests; representative local-audio playback where relevant. Existing tests may be adapted to accessible semantics but not deleted or weakened.

## Alternatives, risks and trade-offs

Add shortcuts ad hoc per component: quick but high conflict risk. A comprehensive custom rebinding editor is out of scope unless user research demands it.

## Acceptance and evidence

Experts can accelerate common tasks while every action remains accessible by normal navigation and keyboard focus.

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
