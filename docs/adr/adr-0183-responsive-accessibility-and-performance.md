# ADR-0183 - Responsive sensory design, keyboard parity and audio performance

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** 4/7 Implemented, 0/7 In progress, 3/7 Need a person, 0/7 Not started (2026-11-10).
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

## Implementation checklist - 4/7 Implemented, 0/7 Verified

1. **CI-0183-01 - Define intensity choice and persistence.** **Acceptance:** User choice survives reload with no influence on music engine. **Required verification:** Pref and Stage tests. **Implementation:** Implemented (existing code credited); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** feat/finish-checklists (uncommitted); **Evidence:** web/e2e/motion-preference.e2e.ts "motion intensity is local and OS reduced-motion always wins" (Playwright, passed 2026-11-10); web/src/views/Now.test.tsx "keeps visual intensity independent from playback and remembers the choice"; web/src/views/Workshop.test.tsx "offers Still, Subtle and Expressive, saving the chosen intensity locally" (vitest, passed 2026-11-10).
2. **CI-0183-02 - Provide no-motion/no-color alternatives.** **Acceptance:** All key objects and actions understandable in forced colors. **Required verification:** NVDA/Edge and high contrast review. **Implementation:** Needs a person: NVDA with Edge in Windows high contrast review; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** forced-colours rules in web/src/styles/music-objects.css, listening.css, creation.css and depth.css.
3. **CI-0183-03 - Adapt tactile features to narrow touch.** **Acceptance:** Timeline drag, grid paint and energy curve never trap page scroll. **Required verification:** 320/375/430px coarse pointer tests. **Implementation:** Implemented (existing code credited); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** feat/finish-checklists (uncommitted); **Evidence:** web/e2e/finishing.e2e.ts "the full Studio grid works at the smallest size: it scrolls by itself, and the keyboard can reach all of it" (Playwright, passed 2026-11-10); web/src/views/MixSetup.test.tsx pointer cancel (vitest, passed 2026-11-10); coarse-pointer review on real phones still needs a person.
4. **CI-0183-04 - Validate high zoom and international text.** **Acceptance:** 400% zoom/RTL/emoji names retain controls and identity. **Required verification:** Responsive layout screenshots and keyboard. **Implementation:** Implemented (existing code credited); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** feat/finish-checklists (uncommitted); **Evidence:** web/e2e/pages.e2e.ts "nothing goes wider than the window in landscape, or zoomed in as far as browsers go", web/e2e/finishing.e2e.ts "long, right-to-left and duplicate names stay readable and whole at the smallest size" (Playwright, passed 2026-11-10); web/src/views/Mix.test.tsx "keeps duplicate, RTL and CJK song names readable and occurrence-scoped" (vitest, passed 2026-11-10).
5. **CI-0183-05 - Set audio graphics resource budget.** **Acceptance:** No new dropout during simultaneous audio analysis/render. **Required verification:** Actual hardware p95 frame and audio trace. **Implementation:** Needs a person: actual-hardware p95 frame and audio trace; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
6. **CI-0183-06 - Validate keyboard inset and layered overlays.** **Acceptance:** Focus, bottom navigation and player never hide active field. **Required verification:** Phone keyboard and fullscreen tests. **Implementation:** Implemented (existing code credited); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** feat/finish-checklists (uncommitted); **Evidence:** web/e2e/finishing.e2e.ts "with an on-screen keyboard up, what’s being typed gets the room", web/e2e/flows.e2e.ts "focus is never hidden behind the bottom bar on a phone" (Playwright, passed 2026-11-10); phone keyboard test on a device still needs a person.
7. **CI-0183-07 - Record independent accessibility acceptance.** **Acceptance:** Named screen reader/touch/low-vision tester signs exact SHA. **Required verification:** Human evidence protocol. **Implementation:** Needs a person: named screen reader, touch and low-vision tester signs the exact SHA; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.

## Invariants and negative cases

Retain single audio owner, original audio, LRCLIB disclosure, current/draft revisions and Undo, exact seam identity and requested/rendered difference, bridge approval/atomic insertion, eight Stem Studio lanes and recovery, Library/routes, blind A/B neutrality, frozen-revision FLAC and local-only running app. Check pending/error/stale/offline, 320–2560px, 400% zoom, RTL/missing metadata, keyboard/touch/AT, reduced motion, high contrast and real audio under load.

## Dependencies, evidence and status

- **Depends on:** ADR-0160, ADR-0161, ADR-0162, ADR-0110; reconcile existing evidence rather than assuming previous work incomplete.
- **Sequence:** owner acceptance → prototype → fixtures → scoped code PR → independent human/AT/device/audio/performance verification → signed GO/NO-GO.
- **Current:** Accepted; Not started; Independently Verified No. No implementing PR or SHA.
- [Roadmap](selecta-creative-interface-roadmap.md) · [140-task checklist](selecta-creative-interface-implementation-checklist.md) · [Evidence](selecta-creative-interface-implementation-evidence.md) · [Parity](selecta-creative-interface-feature-parity.md) · [Interaction matrix](selecta-creative-interface-interaction-matrix.md) · [Verification](selecta-creative-interface-verification-matrix.md) · [Gates](selecta-creative-interface-release-gates.md).
