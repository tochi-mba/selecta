# ADR-0183 — Responsive sensory design, keyboard parity and audio performance

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** Not started (0/7 Implemented, 0/7 In progress, 7/7 Not started).
- **Independent verification:** No (0/7).
- **Programme/date/baseline:** Selecta creative-interface synthesis; 2026-11-08; main 4c2f9f03b8b7e185a7a5021979f4b443e40299dd.
- **Priority / phase:** P0 / Quality.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0160, ADR-0161, ADR-0162, ADR-0110; earlier status unchanged.
- **Existing source touchpoints:** web/src/styles/tokens.css; web/src/styles/listening.css; web/src/styles/creation.css; web/src/ui/primitives.tsx.

## Context and evidence boundary

A captivating interface can fail if its visuals require hue recognition, hover, precise pointer gestures or expensive animation during processing. The additional creative grammar must be equally useful through a static keyboard-first presentation and verified on low-resource devices.

This is a **new, not-yet-implemented design and acceptance delta**, not proof that prior accepted code or source-level MI requirements are missing. No independent verification is claimed.

## Accepted decision

- Provide quiet, standard and expressive presentation modes without changing any audio state.
- Make all information available via text, icon and accessible semantics, not color, hover or movement alone.
- Use keyboard and list equivalents for timeline drag, SVG energy editing and Studio paint.
- Protect the song/player/footer from viewport safe area, keyboard and fullscreen changes.
- Throttle or pause visual effects offscreen and under reduced motion; always prioritize real audio.
- Require actual 320–2560px, 200/400% zoom, NVDA/Edge, touch and named-device performance evidence before approval.

## Visual, animation and microinteraction contract

- Quiet/reduced-motion offers an instant nonspatial state and static musical meaning.
- Do not animate a canvas when tab hidden, playback paused or no audio bins exist.
- Never trade keyboard focus stability or hit target size for visual flourish.

## Alternatives and trade-offs

Preserve the existing restrained experience if an expressive version cannot prove comprehension, tactile confidence, accessibility and real playback performance. Diagrams do not claim unverified musical precision or quality. Never fabricate beat, lyric, wave, cover, render status, progress or success. Supply static/keyboard alternatives and respect intentional silence/Pause.

## Implementation checklist — 0/7 Implemented, 0/7 Verified

1. **CI-0183-01 — Define intensity choice and persistence.** **Acceptance:** User choice survives reload with no influence on music engine. **Required verification:** Pref and Stage tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
2. **CI-0183-02 — Provide no-motion/no-color alternatives.** **Acceptance:** All key objects and actions understandable in forced colors. **Required verification:** NVDA/Edge and high contrast review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
3. **CI-0183-03 — Adapt tactile features to narrow touch.** **Acceptance:** Timeline drag, grid paint and energy curve never trap page scroll. **Required verification:** 320/375/430px coarse pointer tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
4. **CI-0183-04 — Validate high zoom and international text.** **Acceptance:** 400% zoom/RTL/emoji names retain controls and identity. **Required verification:** Responsive layout screenshots and keyboard. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
5. **CI-0183-05 — Set audio graphics resource budget.** **Acceptance:** No new dropout during simultaneous audio analysis/render. **Required verification:** Actual hardware p95 frame and audio trace. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
6. **CI-0183-06 — Validate keyboard inset and layered overlays.** **Acceptance:** Focus, bottom navigation and player never hide active field. **Required verification:** Phone keyboard and fullscreen tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
7. **CI-0183-07 — Record independent accessibility acceptance.** **Acceptance:** Named screen reader/touch/low-vision tester signs exact SHA. **Required verification:** Human evidence protocol. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.

## Invariants and negative cases

Retain single audio owner, original audio, LRCLIB disclosure, current/draft revisions and Undo, exact seam identity and requested/rendered difference, bridge approval/atomic insertion, eight Stem Studio lanes and recovery, Library/routes, blind A/B neutrality, frozen-revision FLAC and local-only running app. Check pending/error/stale/offline, 320–2560px, 400% zoom, RTL/missing metadata, keyboard/touch/AT, reduced motion, high contrast and real audio under load.

## Dependencies, evidence and status

- **Depends on:** ADR-0160, ADR-0161, ADR-0162, ADR-0110; reconcile existing evidence rather than assuming previous work incomplete.
- **Sequence:** owner acceptance → prototype → fixtures → scoped code PR → independent human/AT/device/audio/performance verification → signed GO/NO-GO.
- **Current:** Accepted; Not started; Independently Verified No. No implementing PR or SHA.
- [Roadmap](selecta-creative-interface-roadmap.md) · [140-task checklist](selecta-creative-interface-implementation-checklist.md) · [Evidence](selecta-creative-interface-implementation-evidence.md) · [Parity](selecta-creative-interface-feature-parity.md) · [Interaction matrix](selecta-creative-interface-interaction-matrix.md) · [Verification](selecta-creative-interface-verification-matrix.md) · [Gates](selecta-creative-interface-release-gates.md).
