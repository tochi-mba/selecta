# ADR-0184 - Incremental implementation, evidence, neutrality and release gates

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** Not started (0/7 Implemented, 0/7 In progress, 7/7 Not started).
- **Independent verification:** No (0/7).
- **Programme/date/baseline:** Selecta creative-interface synthesis; 2026-11-08; main 4c2f9f03b8b7e185a7a5021979f4b443e40299dd.
- **Priority / phase:** P0 / Quality.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0164, ADR-0133, ADR-0113, ADR-0158; earlier status unchanged.
- **Existing source touchpoints:** web/e2e/flows.e2e.ts; web/e2e/visual.e2e.ts; docs/acceptance.md; docs/adr/selecta-microinteraction-verification-matrix.md.

## Context and evidence boundary

Earlier MI tasks have published source-level status but no independent verification. This new design initiative must be explicitly separate: no inherited checkboxes, no implied acceptance from screenshots or docs, no unreviewed effect on real music, and a real rollback path for each implementation slice.

This is a **new, not-yet-implemented design and acceptance delta**, not proof that prior accepted code or source-level MI requirements are missing. No independent verification is claimed.

## Accepted decision

- Keep decision Proposed/Accepted, implementation Not started/In progress/Implemented, and independent Verified No/Yes separate and auditable.
- Reconcile overlapping prior accepted MI tasks before writing replacement code; implement only new creative deltas.
- Deliver in small reversible workstreams with exact source/test SHA and known parity invariants.
- Use independent real audio, accessibility, zoom/touch, performance and human comprehension evidence.
- Retain neutral A/B blind listening study presentation even if other screens become expressive.
- Block release on audio ownership, current/draft scope, bridge consent, original files, truthful status and exact FLAC.

## Visual, animation and microinteraction contract

- A screenshot is a visual candidate, not independently verified quality.
- Audio quality requires listening; synthetic muted UI tests cannot establish a good handoff.
- Every new motion effect must pass normal/reduced-motion and real-load checks or be disabled.

## Alternatives and trade-offs

Preserve the existing restrained experience if an expressive version cannot prove comprehension, tactile confidence, accessibility and real playback performance. Diagrams do not claim unverified musical precision or quality. Never fabricate beat, lyric, wave, cover, render status, progress or success. Supply static/keyboard alternatives and respect intentional silence/Pause.

## Implementation checklist - 0/7 Implemented, 0/7 Verified

1. **CI-0184-01 - Establish source baseline and prior-work crosswalk.** **Acceptance:** CI tasks distinguish novel delta from already implemented MI behavior. **Required verification:** Exact main SHA and parity diff. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
2. **CI-0184-02 - Create reversible delivery slices.** **Acceptance:** Each PR changes one bounded surface with rollback plan. **Required verification:** Feature-flag and migration review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
3. **CI-0184-03 - Map test and visual matrices to task IDs.** **Acceptance:** Every new CI task has state, viewport and negative-case coverage. **Required verification:** Coverage matrix review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
4. **CI-0184-04 - Run real uncoached creative tasks.** **Acceptance:** Listener/creator/expert success and hesitation counts documented. **Required verification:** Human task protocol and raw denominators. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
5. **CI-0184-05 - Protect A/B study neutrality.** **Acceptance:** Blind versions have identical appearance and audio ownership. **Required verification:** Study bias review and real media test. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
6. **CI-0184-06 - Rehearse correctness rollback.** **Acceptance:** Draft, revision, bridge, privacy and FLAC survive old/new/old. **Required verification:** Isolated data and real audio regression. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
7. **CI-0184-07 - Record owner GO/NO-GO with independent review.** **Acceptance:** Every P0 passed; P1 dispositioned and signed for exact SHA. **Required verification:** Named reviewer evidence and release decision. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.

## Invariants and negative cases

Retain single audio owner, original audio, LRCLIB disclosure, current/draft revisions and Undo, exact seam identity and requested/rendered difference, bridge approval/atomic insertion, eight Stem Studio lanes and recovery, Library/routes, blind A/B neutrality, frozen-revision FLAC and local-only running app. Check pending/error/stale/offline, 320–2560px, 400% zoom, RTL/missing metadata, keyboard/touch/AT, reduced motion, high contrast and real audio under load.

## Dependencies, evidence and status

- **Depends on:** ADR-0164, ADR-0133, ADR-0113, ADR-0158; reconcile existing evidence rather than assuming previous work incomplete.
- **Sequence:** owner acceptance → prototype → fixtures → scoped code PR → independent human/AT/device/audio/performance verification → signed GO/NO-GO.
- **Current:** Accepted; Not started; Independently Verified No. No implementing PR or SHA.
- [Roadmap](selecta-creative-interface-roadmap.md) · [140-task checklist](selecta-creative-interface-implementation-checklist.md) · [Evidence](selecta-creative-interface-implementation-evidence.md) · [Parity](selecta-creative-interface-feature-parity.md) · [Interaction matrix](selecta-creative-interface-interaction-matrix.md) · [Verification](selecta-creative-interface-verification-matrix.md) · [Gates](selecta-creative-interface-release-gates.md).
