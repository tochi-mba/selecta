# ADR-0110: WCAG 2.2 AA accessibility, keyboard ownership, touch, reflow and human assistive technology

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** In progress (9/10 implemented, 0 in progress; source reconciliation 2026-11-10, branch feat/finish-checklists)
- **Verification status:** Not verified (0/10)
- **Documentation status:** Drafted, documentation-only Selecta 4.0 proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 4.0 complete UI/UX overhaul
- **Phase:** 1–11 Cross-cutting
- **Extends, does not automatically supersede:** ADR-0023, ADR-0067, ADR-0068, ADR-0087
- **Source surfaces to reconcile:** `web/src/ui/*`; `web/src/state/shortcuts.ts`; `web/e2e/*`; `web/src/styles/*.css`
- **Tasks:** S4-0110-01 through S4-0110-10 in [the Selecta 4.0 checklist](selecta-4-implementation-checklist.md)
- **Baseline:** `main` `9b663f9f10212619f27ce67ce82f602347065cbd` (after merged PRs #25 and #26)

## Context and evidence boundary

Automated axe checks do not prove keyboard or screen-reader task success. Complex drag/grid/pointer and global Space conflicts need architecture-level safeguards; high zoom and mobile keyboards can obscure controls.

This is a **proposal**. Source inspection and earlier planning documents establish current contracts and candidate risks; they do not establish verified visual quality, human task success, real audio quality, screen-reader usability or shipped implementation of this ADR. Earlier programme status headings can be stale and are not inherited as verified work.

## Proposed decision

Target WCAG 2.2 AA with product touch targets generally 44–48px, accessible non-drag alternatives, independently visible focus, controlled single-key shortcuts, accurate announcements and real NVDA/Edge task acceptance.

## Experience, frontend and interaction specification

- Use 24×24 CSS px as WCAG 2.2 AA Target Size (Minimum) baseline with exceptions; larger targets are a Selecta usability preference, not the standard.
- Global keyboard shortcuts yield to text fields, native/custom interactive controls, modal contexts and grid/slider owners.
- Focus is never covered by mini-player, sticky toolbar, drawer or mobile keyboard; Escape closes correct layer.
- Theme and colour-independent status, reduced motion, forced-colours and 200/400% zoom considered per component.

## Detailed implementation work

1. **S4-0110-01 - Audit keyboard tab order/landmarks/headings on every route.** Acceptance: Core journeys complete with no focus trap. Required verification: Keyboard-only listener/creator/expert scripts. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: flows.e2e.ts 'keyboard alone gets from the top of the page to the content'; finishing.e2e.ts keyboard request and reorder tests. Needs a person: keyboard-only listener, creator and expert scripts.
2. **S4-0110-02 - Fix Space conflict on custom role-button reorder grip.** Acceptance: Space activates focused control rather than global playback. Required verification: Targeted custom button/global handler test. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: Claude (owner-delegated 2026-11-12).** Evidence: web/src/state/shortcuts.ts leaves Space to [role=button]; new web/src/state/shortcuts.test.ts 'Space ownership' tests; listen.e2e.ts 'pressing Space on a button only does one thing'. **Verified:** Claude (owner-delegated 2026-11-12), a delegated review, not the owner's sign-off: read the Space ownership rule in web/src/state/shortcuts.ts ([role=button] activates with Space), shortcuts.test.ts and listen.e2e.ts 'pressing Space on a button only does one thing'; every test this line cites passed by name, reran 2026-11-12 at 9af0eb13 plus the uncommitted working tree: vitest (one worker) 22 files 348 passed and 5 files 77 passed, pytest 21 files 506 passed and 1 skipped (no symlink rights), and the cited Edge specs (Edge 157, dist-vb build, e2e_server) 25 passed.
3. **S4-0110-03 - Define shortcuts preference and assistive-tech-safe ownership.** Acceptance: Single-character shortcuts can be turned off/remapped as required. Required verification: Typing in text fields, modal and grid tests. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: Single-key shortcuts preference in Workshop.tsx and App.tsx gate (prefs singleKeys); shortcuts.test.ts. Needs a person: AT user review.
4. **S4-0110-04 - Verify draggable interactions have non-drag alternatives.** Acceptance: Reorder/insertion and sliders accessible without dragging. Required verification: Touch/keyboard/pointer alternatives acceptance. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: Claude (owner-delegated 2026-11-12).** Evidence: web/src/views/EditorRows.tsx grip Space plus arrows and move buttons; finishing.e2e.ts 'reordering with the keyboard moves the song, and focus stays on it'; flows.e2e.ts 'move with the buttons'. **Verified:** Claude (owner-delegated 2026-11-12): Playwright emulation of iPhone 13 and Pixel 7 with touch in Edge 157: on /mix/current/edit a tap on 'Move Slow Tide up' (44x44 px) reordered the song and a tap on Undo put it back, with no drag; the keyboard grip and arrows are covered by finishing.e2e.ts; captures docs/verification/claude-checks/selecta-4-implementation-checklist/S4-0110-04/.
5. **S4-0110-05 - Audit form/search/tab/menu/grid ARIA patterns.** Acceptance: Semantics reflect actual key model and status. Required verification: NVDA/Edge and component axe checks. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: pages.e2e.ts 'dialogs and drawers pass the automatic accessibility checks too'; Studio grid ARIA in Studio.test.tsx. Needs a person: NVDA/Edge pass.
6. **S4-0110-06 - Test 200/400% zoom and 320px reflow.** Acceptance: No essential hidden action or keyboard-trapped scroll. Required verification: Viewport screenshot and manual reflow test. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: Claude (owner-delegated 2026-11-12).** Evidence: pages.e2e.ts 'nothing goes wider than the window in landscape, or zoomed in as far as browsers go'. **Verified:** Claude (owner-delegated 2026-11-12): Edge 157 headless via Playwright 1.65, made-up library (tests/e2e_server.py, SELECTA_E2E_STRESS=1), commit 9af0eb13 plus working tree, 2026-11-12: every page in web/e2e/helpers.ts PAGES (14) at a 640x400 and a 320x200 CSS viewport (1280x800 at 200% and 400%): no sideways scroll, no control off the side, and 12 Tab presses on each page never left focus off screen; I looked at the captures in docs/verification/claude-checks/selecta-4-implementation-checklist/S4-0110-06/ (at 400% the content between the top bar and bottom bar is short but scrolls and the focused control stays visible).
7. **S4-0110-07 - Verify touch target spacing, high contrast and focus visibility.** Acceptance: Measured exceptions documented; not colour-only. Required verification: Computed geometry and forced-colours tests. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: Claude (owner-delegated 2026-11-12).** Evidence: forced-colors blocks in styles/creation.css, depth.css, glossary.css; web/e2e/micro-polish-geometry.e2e.ts target geometry. **Verified:** Claude (owner-delegated 2026-11-12): Edge 157 headless via Playwright 1.65, made-up library (tests/e2e_server.py, SELECTA_E2E_STRESS=1), commit 9af0eb13 plus working tree, 2026-11-12 with forced colours emulated (Edge forced-colors: active) in light and dark at 320, 768 and 1440 px on /library, /mix/current/edit, /mixes and /workshop; I looked at all 24 captures in docs/verification/claude-checks/selecta-4-implementation-checklist/S4-0110-07/: borders, toggles, statuses (planned is dashed, ready solid) and the keyboard focus ring (3px Highlight outline) survive; the focused primary button's label is readable after the fix already in web/src/styles/polish.css (forced-color-adjust: none, made by another agent the same day; an earlier build showed it blank). Measured exceptions under 24 px: the 13x13 radio inputs of the View and Theme switches, which sit inside larger labelled targets, and inline text links, which WCAG 2.5.8 exempts.
8. **S4-0110-08 - Implement reduced-motion and restrained progress announcements.** Acceptance: Visual state preserved while decorative motion disabled. Required verification: prefers-reduced-motion and live-region checks. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: Claude (owner-delegated 2026-11-12).** Evidence: web/src/ui/useReducedMotion.test.tsx; web/e2e/motion-preference.e2e.ts; finishing.e2e.ts 'with reduced motion nothing keeps moving by itself', 'playing doesn't flood a screen reader'. **Verified:** Claude (owner-delegated 2026-11-12), a delegated review, not the owner's sign-off: read useReducedMotion.test.tsx, motion-preference.e2e.ts, finishing.e2e.ts 'with reduced motion nothing keeps moving by itself' and 'playing doesn't flood a screen reader'; every test this line cites passed by name, reran 2026-11-12 at 9af0eb13 plus the uncommitted working tree: vitest (one worker) 22 files 348 passed and 5 files 77 passed, pytest 21 files 506 passed and 1 skipped (no symlink rights), and the cited Edge specs (Edge 157, dist-vb build, e2e_server) 25 passed.
9. **S4-0110-09 - Handle mobile safe areas/soft keyboard/short landscape.** Acceptance: Focused input, submit and Close reachable. Required verification: Real/simulated mobile keyboard task. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: finishing.e2e.ts 'with an on-screen keyboard up, what's being typed gets the room'; flows.e2e.ts 'focus is never hidden behind the bottom bar on a phone'. Claude check (owner-delegated 2026-11-12): iPhone 13 and Pixel 7 emulation turned to landscape (664x390, 839x412) in Edge 157: in the Requests drawer the focused search, its first result and Close all stay inside the window; captures docs/verification/claude-checks/selecta-4-implementation-checklist/S4-0110-09/. A soft keyboard cannot be emulated. Needs a person: on a real phone open the Requests drawer and the Lucy composer with the on-screen keyboard up, portrait and landscape; pass = the focused input, its submit and Close stay reachable
10. **S4-0110-10 - Record manual screen-reader tests with precise environment.** Acceptance: Automated passes not called full WCAG compliance. Required verification: Named NVDA/Edge and available VoiceOver/TalkBack task results. **Implementation: In progress (2026-11-12); Verified: No.** Evidence: AT session log template docs/verification/at-session-log.md (date, tester, SHA, device/OS, browser and screen-reader versions, zoom, seven tasks); environment-stamped automated log web/e2e/s4-0110-at-log.e2e.ts 'S4-0110 automated accessibility log: axe and a keyboard walk on every page, stamped with the environment' 1/1 passed 2026-11-12 (14 pages, axe 4.14.0, Edge 157.0.4341.46, 0 violations, 0 unnamed or hidden Tab stops; the log says it is not WCAG compliance); tests/test_s4_0110_at_session_log.py 3/3 passed 2026-11-12. Needs a person: named NVDA + Edge sessions on Windows, plus VoiceOver and TalkBack where a device is available, through the seven tasks in docs/verification/at-session-log.md with every environment field filled; pass = a signed session block per screen reader with each task Pass, or each Partly/Fail logged as a fault.

## Required negative cases and regression strategy

- Custom role=button and native control differences for Space/Enter.
- Grid roving tabindex and global arrow bindings conflict.
- Screen-reader progress updates every second can overwhelm listening.
- Exercise light, dark and system themes; empty, loading, partial, ready, stale, failed, offline and recovering states where applicable.
- Exercise 320/375/390/430/768/1024/1280/1440/1920 CSS-pixel widths, short viewports, 200/400% zoom, keyboard, touch, reduced motion, realistic long/missing/duplicate/Unicode/RTL metadata.
- Maintain existing frontend, API, audio and Python assertions; changed markup may require selector updates but never weakened behavioural contracts.

## Preservation and dependencies

Retain the [existing Selecta 3.0 invariants INV-01–INV-20](selecta-3-roadmap.md) and [3.1 preservation contract](selecta-3-1-roadmap.md): no original-file mutation; local-first security and LRCLIB disclosure; no loss of current/draft state, preferences, corrections or ratings; stable old routes; one audio owner; exact request consent and atomic join; truthful requested-versus-rendered state; revision-pinned decodable FLAC; full keyboard alternatives and regression assertions. No backend, schema, audio-engine or dependency rewrite is authorized by this ADR. See [4.0 parity matrix](selecta-4-feature-parity.md) and [verification matrix](selecta-4-verification-matrix.md).

## Alternatives, risks and trade-offs

Human accessibility work is time-consuming but essential before declaring a complex audio editor fully usable.

## Evidence and advancement rules

An owner must separately **Accept** this decision before it becomes policy. Each implementing PR must name the S4-0110 task IDs, actual commit(s), changed files, pre-existing regression tests, new negative/concurrency cases, theme/viewport screenshots and relevant human/audible/AT evidence. **Implemented** requires merged code and applicable automated checks; **Verified** additionally requires independent real acceptance relevant to the change. An unchecked checkbox means not Verified. A docs merge does not advance these statuses.

## Status history

| Date | Decision | Implementation | Verification | Evidence |
|---|---|---|---|---|
| 2026-11-07 | Proposed | Not started | Not verified | Documentation-only specification; no runtime, test or UI changes |
| 2026-11-08 | Accepted | Not started | Not verified | Owner accepted all proposed ADRs ([#37](https://github.com/tochi-mba/selecta/pull/37)) |
| 2026-11-10 | Accepted | In progress (9/10) | Not verified | Source reconciliation against current code with focused tests run 2026-11-10; every task still needs independent verification |
| 2026-11-12 | Accepted | In progress (9/10) | Not verified | Automatable parts of the person-step tasks built and run 2026-11-12; every task still needs a person or independent verification |

## Related documents

- [Selecta 4.0 roadmap and ADR index](selecta-4-roadmap.md)
- [4.0 implementation checklist](selecta-4-implementation-checklist.md)
- [4.0 per-task evidence ledger](selecta-4-evidence.md)
- [4.0 verification and edge-case matrix](selecta-4-verification-matrix.md)
- [4.0 release readiness criteria](selecta-4-release-gates.md)
- [Earlier 3.1 implementation checklist](selecta-3-1-implementation-checklist.md)
