# Fixed and sticky layers, and what yields to what

All stacking uses the layer tokens in `web/src/styles/tokens.css`; all bottom space is computed once
as `--bottom-chrome` (navigation + player) plus `--keyboard-inset` and `--safe-bottom`.

## Inventory

| Layer | Selector (file) | Position | z-index token | Typical size |
|---|---|---|---|---|
| Skip link | `.skip-link` (`shell.css`) | fixed, on focus | `--layer-toast` (60) | one line |
| Editor scope bar (current vs draft) | `.editor-scope` (`creation.css`) | sticky below the context bar | `--layer-sticky` (5) | one row |
| Inspector pair identity; Studio head | `.inspector-identity`, `.studio-head` (`creation.css`) | sticky inside their panels | 1 / `--layer-sticky - 1` | one row |
| Studio ruler and lane names | `.studio-ruler`, `.studio-name` (`creation.css`, `polish.css`, `style.css`) | sticky top/left inside the grid scroller | 1–4 (local) | one row / one column |
| Listen side column | `.listen-side` (`listening.css`) | sticky below the header | none | column |
| Listen narrow transport | `.now .transport` (`listening.css`, ≤ 760 px) | sticky above `--bottom-chrome` | `--layer-sticky` | transport row |
| Context bar | `.context-bar` (`shell.css`) | sticky top | `--layer-header` (10) | `--header-height` 56 / 48 px |
| Navigation rail / bottom bar | `.nav` (`shell.css`) | fixed left (wide) or bottom (≤ 760 px) | `--layer-nav` (20) | 212 / 72 px wide; 58 px + safe area tall |
| Mini-player | `.mini` (`shell.css`) | fixed bottom, above the bottom bar | `--layer-player` (30) | 66 px |
| Toasts | `.toasts` (`shell.css`) | fixed bottom-right above bottom chrome | `--layer-sheet` (40) | ≤ 3 cards |
| Popovers and menus | `.popover-panel` (`foundation.css`), `.menu-list` (`shell.css`) | absolute to trigger | `--layer-sheet` (40) | content |
| Drawers and sheets | `.overlay` drawer/sheet variants (`shell.css`) | fixed | `--layer-dialog` (50) | side or bottom panel |
| Dialogs | `.overlay` (`shell.css`) | fixed, inert background | `--layer-dialog` (50) | centred panel |
| Tooltips | `shell.css` line 505 | absolute | `--layer-toast` (60) | one line |
| Stage controls | `.stage-controls` (`listening.css`), `.exit-stage` (`style.css`) | fixed bottom-right | none (Stage removes all other chrome) | buttons |

## Precedence

| Situation | Stays | Yields (hidden or reflowed) | Why it is safe |
|---|---|---|---|
| On-screen keyboard open (`data-keyboard='open'`) | the focused field, its dialog's submit/cancel | bottom navigation, mini-player and toasts are visually hidden; `--keyboard-inset` pads scrolling | the player is only hidden, never paused; toasts remain in Activity |
| Stage (`data-stage='on'`) | lyrics, Stage controls, Escape | rail, header, bottom bar, mini-player, toasts | audio owner unchanged; leaving Stage restores focus |
| Dialog or drawer open | the dialog (focus trapped, background inert) | toasts sit below dialogs (`--layer-sheet` < `--layer-dialog`) | a notice can never cover a consent or destructive confirmation |
| Dialog + keyboard | dialog body scrolls (`scroll-padding-block`), footer actions reachable | everything else | `web/e2e/overlay-arbitration.e2e.ts` |
| Menu inside a sheet | menu over the sheet | - | Escape closes the menu first, then the sheet (`web/src/ui/controls.test.tsx` "does not swallow a dialog Escape when its menu is closed") |
| Mini-player + bottom bar + last list row | all three | page gets `--bottom-chrome` bottom padding | `web/e2e/finishing.e2e.ts` "the mini-player and bottom bar never overlap, and the last row can always be reached" |
| Toast burst | newest notices, any Undo | routine repeats coalesce | Undo is never pushed out (`web/src/ui/controls.test.tsx`) |

Measured by: `web/e2e/overlay-arbitration.e2e.ts` (geometry and hit-testing of dialog actions at
320×568, 375×667 and 1280×600; chrome yielding to a software keyboard) and `web/e2e/pages.e2e.ts`
("on a phone, nothing you can press sits half hidden behind the player, at any height").
