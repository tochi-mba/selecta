# Motion inventory (ADR-296)

Every moving thing in the site, what sets it off, which token times it, and what happens under the
Still preference or the computer's reduced-motion setting. `web/src/styles/motion-tokens.test.ts`
fails when a stylesheet adds a duration that is not a motion token or a listed exception, or a
`@keyframes` name that is not in this file.

## Tokens and their purposes

Defined in `web/src/styles/tokens.css`. Subtle shortens each one; Still and reduced motion set
every token to 0ms.

| Token | Default | Purpose |
| --- | --- | --- |
| `--motion-feedback` | 80ms | Direct feedback to a press: a toggle or pressed colour that must feel instant. Reserved; nothing uses it yet. |
| `--motion-fast` | 120ms | Hover and focus colour, border and background changes on controls, chips and cards. |
| `--motion-reveal` | 160ms | Content arriving in place: route reveal, skeleton reveal, toasts, the lyric line taking focus, Lucy progress. |
| `--motion-handoff` | 200ms | One group handing over to the next: vibe groups appearing on Make a Mix. |
| `--motion-overlay` | 220ms | A dialog, sheet or drawer opening over the page. |
| `--motion-slow` | 240ms | The longest considered movement, for a large surface. Reserved; nothing uses it yet. |

## Animated surfaces and their triggers

| Surface | Trigger | Motion | Timing | Still / reduced motion |
| --- | --- | --- | --- | --- |
| Buttons and links | hover, focus | colour, border, background (no transform, so a pressed control never moves) | `--motion-fast` | instant |
| Busy button | an `Action` is running | `button-working` pulse | 0.9s loop, exception | none |
| Chips, cards, vibe tempo | hover, focus, selection | colour and border | `--motion-fast` | instant |
| Listen side cards | selection | border and shadow | `--motion-fast` | instant |
| Dialog, sheet, drawer | opened | `overlay-appear` | `--motion-overlay` | none |
| Toast | shown | `toast-appear` | `--motion-reveal` | none |
| Route | page change | `route-reveal` | `--motion-reveal` | none |
| Skeleton | loading | `skeleton-reveal` after `--motion-fast`, then `skeleton-breathe` 3 times | reveal token; breathe 1.4s exception | none |
| Vibe groups | Make a Mix loads | `feeling-reveal` | `--motion-handoff` | none |
| Request pill | a request is working | `request-pulse` | 1.8s loop, exception | none |
| Pending line | a render is in line | `pending-flow` | 2.4s loop, exception | none |
| Lucy progress | Lucy is working | `lucy-slide` when the length is unknown; width when known | 1.6s loop exception; `--motion-reveal` | none |
| Drag in the editor | dragging a song | drop line follows the pointer, no transition | pointer | unchanged (it is the pointer) |
| Spectrum visualizer | playing on Listen | canvas redrawn from the analyser | at most 15fps, stops when hidden or off screen | one still frame |
| Lyric focus | the player clock | current line and word colour | `--motion-reveal` | instant, still follows the clock |
| Hand-over progress | the player clock | width follows the transition | 70ms linear, exception: it tracks the clock tick | instant, still follows the clock |
| Countdown, playhead, beat pips | the player clock | position set from player time each tick, no transition | clock | unchanged (it is data) |

## Exceptions to the tokens

These keep raw durations on purpose. Each is an ambient loop that says something is still going, or
follows the player clock.

- `button-working` 0.9s, `skeleton-breathe` 1.4s, `lucy-slide` 1.6s, `request-pulse` 1.8s, `pending-flow` 2.4s: loops, longer than any token by design.
- `.handoff-progress i` width 70ms linear: smooths the gap between clock ticks; a token would lag the music.

## Keyframes

`pending-flow`, `request-pulse`, `lucy-slide`, `feeling-reveal`, `skeleton-reveal`, `toast-appear`,
`overlay-appear`, `route-reveal`, `skeleton-breathe`, `button-working`.
