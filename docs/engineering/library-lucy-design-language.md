# Library and Lucy: shared design language (ADR-0364)

Library (`web/src/views/Library.tsx`) and Lucy (`web/src/views/Lucy*.tsx`, styles in
`web/src/styles/lucy.css`) reuse the app's tokens from `web/src/styles/tokens.css`. Neither area
defines its own colours, type sizes or spacing. This page records which tokens each area uses, and
where each is allowed. `web/src/styles/lx-design-language.test.tsx` keeps it true.

## Tokens and their scope (LX-0364-01)

| Role | Tokens | Where they apply |
|---|---|---|
| Type | `--type-section`, `--type-counter`, `--text-md`, `--text-sm`, `--text-xs`, `--body`, `--mono` | Section and thread titles use `--type-section`; counts use `--type-counter` (tabular figures); song facts and hints use `--text-sm`/`--text-xs`. Display headings come from the shared `.display` classes, never from Lucy's own CSS. |
| Spacing | `--space-hair`, `--space-dense`, `--space-snug`, `--space-1`, `--space-2`, `--space-3`, `--space-4`, `--space-5`, `--space-6`, `--icon-gap`, `--grid-bar-gap` | As in `docs/engineering/spacing-token-map.md`. Lucy adds no raw lengths for gaps or padding. |
| Surfaces | `--surface`, `--surface-raised`, `--surface-control`, `--surface-selected`, `--surface-overlay`, `--surface-scrim` | Page, cards and messages, controls, the selected song or seam, sheets and dialogs. |
| Ink and depth | `--text`, `--text-soft`, `--marker`, `--primary-ink`, `--primary-fill`, `--primary-edge`, `--shadow-raised`, `--shadow-overlay` | Body text and quieter hints; list markers; the one filled "Playing" pill; raised cards and overlays only. |
| Edges | `--border`, `--border-strong`, `--edge-interactive`, `--edge-overlay`, `--radius-hair`, `--radius-sm`, `--radius`, `--radius-pill` | Cards and messages use `--border` and `--radius`; chips use `--radius-pill`. |
| Focus and selection | `--focus`, `--selected` | Focus rings come from the shared `:focus-visible` rule; Lucy's tabs and selected rows mark selection with `--selected` plus `aria-selected`/`aria-pressed`. |
| Status | `--status-ready`, `--status-working`, `--status-warning`, `--status-failed`, `--status-request`, `--status-action` | Only through the `Status` component and the lifecycle pill, which always carry words (see below). |
| Layout | `--header-block`, `--bottom-chrome`, `--keyboard-inset`, `--control-height`, `--layer-sticky` | Sticky panes stop above the mini-player and nav (`--bottom-chrome`) and the phone keyboard (`--keyboard-inset`). |

Scope boundaries: Lucy's selectors all start with `.lucy` or sit under `.page.lucy`; Library's start
with `.library`. Neither area restyles the other or the shared shell.

## Song identity (LX-0364-02)

A song looks the same wherever it appears: its `SongMotif` (`web/src/ui/MusicObjects.tsx`), drawn
only from the recording id, then title and artist. There is no artwork, real or invented. In Lucy a
song row is also known by its occurrence id, so the same recording twice is two rows.

## States in words and shape, never colour alone (LX-0364-04)

| State | Words | Non-colour cue |
|---|---|---|
| Ready | "Ready", "Ready to play" | check mark |
| Planned | "Planned", "Not rendered yet" | open circle |
| Working | "Working on it", "Working", "Rendering" | half circle; a moving bar only while work is really running |
| Blocked / failed | "Blocked", "Didn’t work", "Failed" | warning or cross mark |
| Proposed | "Proposed - not built" | dashed outline |
| Saved | "Saved draft" | solid outline |
| Playing | "Playing" | filled pill |

## Motion (LX-0364-06)

Lucy has one animation: the indeterminate bar on a step that is running with no count to show. It
appears only for real running work, never for decoration, and both the app's Still setting
(`:root[data-motion='still']`) and the system's reduced-motion setting remove it. The step keeps its
words ("Working"). Progress bars resize with `--motion-reveal` and `--motion-ease`; the duration is 0 ms under Still and reduced
motion. Nothing else in Lucy or the Library moves on its own.
