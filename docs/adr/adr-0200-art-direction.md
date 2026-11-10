# ADR-0200 - Distinctive editorial and cinematic art direction

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** In progress (0/8 Implemented, 0/8 In progress, 8/8 Not started; 2026-11-10).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta / Flow artistic UI/UX; 2026-11-08; main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15`.
- **Priority / phase:** P0 / Visual system.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0136/0166/0130; no historical status is changed.
- **Existing source touchpoints:** web/src/styles/tokens.css; web/src/style.css; web/src/styles/music-objects.css.

## Context and evidence boundary

Build an ownable aesthetic informed by physical records, editorial typography and concert light rather than stock streaming cards. Compare several candidates before selecting. This is a **new design-and-acceptance delta**, not a claim that similar source-level functionality is absent. Current implementation and historical ledgers need task-specific reconciliation. This docs-only ADR PR is not implementation evidence.

## Proposed decision

Build an ownable aesthetic informed by physical records, editorial typography and concert light rather than stock streaming cards. Compare several candidates before selecting. Prefer a purposeful artistic presentation supported by authentic song, seam and mix state, with progressive disclosure for advanced controls. Make all changes incrementally and reversibly.

## Visual, animation and microinteraction contract

- Keep one first-glance musical focal object and one primary action; disclose precise controls when needed.
- Distinguish decorative identity, requested intentions, measured audio, rendered artifacts and verified outcomes.
- Motion is optional, causal and interruptible; reduced motion retains all meaning without shifting control reachability.
- Protect the current mix, draft revisions, exact song/seam identity and player ownership across asynchronous UI states.

## Alternatives, trade-offs and limits

Avoid copied UI, unlicensed artwork, meaningless neon and uniform decorative noise. Prefer a calm and reliable existing control when a novel expression does not improve musical comprehension or agency. No new cloud, subscription, telemetry, audio asset, or backend contract is approved by this documentation alone.

## Implementation checklist - 0/8 Implemented, 0/8 Verified

1. **SF-0200-01 - Generate three design directions.** **Acceptance:** Each covers Listen/Explore/Create/Library. **Required verification:** Side-by-side responsive boards. **Implementation:** Not started; Needs a person: designers producing three directions as side-by-side responsive boards; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
2. **SF-0200-02 - Define visual signature.** **Acceptance:** Recognisable distinct brand traits and exclusions. **Required verification:** Blind brand-comprehension study. **Implementation:** Not started; Needs a person: a blind brand-comprehension study; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
3. **SF-0200-03 - Design material hierarchy.** **Acceptance:** Surface, depth, grain and contrast serve intent. **Required verification:** Both-theme specimen review. **Implementation:** Not started; Needs a person: a both-theme specimen review of surface, depth and grain; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
4. **SF-0200-04 - Specify expressive editorial layouts.** **Acceptance:** Whitespace and asymmetry retain clear controls. **Required verification:** Five-second task comprehension. **Implementation:** Not started; Needs a person: a five-second task comprehension study of editorial layouts; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
5. **SF-0200-05 - Design artwork and missing-art states.** **Acceptance:** Aesthetic remains cohesive with absent media. **Required verification:** Real/missing artwork fixtures. **Implementation:** Not started; Needs a person: a design judgement that the look holds together with absent media. Automated part: `web/src/ui/MusicObjects.test.tsx` 'gives one library ID the same decorative motif without depending on titles or artwork' passes; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
6. **SF-0200-06 - Establish light and dark art direction.** **Acceptance:** Both modes designed independently. **Required verification:** Screenshot contrast review. **Implementation:** Not started; Needs a person: a screenshot contrast review that light and dark were each designed on their own terms. Automated part: axe contrast checks in both schemes (`web/e2e/pages.e2e.ts`) pass; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
7. **SF-0200-07 - Review cultural/genre neutrality.** **Acceptance:** No false genre or mood assumptions. **Required verification:** Diverse-library test set. **Implementation:** Not started; Needs a person: a review against a diverse real library for genre or mood assumptions. Automated part: long, RTL and duplicate names stay whole (`web/e2e/finishing.e2e.ts`); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
8. **SF-0200-08 - Approve direction and migration.** **Acceptance:** Selected direction has measurable criteria and rollback. **Required verification:** Decision record and QA plan. **Implementation:** Not started; Needs a person: owner approval of a direction, its criteria and rollback; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.

## Invariants and required negative cases

Preserve one player and manual Pause, original local music, explicit LRCLIB metadata disclosure, current/draft revision guards and Undo, consented atomic bridge joining, eight-lane/8–64-cell Studio and local recovery, Library readiness/corrections, blind listening neutrality and frozen-revision decodable FLAC. Test relevant absent data, stale results, failed operations, long/RTL names, offline, touch, 320–2560px, 400% zoom, forced colors, reduced motion and real audio. Independent human, device, AT, auditory and performance acceptance remains unproven.

## Dependencies, evidence and status

- **Depends on:** ADR-0136/0166/0130 and new foundation ADR-0198/0199.
- **Sequence:** owner decision → designed specimens → narrow code/test PR → independently reviewed audio/visual/AT results → release gate.
- **Now:** Decision Accepted; Implementation 0/8 (2026-11-10); Independently Verified No; no implementation PR/SHA.
- [Roadmap](selecta-flow-roadmap.md) · [400-task checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Feature parity](selecta-flow-feature-parity.md) · [Interaction matrix](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [NO-GO gates](selecta-flow-release-gates.md).
