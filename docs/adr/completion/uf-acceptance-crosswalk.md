# Unified finish acceptance crosswalk: what code proves, what a person still checks

For UF-0388-02, UF-0388-03 and UF-0389-06. Each row names the automated test that already covers
the code half (file, then the test's own name) and what is left for a person. A row is never a
pass on its own: the person column is what the independent review signs, in
`docs/verification/uf/platform-report.json` and `docs/verification/uf/functional-preservation.json`.
`tests/test_uf_acceptance_crosswalk.py` checks that every cited test still exists under that name.

Written 2026-11-12.

## Component keyboard patterns against the APG (UF-0388-02)

| Pattern | Automated test | Left for a person |
|---|---|---|
| Menu button | `web/src/ui/controls.test.tsx` :: opens, moves with the arrow keys, and closes with Escape, back on its button | Physical keyboard, NVDA and VoiceOver announce the menu and its items |
| Menu button (reverse open) | `web/src/ui/controls.test.tsx` :: opens at the last action on ArrowUp and exposes the controlled menu | Same session |
| Modal dialog | `web/src/ui/controls.test.tsx` :: makes the parent inert during a nested dialog and restores the nested opener | Screen reader reads the dialog name and stays inside it |
| Dialog opener focus | `web/src/ui/sfPaletteFocus.test.tsx` :: opening focuses the search field, and Escape gives focus back to the opener | Same session |
| Tabs | `web/src/ui/polish-components.test.tsx` :: has one tab stop, arrow/Home/End selection that moves focus, and a panel labelled by its tab | Screen reader announces tab position and selected state |
| Combobox | `web/src/ui/formControls.test.tsx` :: a combobox suggests, moves by arrow key, picks with Enter and closes with Escape | Screen reader reads the active option |
| Grid (Studio) | `web/src/views/gp-0261-studio.test.tsx` :: shows all 512 squares as one tab stop and reaches every corner by keyboard | Screen reader reads lane, beat and state per cell |
| Window splitter | `web/src/views/inspectorResize.test.tsx` :: moves with the arrow keys, stops at Home and End | Physical keyboard check |

## WCAG 2.2 AA criteria (UF-0388-03)

| Criterion | Automated test | Left for a person |
|---|---|---|
| 1.3.1 Info and relationships, 4.1.2 Name, role, value | `web/e2e/pages.e2e.ts` :: every page passes the automatic accessibility checks | Screen reader reading of headings, labels and states on every route |
| 1.4.3 / 1.4.11 Contrast | `web/e2e/mp-0298-responsive-and-a11y.e2e.ts` :: MP-0298-05 text meets 4.5:1, large text 3:1 and field edges 3:1 in both themes | Spot check on a real display |
| 1.4.11 Non-text contrast | `web/e2e/fp-theme-boundaries.e2e.ts` :: functional edges reach 3:1 against their real surfaces in Light and Dark (FP-0264-01/02) | Same |
| 1.4.10 Reflow | `web/e2e/mp-0298-responsive-and-a11y.e2e.ts` :: MP-0298-02 200% and 400% zoom keep every page actionable, and the Studio has its list form | Real browser zoom at 400% |
| 2.4.7 Focus visible | `web/src/styles/sfStateConsistency.test.ts` :: gives every native control the same focus ring in the focus colour | Physical keyboard walk of every route |
| 2.4.11 Focus not obscured | `web/e2e/uf-0387-responsive.e2e.ts` :: UF-0387-01/03 every page holds across the UF viewport matrix, with nothing hidden under fixed chrome | On-screen keyboard on a real phone |
| 2.5.7 Dragging movements | `web/src/views/ufEditorReorder.test.tsx` :: moves a song up with the keyboard handle, keeps focus on it, and offers Undo | Touch-only check on a real phone |
| 2.5.8 Target size (minimum) | `web/e2e/mp-0298-responsive-and-a11y.e2e.ts` :: MP-0298-03 every target meets 24px or a WCAG exception, and primary touch targets reach 44px | Review of the named exceptions |
| 4.1.3 Status messages | `web/src/shell/s4AttentionAnnounce.test.tsx` :: a blocker that appears while Library is open is said in the live region | Screen reader long session (UF-0388-07) |
| 2.3.3 / 2.2.2 Motion | `web/src/views/ufOperations.test.tsx` :: turns page animations off under reduced motion even when Expressive is chosen | Sensory review with reduced motion on |
| 1.4.1 Use of colour | `web/e2e/uf-0388-states.e2e.ts` :: UF-0388-04 planned, ready, failed and selected keep their words under forced colours and grayscale | Spoken output of each state |

## Functional preservation (UF-0389-06)

| Invariant | Automated test | Left for a person |
|---|---|---|
| No unsolicited Pause | `web/e2e/mp-0284-listen.e2e.ts` :: MP-0284-08 moving around and changing what is shown never restarts the music or undoes Pause | Manual listen through a normal session |
| One player | `web/e2e/listen.e2e.ts` :: only one tab plays at a time | Same |
| Exact IDs | `web/src/player.test.ts` :: keeps the later occurrence when the same recording appears twice | Manual check with a real library's duplicate titles |
| Consent | `web/e2e/mp-0290-requests.e2e.ts` :: MP-0290-04 the extra songs and their order are spelled out before consent | Manual bridge request |
| No false ready-only | `web/src/test/operations.test.ts` :: render fixtures map onto the shared work vocabulary, and only ready is success | Manual check of a partly analysed library |
| No false ready-only (ideas) | `web/src/views/ex-0118-metadata.test.tsx` :: an idea that is not ready is listed with what it needs, and offers no Play | Same |
| Frozen FLAC revision | `web/e2e/integration.e2e.ts` :: editing a draft during export keeps the job pinned to its original revision | Play back a real exported FLAC |
| Decodable FLAC | `tests/test_export_validation.py` :: test_bad_or_wrong_export_cannot_be_reported_ready | Same |
