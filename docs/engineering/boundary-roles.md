# Functional edge roles and measured contrast (FP-0264-01, FP-0264-02)

Every component kind that has an edge, the role that edge plays, the surface it sits on, and the lowest
non-text contrast measured against that surface. Measured by `web/e2e/fp-theme-boundaries.e2e.ts` from the
browser's own computed colours in eight states (Library list, Library with a selected row, Library cards,
a row's "More actions" menu open, the Shape dialog, the Editor, the Workspace, and the transition Inspector
with its tabs), each in Light and in Dark. That run writes the full per-element report as
`fp-0264-boundary-contrast.json` in its output folder. Figures below are from the run of 2026-11-11
(262 edges measured). This is candidate evidence for a reviewer, not an independent sign-off.

Role tokens live in `web/src/styles/tokens.css` (`--edge-interactive`, `--edge-decorative`,
`--edge-selected`, `--edge-error`, `--edge-focus`, `--edge-overlay`); `web/src/styles/boundary-roles.test.ts`
keeps them distinct and at least 3:1 on every surface.

| Component | Role | Essential (3:1 required) | Lowest measured, Light | Lowest measured, Dark |
|---|---|---|---|---|
| Text field (search, names, numbers) | interactive edge | yes | 5.20 | 3.42 |
| Dropdown (`select`) | interactive edge | yes | 5.20 | 3.42 |
| Selected item (row, pressed toggle, current page tab link, chosen menu item) | selected edge / marker | yes | 12.99 | 13.43 |
| Chosen tab (Inspector) | selected edge / marker | yes | 14.29 | 15.87 |
| Keyboard focus ring | focus edge | yes | 3:1 or more, checked per state by the FP-0264-05 test | same |
| Invalid field | error edge plus inset bar | yes | 3:1 or more, checked by the FP-0264-05 test | same |
| Checkbox and radio | browser-drawn | exempt: painted by the browser in its own contrast-safe colours | - | - |
| Library row, card and menu item | text-named | exempt: identified by their own words (WCAG 1.4.11) | 1.20 | 1.05 |
| Unchosen tab | text-named | exempt: identified by its words; the chosen tab carries the marker | 1.00 | 1.00 |
| Dialog edge | overlay edge | exempt, see below | 2.21 | 3.11 |
| Menu edge | overlay edge | exempt, see below | 2.43 | 2.88 |
| Row and section dividers | decorative | exempt: decoration only | - | - |

**Overlay exemptions, for the reviewer (FP-0264-08).** A dialog or menu is told apart from the page
behind it by its raised surface, its shadow and the `--edge-overlay` line together, and everything inside
it is named by text. That line is deliberately gentle (MP-0276-06, a newer decision this programme does
not undo). In Light the line alone measures 2.21 (dialog) and 2.43 (menu). These are the two edges a
reviewer should accept or reject with a reason; no essential edge measures under 3:1.

Forced colours replace all of these with system colours and solid outlines; see
`web/e2e/flow-forced-colors.e2e.ts` and `web/e2e/mp-0276-surface-depth.e2e.ts` (MP-0276-08).
