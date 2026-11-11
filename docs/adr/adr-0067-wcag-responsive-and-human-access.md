# ADR-0067: WCAG 2.2 AA, responsive reflow and complete keyboard access

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** In progress: 7 of 9 tasks implemented with automated evidence on 2026-11-11; 2 need a person; 0 still open
- **Documentation status:** Drafted in the Selecta 3.0 documentation-only proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.0 complete experience overhaul
- **Phase:** 6 - Cross-cutting quality
- **Extends existing decisions:** ADR-0023, ADR-0024, ADR-0045
- **Dependencies:** [programme roadmap](selecta-3-roadmap.md) and verified baseline; see phase order.
- **Work item statuses:** Recorded on each item below (2026-11-11). Implemented means its automated evidence ran green; nothing here is independently Verified.

## Context and rationale

Selecta has custom tabs, timeline, 64-cell Studio grid, persistent player, charts, sliders, tooltips and sheets. Automated axe scans and viewport captures are valuable but cannot prove full keyboard and screen-reader usability.

## Decision proposed

Target WCAG 2.2 AA across essential flows, not just static pages. Support keyboard, touch, speech and screen-reader use, 200%/400% zoom as applicable, orientation and reduced motion. Make dragging alternatives and target sizing first-class constraints.

## Experience and frontend architecture

- Audit contrast, focus not obscured, focus order, accessible names, error association, status announcements and touch/pointer targets. WCAG 2.2 target size minimum is 24x24 CSS px subject to specified exceptions; Selecta should normally aim for larger targets for touch comfort.

- Create accessible navigation for the multi-part shell, dialog focus, lists, waveform slider, editor reorder, Request bridge and Studio grid. Offer non-drag operations for every essential drag action. Zoom reflow must not require two-dimensional scrolling outside inherently 2D workspaces.

- Record manual NVDA/VoiceOver/TalkBack and keyboard passes; an axe scan alone never marks Verified. Ensure localized text and changing announcements do not cause endless live-region noise.

## Detailed implementation work

