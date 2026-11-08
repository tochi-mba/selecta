# ADR-0182 — Unified microinteraction vocabulary, semantic feedback and musical copy

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** Not started (0/7 Implemented, 0/7 In progress, 7/7 Not started).
- **Independent verification:** No (0/7).
- **Programme/date/baseline:** Selecta creative-interface synthesis; 2026-11-08; main 4c2f9f03b8b7e185a7a5021979f4b443e40299dd.
- **Priority / phase:** P0 / Foundation.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0137, ADR-0138, ADR-0159, ADR-0163; earlier status unchanged.
- **Existing source touchpoints:** web/src/styles/tokens.css; web/src/styles/polish.css; web/src/ui/controls.tsx; web/src/ui/toasts.tsx.

## Context and evidence boundary

The code already has motion tokens and status components. A new creative instrument needs one coherent cause-and-effect vocabulary across small buttons, live audio events, version comparisons, reveals, undo and background work rather than unrelated animations per page.

This is a **new, not-yet-implemented design and acceptance delta**, not proof that prior accepted code or source-level MI requirements are missing. No independent verification is claimed.

## Accepted decision

- Define limited semantic motions: acknowledge, reveal, manipulate, commit, handoff, compare, revert and settle.
- Document authoritative event source, interruption, cancellation and resting state for each motion.
- Separate instant pressed feedback from confirmed server state and from real audible output.
- Specify brief readable feedback for errors and blocked actions without shaking or flashing.
- Unify technical and creative vocabulary so planned, prepared, applied, audible and exported are distinct.
- Make all animations optional under reduced motion and choose no UI sound effects.

## Visual, animation and microinteraction contract

- Press 0–120 ms, hover 100–160 ms, local reveal 140–260 ms; all are design targets, not measured.
- Audio-synchronized motion follows the actual player or preview clock, not CSS time.
- A focusable target never moves away underneath an active pointer or keyboard interaction.

## Alternatives and trade-offs

Preserve the existing restrained experience if an expressive version cannot prove comprehension, tactile confidence, accessibility and real playback performance. Diagrams do not claim unverified musical precision or quality. Never fabricate beat, lyric, wave, cover, render status, progress or success. Supply static/keyboard alternatives and respect intentional silence/Pause.

## Implementation checklist — 0/7 Implemented, 0/7 Verified

1. **CI-0182-01 — Inventory triggers and cancellation contract.** **Acceptance:** Every animation has data owner, states and interruption rules. **Required verification:** Per-component microstate matrix. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
2. **CI-0182-02 — Specify shared easing and motion tokens.** **Acceptance:** No ad-hoc global animation and every use has semantic reason. **Required verification:** CSS token/style audit. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
3. **CI-0182-03 — Differentiate pending versus committed state.** **Acceptance:** Busy and proposed never visually equal completed. **Required verification:** Slow network and failure fixtures. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
4. **CI-0182-04 — Define consistent revert and Undo response.** **Acceptance:** Reversal changes correct object and status, not just toast. **Required verification:** Undo conflict and Activity tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
5. **CI-0182-05 — Refine musical microcopy glossary.** **Acceptance:** Users understand plan/render/play versus human quality feedback. **Required verification:** Writing and comprehension review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
6. **CI-0182-06 — Apply sensory fallback contract.** **Acceptance:** Same information/action without motion or color. **Required verification:** Reduced-motion and forced-colors regression. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
7. **CI-0182-07 — Measure cost and comfort of motion.** **Acceptance:** No measurable playback impairment or cognitive distraction. **Required verification:** Named-hardware trace and participant evaluation. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.

## Invariants and negative cases

Retain single audio owner, original audio, LRCLIB disclosure, current/draft revisions and Undo, exact seam identity and requested/rendered difference, bridge approval/atomic insertion, eight Stem Studio lanes and recovery, Library/routes, blind A/B neutrality, frozen-revision FLAC and local-only running app. Check pending/error/stale/offline, 320–2560px, 400% zoom, RTL/missing metadata, keyboard/touch/AT, reduced motion, high contrast and real audio under load.

## Dependencies, evidence and status

- **Depends on:** ADR-0137, ADR-0138, ADR-0159, ADR-0163; reconcile existing evidence rather than assuming previous work incomplete.
- **Sequence:** owner acceptance → prototype → fixtures → scoped code PR → independent human/AT/device/audio/performance verification → signed GO/NO-GO.
- **Current:** Accepted; Not started; Independently Verified No. No implementing PR or SHA.
- [Roadmap](selecta-creative-interface-roadmap.md) · [140-task checklist](selecta-creative-interface-implementation-checklist.md) · [Evidence](selecta-creative-interface-implementation-evidence.md) · [Parity](selecta-creative-interface-feature-parity.md) · [Interaction matrix](selecta-creative-interface-interaction-matrix.md) · [Verification](selecta-creative-interface-verification-matrix.md) · [Gates](selecta-creative-interface-release-gates.md).
