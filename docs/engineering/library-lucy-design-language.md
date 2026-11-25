# Library and Lucy: shared design language (ADR-0364)

Library (`web/src/views/Library.tsx`) and Lucy (`web/src/views/Lucy*.tsx`, styles in
`web/src/styles/lucy.css`) reuse the app's tokens from `web/src/styles/tokens.css`. Neither area
defines its own colours, type sizes or spacing. This page records which tokens each area uses, and
where each is allowed. `web/src/styles/lx-design-language.test.tsx` keeps it true.

## Tokens and their scope (LX-0364-01)

| Role | Tokens | Where they apply |
|---|---|---|
| Type | `--type-section`, `--type-counter`, `--type-label`, `--type-caption`, `--text-md`, `--text-sm`, `--text-xs`, `--body`, `--mono` | Section and thread titles use `--type-section`; counts use `--type-counter` (tabular figures); who said a message uses `--type-label` and its time `--type-caption`; song facts and hints use `--text-sm`/`--text-xs`. Display headings come from the shared `.display` classes, never from Lucy's own CSS. |
| Spacing | `--space-hair`, `--space-dense`, `--space-snug`, `--space-1`, `--space-2`, `--space-3`, `--space-4`, `--space-5`, `--space-6`, `--icon-gap`, `--grid-bar-gap` | As in `docs/engineering/spacing-token-map.md`. Lucy adds no raw lengths for gaps or padding. |
| Surfaces | `--surface`, `--surface-raised`, `--surface-control`, `--surface-selected`, `--surface-overlay`, `--surface-scrim` | Page, cards and messages, controls, the selected song or seam, sheets and dialogs. |
| Ink and depth | `--text`, `--text-soft`, `--marker`, `--primary-ink`, `--primary-fill`, `--primary-edge`, `--shadow-raised`, `--shadow-overlay` | Body text and quieter hints; list markers; the one filled "Playing" pill; raised cards and overlays only. |
| Edges | `--border`, `--border-strong`, `--edge-interactive`, `--edge-overlay`, `--radius-hair`, `--radius-sm`, `--radius`, `--radius-pill` | Cards and messages use `--border` and `--radius`; chips use `--radius-pill`. |
| Focus and selection | `--focus`, `--selected` | Focus rings come from the shared `:focus-visible` rule; Lucy's tabs and selected rows mark selection with `--selected` plus `aria-selected`/`aria-pressed`. |
| Status | `--status-ready`, `--status-working`, `--status-warning`, `--status-failed`, `--status-request`, `--status-action` | Only through the `Status` component and the lifecycle pill, which always carry words (see below), and Lucy's usage (ADR-0484): the full meter's near and spent lines and the twin level meter's ladders use `--status-warning` and `--status-failed`, always with a mark, an outline or words as well, because the two tokens are one colour. The next-step block at a limit (ADR-0483) carries `--status-action` down its start edge. |
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
| Lucy usage, nearly used up | "Nearly used up", with "N% left" | warning mark on the full meter; a marker above that ladder on the twin level meter |
| Lucy usage, used up | "Used up", with "0% left" | minus mark on the full meter; that ladder drawn empty inside a dashed outline |

## Motion (LX-0364-06)

Lucy has one loop: the indeterminate bar on a step that is running with no count to show. It
appears only for real running work, never for decoration, and both the app's Still setting
(`:root[data-motion='still']`) and the system's reduced-motion setting remove it. The step keeps its
words ("Working"). The slide's length is `--motion-loop-slide`. Progress bars resize with `--motion-reveal` and `--motion-ease`; the duration is 0 ms under Still and reduced
motion. A message's time fades in over `--motion-fast` when it is pointed at or focused, with no transition under Still and reduced motion. Nothing else in Lucy or the Library moves on its own.

### The feel (ADR-0477, plan 3.9)

Everything below is scoped to `:where(:root[data-feel~='motion'])` or `:where(:root[data-feel~='depth'])`
inside `.lucy`, so with the `app.feel_*` flags off, Still, reduced motion or low power none of it
exists. Each animation runs once, ends at the element's resting look, and answers something real.

| What | Trigger (real) | How | Tokens |
|---|---|---|---|
| Your message rises | the stand-in under the box after Send, or words sent from another device | `.lucy-msg.is-rise article`, `feel-lucy-rise` (arrives) | `--motion-spring-snappy`, `--spring-snappy`, `--space-5` |
| Lucy's message fades in | a reply that started while the page was open | `.lucy-msg.is-fade`, `feel-lucy-fade` (arrives) | `--motion-slow`, `--motion-ease` |
| Streamed chunk fades in | each `message.delta` that grew the reply; only the newest chunk is wrapped | `.lucy-chunk`, `feel-lucy-fade` (arrives) | `--motion-slow`, `--motion-ease` |
| The running step's name | the title of the step card Lucy is running for that turn, from `step.*` events; "Thinking…" when there is none | `.lucy-thinking-words`, `feel-lucy-shimmer`, one pass, replayed only when the step changes (answers you) | `--text-soft`, `--text`, `--motion-slow`, `--motion-ease` |
| The box lights while written in | focus inside the composer | `transition` on `box-shadow` (depth) | `--shadow-lift`, `--edge-light`, `--motion-fast`, `--motion-ease` |
| A step's result draws in | a card seen running that reached `completed` | `.lucy-visual.is-drawn > *`, shared `feel-arrive` | `--motion-spring-snappy`, `--spring-snappy` |
| An added song glows | an occurrence the new current revision added | `.lucy-song.feel-flash`, shared `feel-flash` with `feel-lucy-edge` (arrives) | `--motion-slow`, `--motion-ease`, `--marker`, `--selected` |
| Saved tick | a save confirmed on this page that the server says went through | `.lucy-saved-tick` with the shared `.feel-tick` | `--icon-size`, `--icon-stroke`, `--status-ready` |

The shared asks from `web/src/styles/feel.css` are used as they are: new step groups and notes
`data-arrive`; opened plan cards and example prompts `data-stagger`; example prompts `data-lift`;
history, memory and settings rows `data-lift="row"`; the "Lucy is turned off" and gone-conversation
cards `data-glow` and `data-arrive`; Stop, "New messages" and saved words `.feel-pop`; a deleted
conversation `.feel-collapse-out`. A save that went through also asks for the phone's `success()` buzz.
