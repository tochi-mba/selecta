# ADR-0206 - Honest cover art, song motifs and Mix Sleeves

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** Not started (0/8 Implemented, 0/8 In progress, 8/8 Not started).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta / Flow artistic UI/UX; 2026-11-08; main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15`.
- **Priority / phase:** P1 / Visual identity.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0166/0177/0179; no historical status is changed.
- **Existing source touchpoints:** web/src/ui/MusicObjects.tsx; web/src/views/Drafts.tsx.

## Context and evidence boundary

Use genuine local covers when available and deterministic decorative identity otherwise. Give completed mixes cohesive sleeves without pretending generated artwork is actual album art. This is a **new design-and-acceptance delta**, not a claim that similar source-level functionality is absent. Current implementation and historical ledgers need task-specific reconciliation. This docs-only ADR PR is not implementation evidence.

## Proposed decision

Use genuine local covers when available and deterministic decorative identity otherwise. Give completed mixes cohesive sleeves without pretending generated artwork is actual album art. Prefer a purposeful artistic presentation supported by authentic song, seam and mix state, with progressive disclosure for advanced controls. Make all changes incrementally and reversibly.

## Visual, animation and microinteraction contract

- Keep one first-glance musical focal object and one primary action; disclose precise controls when needed.
- Distinguish decorative identity, requested intentions, measured audio, rendered artifacts and verified outcomes.
- Motion is optional, causal and interruptible; reduced motion retains all meaning without shifting control reachability.
- Protect the current mix, draft revisions, exact song/seam identity and player ownership across asynchronous UI states.

## Alternatives, trade-offs and limits

Never infer actual album art, music quality, genre or mood from a hash. Prefer a calm and reliable existing control when a novel expression does not improve musical comprehension or agency. No new cloud, subscription, telemetry, audio asset, or backend contract is approved by this documentation alone.

## Implementation checklist - 0/8 Implemented, 0/8 Verified

1. **SF-0206-01 - Define artwork provenance.** **Acceptance:** Real, decorative and measured identities distinguishable. **Required verification:** Metadata contract audit. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
2. **SF-0206-02 - Build deterministic song motifs.** **Acceptance:** Stable ID produces stable repeatable identity. **Required verification:** Duplicate-title and refresh test. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
3. **SF-0206-03 - Handle actual cover media.** **Acceptance:** Corrupt, missing and oversized images safe. **Required verification:** Media-fixture tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
4. **SF-0206-04 - Design Mix Sleeve component.** **Acceptance:** Mix object looks consistent across surfaces. **Required verification:** Cross-route snapshots. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
5. **SF-0206-05 - Create a limited art-family system.** **Acceptance:** Options fit product aesthetic. **Required verification:** Theme gallery. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
6. **SF-0206-06 - Guard local-only media access.** **Acceptance:** No unrequested remote song/image upload. **Required verification:** Network inspection. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
7. **SF-0206-07 - Validate legibility over art.** **Acceptance:** Contrast, crop and 320px usability. **Required verification:** Responsive test. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
8. **SF-0206-08 - Preserve identity through revision.** **Acceptance:** Current and draft never show wrong sleeves. **Required verification:** Revision/source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.

## Invariants and required negative cases

Preserve one player and manual Pause, original local music, explicit LRCLIB metadata disclosure, current/draft revision guards and Undo, consented atomic bridge joining, eight-lane/8–64-cell Studio and local recovery, Library readiness/corrections, blind listening neutrality and frozen-revision decodable FLAC. Test relevant absent data, stale results, failed operations, long/RTL names, offline, touch, 320–2560px, 400% zoom, forced colors, reduced motion and real audio. Independent human, device, AT, auditory and performance acceptance remains unproven.

## Dependencies, evidence and status

- **Depends on:** ADR-0166/0177/0179 and new foundation ADR-0198/0199.
- **Sequence:** owner decision → designed specimens → narrow code/test PR → independently reviewed audio/visual/AT results → release gate.
- **Now:** Decision Accepted; Implementation Not started; Independently Verified No; no implementation PR/SHA.
- [Roadmap](selecta-flow-roadmap.md) · [400-task checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Feature parity](selecta-flow-feature-parity.md) · [Interaction matrix](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [NO-GO gates](selecta-flow-release-gates.md).