1. **S3-0067-01 - Implemented.** Specify WCAG 2.2 AA inventory for every route/overlay and an applicability matrix with exceptions. **Evidence:** docs/adr/selecta-3-accessibility.md 'How each criterion applies' (WCAG 2.2 AA criteria, where each applies and how it is met, with the Studio grid's 2D scrolling as the stated exception in 'Known limitations'); tests/test_s3_docs_contracts.py test_the_accessibility_inventory_and_person_scripts_cover_the_named_journeys (passed 2026-11-11).
2. **S3-0067-02 - Implemented.** Create focus and screen-reader test scripts for first-run, playback, editing, requests, Studio and export. **Evidence:** docs/adr/selecta-3-accessibility.md 'Scripts for a person' (first run, playback, editing, requests, Studio, export and zoom, with NVDA, VoiceOver and TalkBack and what to record); tests/test_s3_docs_contracts.py test_the_accessibility_inventory_and_person_scripts_cover_the_named_journeys. Running them is S3-0067-08 (passed 2026-11-11).
3. **S3-0067-03 - Implemented.** Audit and fix every essential target below 24x24 or without adequate exceptions; choose comfortable 44px-class controls where useful. **Evidence:** web/e2e/mp-0298-responsive-and-a11y.e2e.ts 'MP-0298-03 every target meets 24px or a WCAG exception, and primary touch targets reach 44px'; web/e2e/s3-editor-targets.e2e.ts 'insertion targets are at least 24px and say where the song goes, at 375' and 'at 1440' (passed 2026-11-11).
4. **S3-0067-04 - Needs a person.** Ensure non-drag alternatives for reorder and every pointer gesture; include touch switch and keyboard testing. **Status:** Needs a person: a touch and switch-access session on a real device; the non-drag way to reorder exists and passes by keyboard (web/e2e/finishing.e2e.ts 'reordering with the keyboard moves the song, and focus stays on it', 2026-11-11)
5. **S3-0067-05 - Implemented.** Implement semantic landmark, headings, error association and status announcement contracts. **Evidence:** web/src/shell/Shell.test.tsx 'has a way to skip straight past the navigation' and 'names the page in the title and the breadcrumb, with its parent one step back'; web/src/ui/formControls.test.tsx 'a text field joins its label, help and error to the box'; web/e2e/finishing.e2e.ts 'playing doesn’t flood a screen reader: the song is said once, and the clock never is' (passed 2026-11-11).
6. **S3-0067-06 - Implemented.** Verify dialogs, sheets, menus, tabs, grid, sliders and waveform against relevant ARIA APG patterns. **Evidence:** dialogs and sheets: web/src/ui/controls.test.tsx 'Escape closes them' and 'makes the parent inert during a nested dialog and restores the nested opener'; menus: 'opens, moves with the arrow keys, and closes with Escape, back on its button'; tabs: web/src/ui/polish-components.test.tsx 'has one tab stop, arrow/Home/End selection that moves focus, and a panel labelled by its tab'; sliders and combo box: web/src/ui/formControls.test.tsx 'a slider speaks its value in words' and 'a combobox suggests, moves by arrow key, picks with Enter and closes with Escape'; waveform: web/src/views/Now.test.tsx 'previews the target without seeking until release' and web/src/views/listenSeek.test.tsx 'refuses to seek during a transition and says why'; grid: web/e2e/finishing.e2e.ts 'the full Studio grid works at the smallest size: it scrolls by itself, and the keyboard can reach all of it'; mapped in docs/adr/selecta-3-accessibility.md 'Custom widgets against the ARIA patterns' (passed 2026-11-11).
7. **S3-0067-07 - Implemented.** Test 200%/400% zoom, small viewports, safe areas and visible keyboard focus without hidden controls. **Evidence:** web/e2e/mp-0298-responsive-and-a11y.e2e.ts 'MP-0298-01 every page holds from 320 to 3840px, at both sides of 620 and 760, and in short landscape' and 'MP-0298-02 200% and 400% zoom keep every page actionable, and the Studio has its list form'; web/e2e/finishing.e2e.ts 'the mini-player and bottom bar never overlap, and the last row can always be reached' and 'with an on-screen keyboard up, what’s being typed gets the room' (passed 2026-11-11).
8. **S3-0067-08 - Needs a person.** Run manual assistive-tech sessions and record device/browser/AT versions and remaining limitations. **Status:** Needs a person: NVDA, VoiceOver and TalkBack sessions following docs/adr/selecta-3-accessibility.md 'Scripts for a person', recording device, browser and screen-reader versions and what remains limited
9. **S3-0067-09 - Implemented.** Preserve reduced-motion and non-color-only statuses in dark/light themes. **Evidence:** web/src/ui/controls.test.tsx 'never rely on colour alone'; web/e2e/finishing.e2e.ts 'with reduced motion nothing keeps moving by itself, on any page'; both themes: web/e2e/s3-0077-theme-choice.e2e.ts 'every page passes automatic contrast checks with light chosen while the computer is dark (S3-0077-04/06)' and the dark-chosen case (passed 2026-11-11).

## Preservation and integration constraints

This work must preserve all applicable capabilities in [the existing feature-parity ledger](feature-parity.md): original source music and library data; drafts, user corrections, ratings and preferences; correct current-versus-draft mutation isolation; original routes; honest playable/render readiness; a single audio owner with no unintended stop or overlap; explicit request bridge consent and atomic insertion; accurate revision-bound FLAC; and secure localhost/origin privacy. New dependencies, API fields or native integration require separately reviewed contracts; the design does not itself authorize backend replacement.

## Required tests and edge-case verification (not yet executed)

- Complete primary journeys with keyboard only, NVDA/VoiceOver and supported touch reader.
- Target audit at 320/375 widths, touch controls, editor insertion gaps and overlapping player.
- Zoom 400%, increased text, RTL and focus behind sticky bars, modal scroll traps and tooltip-only content.

General test dimensions: dark and light; initial/populated/empty/partial/refreshing/busy/failed/offline/recovery; 320px–4K; zoom, pointer and keyboard; realistic long/missing/duplicate/RTL metadata; accessibility checks; stale response and race tests; representative local-audio playback where relevant. Existing tests may be adapted to accessible semantics but not deleted or weakened.

## Alternatives, risks and trade-offs

Treat accessibility as a final lint pass: lower immediate effort but exposes architecture defects too late. Build it into primitives and every migrated journey.

## Acceptance and evidence

No unverified accessibility blocker remains in an essential flow; verified task evidence exists beyond automated scans.

Before marking **Implemented**, link implementing PR(s), commit(s), contract tests, component/integration/E2E tests, screenshots and rollback disposition in [the evidence ledger](selecta-3-evidence.md). Before marking **Verified**, additionally record human task testing, assistive technology and audible checks wherever the change affects them. No prospective metric is a completed observation.

## Status history

| Date | Decision | Implementation | Evidence |
|---|---|---|---|
| 2026-11-07 | Proposed | Not started | Documentation-only ADR; no application or test changes |
| 2026-11-08 | Accepted | Not started | Owner accepted all proposed ADRs ([#37](https://github.com/tochi-mba/selecta/pull/37)) |

## References

- [Selecta 3.0 roadmap and ADR status index](selecta-3-roadmap.md)
- [Selecta 3.0 implementation checklist](selecta-3-implementation-checklist.md)
- [Selecta 3.0 verification matrix](selecta-3-verification-matrix.md)
- [Prior feature preservation contract](feature-parity.md)
- [Prior test coverage](test-coverage-matrix.md)
