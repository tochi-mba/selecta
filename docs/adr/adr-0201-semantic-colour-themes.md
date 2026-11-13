# ADR-0201 - Semantic palette, dark/light themes and contrast

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** In progress (5/8 Implemented, 0/8 In progress, 3/8 Not started; 2026-11-10).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta / Flow artistic UI/UX; 2026-11-08; main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15`.
- **Priority / phase:** P0 / Visual system.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0090/0183/0161; no historical status is changed.
- **Existing source touchpoints:** web/src/styles/tokens.css; web/src/state/prefs.ts; web/src/ui/controls.tsx.

## Context and evidence boundary

Separate decoration from status; refine warm-black, cream and accent roles with intentional themes, forced-colors alternatives and accessible focus. This is a **new design-and-acceptance delta**, not a claim that similar source-level functionality is absent. Current implementation and historical ledgers need task-specific reconciliation. This docs-only ADR PR is not implementation evidence.

## Proposed decision

Separate decoration from status; refine warm-black, cream and accent roles with intentional themes, forced-colors alternatives and accessible focus. Prefer a purposeful artistic presentation supported by authentic song, seam and mix state, with progressive disclosure for advanced controls. Make all changes incrementally and reversibly.

## Visual, animation and microinteraction contract

- Keep one first-glance musical focal object and one primary action; disclose precise controls when needed.
- Distinguish decorative identity, requested intentions, measured audio, rendered artifacts and verified outcomes.
- Motion is optional, causal and interruptible; reduced motion retains all meaning without shifting control reachability.
- Protect the current mix, draft revisions, exact song/seam identity and player ownership across asynchronous UI states.

## Alternatives, trade-offs and limits

Never encode readiness by hue alone or permit illegible text on artistic gradients. Prefer a calm and reliable existing control when a novel expression does not improve musical comprehension or agency. No new cloud, subscription, telemetry, audio asset, or backend contract is approved by this documentation alone.

## Implementation checklist - 5/8 Implemented, 0/8 Verified

1. **SF-0201-01 - Create semantic token hierarchy.** **Acceptance:** Surface/text/status/focus distinct from raw hues. **Required verification:** Token inventory. **Implementation:** Implemented; tokens.css layers palette, meaning and parts: surface, text, status and focus tokens are defined from palette tokens, and components use the meaning tokens; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/src/styles/tokens.css`; `docs/adr/completion/theme-and-edges.md`; `web/src/styles/spacing-tokens.test.ts`, `typography.test.ts`, `css-ownership.test.ts` (passed 2026-11-10).
2. **SF-0201-02 - Design dark theme depth.** **Acceptance:** Surfaces and typography remain readable in dim settings. **Required verification:** Dark specimen reviews. **Implementation:** Not started; Needs a person: a dark specimen review in dim settings. Automated part: Dark lifts each surface lighter, keeps ink at AAA and soft text at AA on every surface and avoids pure black and white (`web/src/styles/sf0201ThemeCharacter.test.ts` 'Dark depth for dim rooms', passed 2026-11-12); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
3. **SF-0201-03 - Design light theme character.** **Acceptance:** Not merely inverted dark tokens. **Required verification:** Light specimen reviews. **Implementation:** Not started; Needs a person: a light specimen review. Automated part: Light is not Dark inverted, has its own accent, primary fill and shadows, stays warm and keeps AAA/AA text (`web/src/styles/sf0201ThemeCharacter.test.ts` 'Light has its own character', passed 2026-11-12); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
4. **SF-0201-04 - Map status colors to meaning.** **Acceptance:** Ready/pending/blocked/error persist across variants. **Required verification:** State fixtures. **Implementation:** Implemented; ready, pending, blocked and error keep their meaning with text and shape as well as colour, in both themes and forced colours; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/src/ui/controls.test.tsx` 'never rely on colour alone'; `web/src/ui/MusicObjects.test.tsx` 'keeps queued, rendering, failed and rendered Thread states distinct without inventing sound'; `web/e2e/flow-forced-colors.e2e.ts`; run 2026-11-10.
5. **SF-0201-05 - Verify contrast quantitatively.** **Acceptance:** Relevant text and graphics meet WCAG AA. **Required verification:** Computed contrast audit. **Implementation:** Implemented; axe (including color-contrast) passes on every page and on dialogs in light and dark; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/e2e/pages.e2e.ts` 'every page passes the automatic accessibility checks in light', '... in dark', 'dialogs and drawers pass the automatic accessibility checks too'; run 2026-11-10.
6. **SF-0201-06 - Support forced-colors.** **Acceptance:** Controls remain visible under OS overrides. **Required verification:** Edge High Contrast test. **Implementation:** Implemented; under forced colours the current page, focus, buttons, transport and seek strip stay visible, with selection and focus drawn by system-colour outlines; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/e2e/flow-forced-colors.e2e.ts` 'forced colours keep controls visible, and selection and focus distinct', 'forced colours keep the Listen transport and seek strip usable' (Edge, forced-colors emulated; 2026-11-10).
7. **SF-0201-07 - Preserve theme system choice.** **Acceptance:** System/manual settings apply without audio changes. **Required verification:** Theme/transport E2E. **Implementation:** Implemented; system and manual theme apply without touching audio, and the browser chrome agrees before app JavaScript; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/e2e/finishing.e2e.ts` 'changing the theme while playing starts nothing again, and the title bar follows', 'a manual theme and browser chrome agree before app JavaScript, even when the OS disagrees'; run 2026-11-10.
8. **SF-0201-08 - Approve all-screen theme coverage.** **Acceptance:** Every relevant screen checked at mobile/desktop. **Required verification:** Reviewer screenshot gallery. **Implementation:** Not started; Needs a person: a reviewer approving a screenshot gallery of every screen at mobile and desktop in both themes; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.

## Invariants and required negative cases

Preserve one player and manual Pause, original local music, explicit LRCLIB metadata disclosure, current/draft revision guards and Undo, consented atomic bridge joining, eight-lane/8–64-cell Studio and local recovery, Library readiness/corrections, blind listening neutrality and frozen-revision decodable FLAC. Test relevant absent data, stale results, failed operations, long/RTL names, offline, touch, 320–2560px, 400% zoom, forced colors, reduced motion and real audio. Independent human, device, AT, auditory and performance acceptance remains unproven.

## Dependencies, evidence and status

- **Depends on:** ADR-0090/0183/0161 and new foundation ADR-0198/0199.
- **Sequence:** owner decision → designed specimens → narrow code/test PR → independently reviewed audio/visual/AT results → release gate.
- **Now:** Decision Accepted; Implementation 5/8 (2026-11-10); Independently Verified No; no implementation PR/SHA.
- [Roadmap](selecta-flow-roadmap.md) · [400-task checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Feature parity](selecta-flow-feature-parity.md) · [Interaction matrix](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [NO-GO gates](selecta-flow-release-gates.md).
