# Layer precedence: what sits on top of what (FP-0270-01, FP-0270-02)

Every fixed or sticky layer in the app, the stacking token it uses, and what yields when several are on
screen at once. The stacking tokens live in `web/src/styles/tokens.css` (`--layer-*`); nothing outside a
component's own internals uses a raw `z-index` number. The tables below are machine-checked:
`web/src/styles/layer-precedence.test.ts` reads every row and fails if the stylesheet disagrees.

## Stacking tokens, lowest first

`--layer-sticky` 5 < `--layer-header` 10 < `--layer-nav` 20 < `--layer-player` 30 < `--layer-sheet` 40 < `--layer-dialog` 50 < `--layer-toast` 60

## Layer inventory

Representative dimensions are the shell's own numbers from `tokens.css`: header 56px (48px under 760px),
phone tab bar `--nav-height` plus the safe area, mini-player 66px (`--player-height` while `data-player='on'`),
rail 212px open / 72px collapsed.

| Layer | Selector | File | Token | Position and size |
|---|---|---|---|---|
| Skip link | `.skip-link` | `shell.css` | `--layer-toast` | fixed; off screen until focused, then above everything so it is always seen |
| Shell rail / phone tab bar | `.nav` | `shell.css` | `--layer-nav` | fixed; left rail 212px/72px wide on desktop, bottom tab bar under 760px |
| Page header (context bar) | `.context-bar` | `shell.css` | `--layer-header` | sticky top; 56px, 48px on phones |
| Mini-player | `.mini` | `shell.css` | `--layer-player` | fixed above the tab bar; 66px |
| Notices (toast stack) | `.toasts` | `shell.css` | `--layer-sheet` | fixed bottom-right above the player and tab bar; max 42dvh, scrolls |
| Menus | `.menu-list` | `shell.css` | `--layer-sheet` | absolute under its button; max 65dvh, scrolls |
| Popovers | `.popover-panel` | `foundation.css` | `--layer-sheet` | absolute under its button; max 360px wide |
| Dialog, drawer and sheet | `.overlay` | `shell.css` | `--layer-dialog` | fixed, whole viewport, with the scrim; panel scrolls inside |
| Tooltip | `.tooltip` | `shell.css` | `--layer-toast` | absolute beside its anchor; a label only, never a control |
| Editor scope bar | `.editor-scope` | `creation.css` | `--layer-sticky` | sticky under the header in the Editor |
| Listen transport (phones) | `.now .transport` | `listening.css` | `--layer-sticky` | sticky above the bottom chrome under 760px |
| Stage controls | `.stage-controls` | `listening.css` | `--layer-sticky` | fixed bottom-right on the Stage, inside the safe area |
| Lucy tabs | `.lucy-tabs` | `lucy.css` | `--layer-sticky` | sticky top of Lucy's side panel |
| Lucy composer | `.lucy-dock` | `lucy.css` | `--layer-sticky` | sticky bottom above the player, tab bar and keyboard |

The Stage (`.now.stage`) is not a layer of its own: it turns the shell's frame off with `data-stage='on'`.

## Precedence when layers meet

The rule: the task in front of the person wins, secondary chrome yields, and nothing that yields changes
what is playing. Each row names the CSS that makes it so.

| Situation | What yields | What stays | Made so by |
|---|---|---|---|
| Software keyboard + player + tab bar (phone) | tab bar and mini-player hide; notices hide | the focused field, its dialog and its actions | `:root[data-keyboard='open'] .nav, :root[data-keyboard='open'] .mini { display: none; }` |
| Software keyboard + notices | notices hide visually but stay in the DOM and the live region | the field being typed in | `:root[data-keyboard='open'] .toasts, :root[data-stage='on'] .toasts {` |
| Software keyboard + bottom chrome reservations | the reserved tab-bar and player heights drop to zero | the page's own scroll room | `:root[data-keyboard='open'] { --nav-bottom: 0px; --player-height: 0px; }` |
| Software keyboard + dialog (phone) | the dialog pads itself above the keyboard | the dialog's body scrolls; title and actions stay | `padding-bottom: max(var(--keyboard-inset), var(--safe-bottom));` |
| Stage + notices | notices hide visually | the Stage and its own controls | `:root[data-keyboard='open'] .toasts, :root[data-stage='on'] .toasts {` |
| Stage + shell frame | rail, header, tab bar and mini-player reservations drop to zero | Stage controls, inside the safe area | `:root[data-stage='on'] { --rail-offset: 0px; --nav-bottom: 0px; --player-height: 0px; --header-height: 0px; }` |
| Dialog + notices | a notice sits under the dialog's scrim (sheet < dialog) | the dialog's consent and destructive actions are never covered | `.toasts` on `--layer-sheet`, `.overlay` on `--layer-dialog` |
| Dialog in short landscape | the dialog panel caps at the viewport and scrolls its body | title and actions | `.overlay-dialog .overlay-panel { max-height: calc(100dvh - 2 * var(--space-2)); }` |
| Menu or popover + player | menus open above the player and tab bar (sheet > player > nav) | the menu's items | `.menu-list` and `.popover-panel` on `--layer-sheet` |

Hiding the mini-player or the notices is visual only: no layer in this table pauses, seeks, resumes or
changes the audio owner. That is proven in a browser by `web/e2e/overlay-arbitration.e2e.ts` (dialog,
toast and keyboard geometry) and `web/e2e/finishing.e2e.ts` (focus never covered on every page).
