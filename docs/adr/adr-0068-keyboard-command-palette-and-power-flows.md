# ADR-0068: Optional command palette, shortcut registry and expert navigation

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** Not started
- **Documentation status:** Drafted in the Selecta 3.0 documentation-only proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.0 complete experience overhaul
- **Phase:** 6 - Cross-cutting quality
- **Extends existing decisions:** ADR-0002, ADR-0006, ADR-0023
- **Dependencies:** [programme roadmap](selecta-3-roadmap.md) and verified baseline; see phase order.
- **Work item statuses:** Every S3-0068-XX item below is **Not started**. No runtime feature, test or UI change is claimed by this ADR.

## Context and rationale

Advanced users must navigate rapidly among Listen, Library, edits, requests and operations, but custom shortcuts risk conflicting with text inputs, Stem Studio's arrow keys and browser commands.

## Decision proposed

Introduce an optional discoverable Ctrl/Cmd+K command palette and a single shortcut registry without making any feature shortcut-only. Preserve existing supported global transport shortcuts and block them while interacting with editable controls or composite widgets.

## Experience and frontend architecture

- The command palette is a fully labeled combobox/dialog with scoped result actions, arrow/Enter/Escape and stable focus restoration. Search never silently executes a destructive or playback-replacing action. A command is available only when its current conditions are true.

- The shortcut registry defines priority: active modal > focused composite widget/input > route-local actions > global transport, with an explicit exceptions table. Shortcut help is visible and reflects actual bindings. Browser/PWA OS shortcuts are not intercepted unnecessarily.

- Commands for navigation and search are local-first; no new network dependency or telemetry is implied. Disabled commands explain missing prerequisites, such as insufficient mix-ready music.

## Detailed implementation work (all Not started)

1. **S3-0068-01 - Not started.** Inventory all existing keyboard shortcuts and collision with input, sliders, grid and browser controls.
2. **S3-0068-02 - Not started.** Design searchable command palette with true labels, categories, descriptions and conditions.
3. **S3-0068-03 - Not started.** Add safe navigation/request/edit/analysis commands, preserving visible alternate entry points.
4. **S3-0068-04 - Not started.** Define non-destructive default Enter behavior and confirmation for active-mix replacement.
5. **S3-0068-05 - Not started.** Implement consistent shortcut arbitration across dialogs, Studio, Stage and waveform.
6. **S3-0068-06 - Not started.** Provide discoverable keyboard shortcut reference and optional user preference for palette use.
7. **S3-0068-07 - Not started.** Add command identity, capability checks, route focus and Escape restoration tests.
8. **S3-0068-08 - Not started.** Usability-test novice discovery versus expert acceleration; revise before implementation freeze.

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
