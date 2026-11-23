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
| `--motion-feedback` | 80ms | Direct feedback to a press, and the quickest exit: a menu, popover or tooltip fading out (`--motion-exit-menu`). |
| `--motion-fast` | 120ms | Hover and focus colour, border and background changes on controls, chips and cards. |
| `--motion-reveal` | 160ms | Content arriving in place: route reveal, skeleton reveal, toasts, the lyric line taking focus, Lucy progress. |
| `--motion-handoff` | 200ms | One group handing over to the next: vibe groups appearing on Make a Mix. |
| `--motion-overlay` | 220ms | A dialog, sheet or drawer opening over the page. |
| `--motion-slow` | 240ms | The longest considered movement, for a large surface: a drawer or sheet sliding in from its side (`drawer-appear`). |

## Animated surfaces and their triggers

| Surface | Trigger | Motion | Timing | Still / reduced motion |
| --- | --- | --- | --- | --- |
| Buttons and links | hover, focus | colour, border, background (no transform, so a pressed control never moves) | `--motion-fast` | instant |
| Busy button | an `Action` is running | `button-working` pulse | 0.9s loop, exception | none |
| Chips, cards, vibe tempo | hover, focus, selection | colour and border | `--motion-fast` | instant |
| Listen side cards | selection | border and shadow | `--motion-fast` | instant |
| Dialog, sheet, drawer | opened | `overlay-appear` (dialog); `drawer-appear` from its side (drawer, sheet) | `--motion-overlay`; `--motion-slow` | none |
| Dialog | closing (`data-closing`) | `dialog-exit` (fade and shrink 2%) with the scrim's `fade-exit` | `--motion-exit-dialog` | reduced: `fade-exit` 120ms; Still: none |
| Drawer, sheet | closing (`data-closing`) | `drawer-exit` back out of its side, scrim `fade-exit` | `--motion-exit-drawer` | reduced: `fade-exit` 120ms; Still: none |
| Menu, popover, tooltip | opened (`data-motion='pop'`); closing | `pop-appear`; `fade-exit` | `--motion-fast`; `--motion-exit-menu` | reduced: exit `fade-exit` in the sheet, but cut short in practice (see [Known gap](#known-gap)); Still: none |
| Toast | shown | `toast-appear` | `--motion-reveal` | none |
| Toast | closing (`data-closing`) | `toast-exit` (fade and drop 4px) | `--motion-exit-toast` | reduced: `fade-exit` 120ms; Still: none |
| Route | page change | `route-reveal` | `--motion-reveal` | none |
| Skeleton | loading | `skeleton-reveal` after `--motion-fast`, then `skeleton-breathe` 3 times | reveal token; breathe 1.4s exception | none |
| Vibe groups | Make a Mix loads | `feeling-reveal` | `--motion-handoff` | none |
| Request pill | a request is working | `request-pulse` | 1.8s loop, exception | none |
| Pending line | a render is in line | `pending-flow` | 2.4s loop, exception | none |
| Lucy progress | Lucy is working | `lucy-slide` when the length is unknown; width when known | 1.6s loop exception; `--motion-reveal` | none |
| Meter (`ui/Meter`) | the value changes; no value known | fill width follows the value; indeterminate fill runs `lucy-slide` | `--motion-reveal`; `--motion-loop-slide` 1.6s loop | none; the words still say the value |
| Drag in the editor | dragging a song | drop line follows the pointer, no transition | pointer | unchanged (it is the pointer) |
| Spectrum visualizer | playing on Listen | canvas redrawn from the analyser | at most 15fps, stops when hidden or off screen | one still frame |
| Lyric focus | the player clock | current line and word colour | `--motion-reveal` | instant, still follows the clock |
| Hand-over progress | the player clock | width follows the transition | 70ms linear, exception: it tracks the clock tick | instant, still follows the clock |
| Countdown, playhead, beat pips | the player clock | position set from player time each tick, no transition | clock | unchanged (it is data) |

## Cloud, Rooms, devices and the other surfaces

The hosted Cloud pages (in the shared shell with `cloud.hosted_shell` on, or in the legacy rail with it off), the local-first Cloud shell, Rooms hosting and the devices list move only through the shared parts above: the shared shell's route reveal, `Dialog`, `Drawer`, `Sheet` and `ConfirmDialog` (open and exit), `Menu`, `Popover` and `Tooltip` (pop-in and exit), toasts (appear and exit), `Action`'s busy line, `Skeleton` and `Meter`. `cloud/cloud.css`, `rooms/rooms.css` and `devices/devices.css` define no animation, transition or keyframe of their own; `motion-tokens.test.ts` scans them with the app's sheets, so one added later has to be a token and a row here.

Outside that scan, the remaining feature sheets keep motion to almost nothing:

| Sheet | Motion | Still / reduced motion |
| --- | --- | --- |
| `venueops/staffDashboard.css` | Staff buttons and Stop change background at `--motion-fast`, only under `prefers-reduced-motion: no-preference` | none |
| `business/business.css`, `business/staff/staff.css` | No animation of their own; each resets animation and transition inside `.biz` and `.biz-staff` | reset under reduced motion and Still |
| `guest/guest.css` | Its own small set, timed by copies of the app's tokens (`palette-drift.test.ts` keeps the copies equal): buttons squeeze and change colour on a press (`--motion-feedback`, `--motion-fast`); a working button runs `g-working` under its label (0.9s loop); cards, rows and banners arrive with `g-settle` and the notice slides up (`--motion-reveal`); a check draws in with `g-draw` and a vote pops with `g-pop` (`--motion-slow`); a request whose status changed is lit by `g-flash`; outline rows and the waiting dot breathe with `g-breathe` (1.4s and 1.8s loops); the now-playing bars rise and fall with `g-eq` while music plays; a chosen row pops its check and its count badge bumps (`g-pop`, `g-bump`), a tap that cannot add a song shakes the row (`g-no-a`, `g-no-b`), the bar of chosen songs and the connection banner slide in (`--motion-handoff`), and a waiting ring turns with `g-turn` (0.9s loop) | every transition and animation is reset; each keyframe only animates from a start state, so the resting state shows |
| `display/display.css` | A line that is new (the next song, a new request, the reconnecting note) arrives with `d-arrive` (twice `--motion-slow`); the whole picture drifts under 1% of the screen over five minutes with `d-drift`, so a TV left on never holds one bright shape in place; the now-playing bars rise and fall with `d-eq` while music plays and the reconnecting ring turns with `d-turn` (0.9s loops) | every animation is reset |

## Known gap

`Menu`, `Tooltip` (`ui/controls.tsx`) and `Popover` (`ui/primitives.tsx`) give `usePresence` the `--motion-fast` token for the exit fallback timeout instead of `--motion-exit-menu`. Under OS reduced motion `--motion-fast` is 0ms, so the timeout removes them before the 80ms swap fade can play; with full motion the fallback is longer than the 80ms exit and the exit plays. Dialogs, drawers, sheets and toasts use their exit tokens and fade as documented. Tracked by ADR-0468 BF-0468-04.

## Exceptions to the tokens

These are longer or shorter than the six tokens on purpose. Each is an ambient loop that says something is still going, or
follows the player clock. Their lengths are named tokens in `tokens.css` (`--motion-loop-*`, `--motion-clock`), so no sheet holds a raw duration.

- `button-working` 0.9s, `skeleton-breathe` 1.4s, `lucy-slide` 1.6s, `request-pulse` 1.8s, `pending-flow` 2.4s: loops, longer than any token by design.
- `.handoff-progress i` width 70ms linear: smooths the gap between clock ticks; a token would lag the music.

## Keyframes

`pending-flow`, `request-pulse`, `lucy-slide`, `feeling-reveal`, `skeleton-reveal`, `toast-appear`,
`overlay-appear`, `route-reveal`, `skeleton-breathe`, `button-working`, `drawer-appear`, `pop-appear`,
`fade-exit`, `dialog-exit`, `drawer-exit`, `toast-exit`.

Kiosk `k-slide` is a waiting indicator while music is prepared; the dedicated sheet disables it under reduced motion. The playing motif is static.
