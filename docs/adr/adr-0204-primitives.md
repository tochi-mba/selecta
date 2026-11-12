# ADR-0204 - Polished controls, icons, inputs and feedback primitives

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** In progress (5/8 Implemented, 0/8 In progress, 3/8 Not started; 2026-11-10).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta / Flow artistic UI/UX; 2026-11-08; main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15`.
- **Priority / phase:** P0 / Components.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0094/0182/0138; no historical status is changed.
- **Existing source touchpoints:** web/src/ui/controls.tsx; web/src/ui/primitives.tsx; web/src/ui/Icon.tsx.

## Context and evidence boundary

Establish a professional interaction system with complete states for buttons, selectors, fields, menus, toasts and errors. This is a **new design-and-acceptance delta**, not a claim that similar source-level functionality is absent. Current implementation and historical ledgers need task-specific reconciliation. This docs-only ADR PR is not implementation evidence.

## Proposed decision

Establish a professional interaction system with complete states for buttons, selectors, fields, menus, toasts and errors. Prefer a purposeful artistic presentation supported by authentic song, seam and mix state, with progressive disclosure for advanced controls. Make all changes incrementally and reversibly.

## Visual, animation and microinteraction contract

- Keep one first-glance musical focal object and one primary action; disclose precise controls when needed.
- Distinguish decorative identity, requested intentions, measured audio, rendered artifacts and verified outcomes.
- Motion is optional, causal and interruptible; reduced motion retains all meaning without shifting control reachability.
- Protect the current mix, draft revisions, exact song/seam identity and player ownership across asynchronous UI states.

## Alternatives, trade-offs and limits

No hover-only actions, fake disabled states, duplicate commits or missing accessible names. Prefer a calm and reliable existing control when a novel expression does not improve musical comprehension or agency. No new cloud, subscription, telemetry, audio asset, or backend contract is approved by this documentation alone.

## Implementation checklist - 5/8 Implemented, 0/8 Verified

1. **SF-0204-01 - Specify full control states.** **Acceptance:** Focus/pressed/pending/error/success all defined. **Required verification:** Component gallery. **Implementation:** Implemented; focus, pressed, pending, error and success are defined for the shared parts and shown in the development control gallery; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `docs/adr/completion/components.md`; `web/src/ui/ControlGallery.tsx`; `web/src/ui/controls.test.tsx` 'a button that takes time' (5 tests), 'states'; run 2026-11-10.
2. **SF-0204-02 - Standardise button hierarchy.** **Acceptance:** Primary action unique and reachable. **Required verification:** Usability and keyboard test. **Implementation:** Not started; Needs a person: a usability test that each page's primary action is unique and reachable. Automated part: browser check pending (`web/e2e/sf0204-primary-action.e2e.ts` 'every page shows at most one primary action, and the keyboard reaches it'); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
3. **SF-0204-03 - Refine icon semantics.** **Acceptance:** Size, stroke and accessible label consistent. **Required verification:** Icon audit/NVDA. **Implementation:** Not started; Needs a person: an NVDA icon audit. Automated part: icon-only buttons are named (axe in `web/e2e/pages.e2e.ts`, passed 2026-11-10); one 24px grid, four slots with matched stroke weight, and no hand-sized icons (`web/src/styles/icon-geometry.test.ts`, passed 2026-11-12); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
4. **SF-0204-04 - Harden forms and validation.** **Acceptance:** Clear labels/units/errors and stable focus. **Required verification:** Error injection E2E. **Implementation:** Implemented; forms say what is wrong, where and what to try, keep focus and keep what was typed; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/e2e/finishing.e2e.ts` 'a folder that can't be used says why and what to try', 'a slow search can't replace a newer one, and typing keeps its place'; `web/e2e/flows.e2e.ts` 'a change that couldn't be sent says so'; run 2026-11-10.
5. **SF-0204-05 - Define popover and dialog contracts.** **Acceptance:** Escape/outside/return focus predictable. **Required verification:** Keyboard and mobile tests. **Implementation:** Implemented; dialogs and menus close on Escape, trap and return focus, and tooltips yield the first Escape; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/src/ui/controls.test.tsx` 'things on top of the page', 'a menu', 'a tooltip'; `web/e2e/flows.e2e.ts` 'keyboard alone gets from the top of the page to the content, and dialogs give focus back'; run 2026-11-10.
6. **SF-0204-06 - Differentiate selection and focus.** **Acceptance:** Both visible in forced-colors. **Required verification:** High contrast test. **Implementation:** Implemented; under forced colours the current page has a 2px inset Highlight outline and keyboard focus a 3px outset one; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/e2e/flow-forced-colors.e2e.ts` 'forced colours keep controls visible, and selection and focus distinct' (2026-11-10).
7. **SF-0204-07 - Standardise feedback and undo.** **Acceptance:** Every commit has truthful outcome. **Required verification:** Async race tests. **Implementation:** Implemented; every commit reports its real outcome, slow answers can't overwrite newer ones, and Undo shows what is really there; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/src/ui/controls.test.tsx` 'Undo confirmation timing', 'says so if undoing fails'; `web/e2e/finishing.e2e.ts` 'two quick seam changes on a slow server: the last one wins, and Undo shows what's really there'; run 2026-11-10.
8. **SF-0204-08 - Approve complete primitive QA.** **Acceptance:** All states across themes inspected. **Required verification:** Independent visual review. **Implementation:** Not started; Needs a person: an independent visual review of all primitive states in both themes; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.

## Invariants and required negative cases

Preserve one player and manual Pause, original local music, explicit LRCLIB metadata disclosure, current/draft revision guards and Undo, consented atomic bridge joining, eight-lane/8–64-cell Studio and local recovery, Library readiness/corrections, blind listening neutrality and frozen-revision decodable FLAC. Test relevant absent data, stale results, failed operations, long/RTL names, offline, touch, 320–2560px, 400% zoom, forced colors, reduced motion and real audio. Independent human, device, AT, auditory and performance acceptance remains unproven.

## Dependencies, evidence and status

- **Depends on:** ADR-0094/0182/0138 and new foundation ADR-0198/0199.
- **Sequence:** owner decision → designed specimens → narrow code/test PR → independently reviewed audio/visual/AT results → release gate.
- **Now:** Decision Accepted; Implementation 5/8 (2026-11-10); Independently Verified No; no implementation PR/SHA.
- [Roadmap](selecta-flow-roadmap.md) · [400-task checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Feature parity](selecta-flow-feature-parity.md) · [Interaction matrix](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [NO-GO gates](selecta-flow-release-gates.md).
