# ADR-0198 - Artistic product charter and music-first experience

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** In progress (4/8 Implemented, 0/8 In progress, 4/8 Not started; 2026-11-10).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta / Flow artistic UI/UX; 2026-11-08; main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15`.
- **Priority / phase:** P0 / Foundation.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0165/0135/0184; no historical status is changed.
- **Existing source touchpoints:** web/src/App.tsx; web/src/shell/Shell.tsx.

## Context and evidence boundary

Treat Listen as cinematic, Explore as inspiring and Create as tactile and precise, preserving all existing musical operations despite permission to overhaul previous visual decisions. This is a **new design-and-acceptance delta**, not a claim that similar source-level functionality is absent. Current implementation and historical ledgers need task-specific reconciliation. This docs-only ADR PR is not implementation evidence.

## Proposed decision

Treat Listen as cinematic, Explore as inspiring and Create as tactile and precise, preserving all existing musical operations despite permission to overhaul previous visual decisions. Prefer a purposeful artistic presentation supported by authentic song, seam and mix state, with progressive disclosure for advanced controls. Make all changes incrementally and reversibly.

## Visual, animation and microinteraction contract

- Keep one first-glance musical focal object and one primary action; disclose precise controls when needed.
- Distinguish decorative identity, requested intentions, measured audio, rendered artifacts and verified outcomes.
- Motion is optional, causal and interruptible; reduced motion retains all meaning without shifting control reachability.
- Protect the current mix, draft revisions, exact song/seam identity and player ownership across asynchronous UI states.

## Alternatives, trade-offs and limits

No decorative audio claims, surprise playback or present-day SaaS. Prefer a calm and reliable existing control when a novel expression does not improve musical comprehension or agency. No new cloud, subscription, telemetry, audio asset, or backend contract is approved by this documentation alone.

## Implementation checklist - 4/8 Implemented, 0/8 Verified

1. **SF-0198-01 - Inventory all user journeys.** **Acceptance:** Every current action and state accounted for. **Required verification:** Source review and browser walkthrough. **Implementation:** Implemented; every route, persistent surface and overlay has an owner, fixture and state count in docs/adr/mp-0272-surface-inventory.json (MP-0272), and docs/adr/completion/journeys.md maps each journey to its actions, failures and recovery; the browser walkthrough is the independent part; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/src/shell/mpSurfaceInventory.test.ts` (MP-0272 surface inventory, passed 2026-11-10); `docs/adr/completion/journeys.md`; `docs/adr/completion/route-state-register.md`.
2. **SF-0198-02 - Define three expressive scene modes.** **Acceptance:** Each has clear focal object and primary action. **Required verification:** Light/dark design critique and five-second study. **Implementation:** Not started; Needs a person: a light/dark design critique and a five-second study to define and judge three scene modes; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
3. **SF-0198-03 - Define safety preservation contract.** **Acceptance:** Player, media, requests, Studio, drafts and FLAC explicitly protected. **Required verification:** Source-to-parity audit. **Implementation:** Implemented; the protected capabilities (player and Pause, media keys, requests, Studio, drafts, frozen FLAC) are listed with their negative gates in docs/adr/selecta-flow-feature-parity.md and each has a passing regression; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `docs/adr/selecta-flow-feature-parity.md`; `web/e2e/listen.e2e.ts` (17 tests incl. 'media keys do what they say', 'only one tab plays at a time'); `web/e2e/flows.e2e.ts` 'saving a mix as an audio file makes a real FLAC', 'drafts: make one, name it, fill it, and it stays apart from the current mix', 'requests: asking, then seeing it find a place, and cancelling for good'; `web/e2e/finishing.e2e.ts` 'the full Studio grid works at the smallest size'; `web/src/audio/focus.test.tsx`; all run 2026-11-10.
4. **SF-0198-04 - Set attention and interruption budgets.** **Acceptance:** Motion and modal events serve music and actual decisions. **Required verification:** Real listening observation. **Implementation:** Not started; Needs a person: real listening observation to set and judge attention and interruption budgets; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
5. **SF-0198-05 - Define non-negotiable user control.** **Acceptance:** Pause, cancel, Undo and scope remain obvious. **Required verification:** Input and race tests. **Implementation:** Implemented; Pause, cancel, Undo and scope are always offered and never overridden: scope-safe Undo history, cancel that leaves playback alone, Pause that nothing restarts; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/src/ui/controls.test.tsx` 'scope-safe Undo history', 'Undo runs what that message was about'; `web/src/App.test.tsx` 'asks before replacing an active mix with a draft, and cancel leaves playback untouched'; `web/src/audio/focus.test.tsx` 'never restarts the mix after someone has pressed something themselves'; `web/e2e/listen.e2e.ts` 'Pause stops the clock, and Resume carries on from the same place'; run 2026-11-10.
6. **SF-0198-06 - Specify progressive expertise.** **Acceptance:** Novice tasks simple but advanced tools discoverable. **Required verification:** Novice/DJ task tests. **Implementation:** Not started; Needs a person: novice and DJ task tests with participants. Automated part: `web/src/views/Now.test.tsx` 'keeps expert view controls discoverable without competing with playback' passes; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
7. **SF-0198-07 - Approve art-first success metrics.** **Acceptance:** Delight and task completion assessed independently. **Required verification:** Owner review and participant protocol. **Implementation:** Not started; Needs a person: owner approval of art-first success metrics and a participant protocol; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
8. **SF-0198-08 - Prepare incremental migration.** **Acceptance:** Old routes and functions survive redesigned interfaces. **Required verification:** E2E and rollback walkthrough. **Implementation:** Implemented; every older address keeps its meaning (router ALIASES), and reload, Back and Forward keep each page; **Verified:** No; **Owner:** Flow checklist agent (Claude); **PR/SHA:** feat/finish-checklists, 2026-11-10; **Evidence:** `web/src/router.test.tsx` (5 tests); `web/e2e/pages.e2e.ts` 'reloading any page stays on it', 'Back and Forward go where they should', 'addresses that go nowhere say so'; run 2026-11-10.

## Invariants and required negative cases

Preserve one player and manual Pause, original local music, explicit LRCLIB metadata disclosure, current/draft revision guards and Undo, consented atomic bridge joining, eight-lane/8–64-cell Studio and local recovery, Library readiness/corrections, blind listening neutrality and frozen-revision decodable FLAC. Test relevant absent data, stale results, failed operations, long/RTL names, offline, touch, 320–2560px, 400% zoom, forced colors, reduced motion and real audio. Independent human, device, AT, auditory and performance acceptance remains unproven.

## Dependencies, evidence and status

- **Depends on:** ADR-0165/0135/0184 and new foundation ADR-0198/0199.
- **Sequence:** owner decision → designed specimens → narrow code/test PR → independently reviewed audio/visual/AT results → release gate.
- **Now:** Decision Accepted; Implementation 4/8 (2026-11-10); Independently Verified No; no implementation PR/SHA.
- [Roadmap](selecta-flow-roadmap.md) · [400-task checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Feature parity](selecta-flow-feature-parity.md) · [Interaction matrix](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [NO-GO gates](selecta-flow-release-gates.md).
