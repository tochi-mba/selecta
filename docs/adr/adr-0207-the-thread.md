# ADR-0207 - The Thread: truthful music-object continuity grammar

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** In progress (5/8 Implemented, 0/8 In progress, 3/8 Not started; 2026-11-10).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta / Flow artistic UI/UX; 2026-11-08; main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15`.
- **Priority / phase:** P0 / Visual identity.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0166/0173/0175; no historical status is changed.
- **Existing source touchpoints:** web/src/ui/MusicObjects.tsx; web/src/state/readiness.ts.

## Context and evidence boundary

One visual thread carries confirmed, planned, missing and blocked music states across Listen, Explore, Create, Requests and Export. Meaning is data-backed, not invented. This is a **new design-and-acceptance delta**, not a claim that similar source-level functionality is absent. Current implementation and historical ledgers need task-specific reconciliation. This docs-only ADR PR is not implementation evidence.

## Proposed decision

One visual thread carries confirmed, planned, missing and blocked music states across Listen, Explore, Create, Requests and Export. Meaning is data-backed, not invented. Prefer a purposeful artistic presentation supported by authentic song, seam and mix state, with progressive disclosure for advanced controls. Make all changes incrementally and reversibly.

## Visual, animation and microinteraction contract

- Keep one first-glance musical focal object and one primary action; disclose precise controls when needed.
- Distinguish decorative identity, requested intentions, measured audio, rendered artifacts and verified outcomes.
- Motion is optional, causal and interruptible; reduced motion retains all meaning without shifting control reachability.
- Protect the current mix, draft revisions, exact song/seam identity and player ownership across asynchronous UI states.

## Alternatives, trade-offs and limits

Never disguise a plan as rendered audio, or decorative line as waveform/beat evidence. Prefer a calm and reliable existing control when a novel expression does not improve musical comprehension or agency. No new cloud, subscription, telemetry, audio asset, or backend contract is approved by this documentation alone.

## Implementation checklist - 5/8 Implemented, 0/8 Verified

1. **SF-0207-01 - Define provenance categories.** **Acceptance:** Decorative/planned/measured/rendered/heard states typed. **Required verification:** Model mapping. **Implementation:** Implemented; requested, in progress, rendered and heard are separate typed layers (seamLayers) and the diagram uses the rendered move only once ready; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/src/ui/MusicObjects.test.tsx` 'uses the rendered move rather than disguising a fallback', 'never calls an automatic unrendered transition a confirmed technique', 'keeps queued, rendering, failed and rendered Thread states distinct'; run 2026-11-10.
2. **SF-0207-02 - Design Thread marks.** **Acceptance:** Ready/planned/blocked identifiable without hue. **Required verification:** Grayscale review. **Implementation:** Implemented; Thread states carry words and shapes, not only hue, including under forced colours; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/src/ui/controls.test.tsx` 'never rely on colour alone'; `web/e2e/flow-forced-colors.e2e.ts`; run 2026-11-10.
3. **SF-0207-03 - Bind stable song and seam IDs.** **Acceptance:** Repeated songs remain unambiguous. **Required verification:** Duplicate ID tests. **Implementation:** Implemented; songs are keyed by occurrence and seams by their pair, so repeats stay distinct; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/src/player.test.ts` 'keeps the later occurrence when the same recording appears twice', 'previous and seek do not jump to the first copy'; `web/src/views/Mix.test.tsx` occurrence labels; run 2026-11-10.
4. **SF-0207-04 - Design static/AT descriptions.** **Acceptance:** Visual information recoverable without animation. **Required verification:** NVDA and motion tests. **Implementation:** Not started; Needs a person: an NVDA session on the Thread descriptions. Automated part: reduced motion keeps all meaning (`web/e2e/finishing.e2e.ts`); every Thread state is spelt out on screen and in the accessible name, drawings are aria-hidden, compact and full forms say the same, energy values are text (`web/src/ui/sf0207StaticDescriptions.test.tsx`, 7 passed 2026-11-12); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
5. **SF-0207-05 - Scale compact-to-expanded forms.** **Acceptance:** Player/card/editor use common grammar. **Required verification:** 320–2560 visual fixtures. **Implementation:** Not started; Needs a person: a 320-2560 visual fixture review of compact and expanded forms; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
6. **SF-0207-06 - Distinguish energy intent/outcome.** **Acceptance:** Values and uncertainty labeled separately. **Required verification:** Data schema verification. **Implementation:** Implemented; requested energy and measured energy are separate values and unknown stays a gap; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/src/ui/MusicObjects.test.tsx` 'keeps requested and measured energy explicitly separate', 'keeps unknown song energy as an unknown gap'; run 2026-11-10.
7. **SF-0207-07 - Roll out across surfaces.** **Acceptance:** Reuse one component contract without state coupling. **Required verification:** Cross-route tests. **Implementation:** Implemented; SongMotif and SeamDiagram are one shared component each, imported from `ui/MusicObjects` by Listen, Edit, Inspector, Library, Requests, Studio, Lucy and Song details, with no route-level copy and no module, context or store state shared between placements; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/src/views/sf0207ThreadContract.test.tsx` (5 tests: 'every route that draws a song motif or seam imports the one shared component', 'no route draws its own copy ...', 'the shared module keeps no state ...', 'the same song looks the same on any route ...', 'a seam says the same thing in the compact Edit row and the full Inspector'); run 2026-11-10.
8. **SF-0207-08 - Validate first-glance truth.** **Acceptance:** People distinguish planned/playing/ready. **Required verification:** User comprehension study. **Implementation:** Not started; Needs a person: a user comprehension study of planned, playing and ready; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.

## Invariants and required negative cases

Preserve one player and manual Pause, original local music, explicit LRCLIB metadata disclosure, current/draft revision guards and Undo, consented atomic bridge joining, eight-lane/8–64-cell Studio and local recovery, Library readiness/corrections, blind listening neutrality and frozen-revision decodable FLAC. Test relevant absent data, stale results, failed operations, long/RTL names, offline, touch, 320–2560px, 400% zoom, forced colors, reduced motion and real audio. Independent human, device, AT, auditory and performance acceptance remains unproven.

## Dependencies, evidence and status

- **Depends on:** ADR-0166/0173/0175 and new foundation ADR-0198/0199.
- **Sequence:** owner decision → designed specimens → narrow code/test PR → independently reviewed audio/visual/AT results → release gate.
- **Now:** Decision Accepted; Implementation 4/8 (2026-11-10); Independently Verified No; no implementation PR/SHA.
- [Roadmap](selecta-flow-roadmap.md) · [400-task checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Feature parity](selecta-flow-feature-parity.md) · [Interaction matrix](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [NO-GO gates](selecta-flow-release-gates.md).
