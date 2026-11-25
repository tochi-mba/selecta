# Motion inventory (ADR-296, ADR-0477)

Every moving thing in the site, what sets it off, which token times it, and what happens under each
step of the comfort ladder. `web/src/styles/motion-tokens.test.ts` fails when a stylesheet it scans
adds a duration that is not a motion token or a listed exception, or a `@keyframes` name that is not
in this file. `web/src/ui/gp-0257-motion.test.ts` files every keyframe in the app by kind.

ADR-0477 (the feel system) changed the house rules this file records:

- Two families. Effects (colour, opacity) use the six duration tokens and `--motion-ease`, and never
  bounce. Spatial changes (position, scale) use the springs and the spring durations.
- Hovering never moves a control, and a press never shrinks its hit area. A pressed button squashes
  to `--press-scale` while an invisible pad keeps its whole resting box clickable, and springs back
  when let go (MP-0296-03 in `web/e2e/mp-0296-motion.e2e.ts` holds both halves).
- Only music moves by itself. Chrome that looks musical is moved by the beat bus
  (`web/src/feel/beatBus.ts`) from a measured kick, onset or analysed grid beat. It is never a CSS
  keyframe and never loops in CSS; `styles/feel-music.css` may hold no `@keyframes` and no `infinite`.
- Every feel rule is scoped to a word in `<html data-feel="...">`, written by `web/src/feel/root.ts`
  from the `app.feel_*` flags and the motion choice. With a flag off, that part of the page is
  exactly as it was before the feel.

## Tokens and their purposes

Defined in `web/src/styles/tokens.css`.

### Effects: colour and opacity

Subtle shortens each one; Still, the second low-power step and reduced motion set every token to 0ms.

| Token | Default | Purpose |
| --- | --- | --- |
| `--motion-feedback` | 80ms | Direct feedback to a press (the squash itself), and the quickest exit: a menu, popover or tooltip fading out (`--motion-exit-menu`). |
| `--motion-fast` | 120ms | Hover and focus colour, border, background and lift shadow on controls, chips and cards; a page being left during a page transition. |
| `--motion-reveal` | 160ms | Content arriving in place: route reveal, skeleton reveal, toasts, the lyric line taking focus, Lucy progress. |
| `--motion-handoff` | 200ms | One group handing over to the next: vibe groups on Make a Mix, the new page arriving in a page transition, a removed row folding away. |
| `--motion-overlay` | 220ms | A dialog, sheet or drawer opening over the page. |
| `--motion-slow` | 240ms | The longest considered movement, for a large surface: a drawer or sheet sliding in from its side (`drawer-appear`); the ambient hue easing to a new song. |

### Spatial: position and scale (ADR-0477)

The curves are springs sampled into CSS `linear()` where the browser can draw them, with a plain
`cubic-bezier` fallback: `--spring-gentle` (no overshoot), `--spring-snappy` (about 4% over) and
`--spring-bouncy` (about 16% over, for a control being released and for celebrations). Overshoot
is never used on playback, timeline drops or dialogs that hold data (ADR-0137).

| Token | Default | Purpose |
| --- | --- | --- |
| `--motion-spring-snappy` | 320ms | An arrival (`feel-arrive`, `feel-pop`) or a card's skin lifting toward the pointer settling into place. |
| `--motion-spring-release` | 420ms | A pressed control springing back to its resting size on `--spring-bouncy` when the pointer lets go. |
| `--motion-spring-glide` | 360ms | A shared thing (a cover, a page title, the palette) travelling between two pages on the gentle spring; the primary action's sheen crossing once. |
| `--motion-stagger` | 30ms | The gap between neighbours arriving one after another under `data-stagger`; it stops growing after the eighth child, so a long list is never slow. |

`--press-scale` is 0.96: how far a pressed control squashes. Its hit area never shrinks.

| Level | Springs | Spring durations | Stagger | `--press-scale` |
| --- | --- | --- | --- | --- |
| Expressive | as above | 320, 420, 360ms | 30ms | 0.96 |
| Subtle, low power `lite` | every spring is `--spring-gentle` | 200, 240, 220ms | 20ms | 0.98 |
| Still, low power `auto`, reduced motion | (no movement) | 0ms | 0ms | 1 |

## The comfort ladder

| Setting | `data-feel` words | Result |
| --- | --- | --- |
| Expressive (the default with `app.feel_motion`) | motion, depth, pointer, music, ambient, moments | Everything in this file. |
| Subtle | motion, depth, music, ambient | Gentle, shorter springs, press 0.98; no pointer light, no celebrations; the beat bus keeps only the player's own targets (ring, edge, bars). |
| Still | depth, ambient | Every duration 0ms and every animation and transition removed (`animation: none !important`); press 1; no page transitions, no beat. Depth (shadows, lit edges) and the ambient tint stay, still. |
| Reduced motion (the computer's setting) | depth, ambient | As Still, except that leaving is swapped for a short fade (dialog, drawer, toast 120ms, menu 80ms) so a closing thing is still seen to go. |
| Low power, first step (`lite`) | motion, depth, moments | Gentle, shorter springs; no pointer light, no beat, no ambient layer, no page transitions, no blur on the overlay scrim. |
| Low power, second step (`auto`) | depth | As Still. |
| Forced colours | unchanged | Shadows, glows, the sheen, the pointer light, beat targets, playing bars and the ambient layer are removed; borders and outlines carry every state. |

Script animations are not stopped by a stylesheet, so every engine in `web/src/feel/` asks
`feelOn()` and `feelCalm()` itself before it animates.

## Animated surfaces and their triggers

| Surface | Trigger | Motion | Timing | Still / reduced motion |
| --- | --- | --- | --- | --- |
| Buttons and links | hover, focus | colour, border, background; with depth a lift shadow and lit edge, and the primary action's sheen crossing once. The box never moves or grows | `--motion-fast`; sheen `--motion-spring-glide` | instant |
| Buttons: press | pointer down, then up | the painted box squashes to `--press-scale` while a pad 2.5% and a pixel past each edge keeps the resting box clickable; letting go springs back on `--spring-bouncy` | press `--motion-feedback`; release `--motion-spring-release` | no squash (`--press-scale` 1) |
| Busy button | an `Action` is running | `button-working` pulse; after the work resolves a drawn tick (`feel-tick-draw`), after it fails a danger edge | 0.9s loop, exception; tick `--motion-slow` | loop none; tick and edge shown at rest |
| Busy button in Cloud (`styles/cloud-ui.css`) | a button is `aria-busy` or `data-working` | a small ring before its words turns (`cloud-spin`) | `--motion-loop-working` 0.9s loop, the same exception as `button-working` | none; the button's words still say it is working |
| Chips, cards, tiles, vibe tempo | hover, focus, selection | colour and border; with `data-lift` the painted skin rises a hair and casts `--shadow-lift`, the card and its buttons never move; with `data-glow` a soft light follows the pointer | `--motion-fast`; skin `--motion-spring-snappy` | instant, no travel; focus still lifts the shadow |
| List rows (`data-lift="row"`) | hover, focus inside | lit top edge only: no travel, no shadow, because rows are hovered hundreds of times a day | instant edge | the same |
| Listen side cards | selection | border and shadow | `--motion-fast` | instant |
| Dialog, sheet, drawer | opened | `overlay-appear` (dialog); `drawer-appear` from its side (drawer, sheet); with the feel, the scrim fades in (`feel-fade-in`) and blurs | `--motion-overlay`; `--motion-slow` | none |
| Dialog | closing (`data-closing`) | `dialog-exit` (fade and shrink 2%) with the scrim's `fade-exit` | `--motion-exit-dialog` | reduced: `fade-exit` 120ms; Still: none |
| Drawer, sheet | closing (`data-closing`) | `drawer-exit` back out of its side, scrim `fade-exit` | `--motion-exit-drawer` | reduced: `fade-exit` 120ms; Still: none |
| Menu, popover, tooltip | opened (`data-motion='pop'`); closing | `pop-appear`; with the feel a menu grows from its button and its items arrive the first time (`feel-item-in`); `fade-exit` | `--motion-fast`; `--motion-exit-menu` | reduced: `fade-exit` 80ms; Still: none |
| Tabs | a tab chosen | the new panel arrives from the side of its tab (`feel-panel-in`); the indicator slides under the chosen tab | `--motion-spring-snappy` | instant |
| Fields, checks, switches | a warning after typing; a check or radio taken | `feel-nudge` (no shake); `feel-check` | `--motion-spring-snappy` | instant |
| Room request row (`rooms/RoomRequests.tsx`) | a guest's request arrives in the host's list | the row slides down into place with its edge in the request colour (`ask-in`) | `--motion-reveal` | none |
| Toast | shown | `toast-appear`; with the feel its ring counts down the time it has left (`feel-countdown`) | `--motion-reveal`; the toast's own time | none; the toast still closes on time |
| Toast | closing (`data-closing`) | `toast-exit` (fade and drop 4px) | `--motion-exit-toast` | reduced: `fade-exit` 120ms; Still: none |
| Route | page change | `route-reveal` | `--motion-reveal` | none |
| Page transitions (`styles/feel-scene.css`) | a page change in a browser with view transitions, on Expressive with `app.scene_transitions` and no low power | the frame (rail, header, mini player) stays put; the old page leaves (`feel-scene-leave`), the new one arrives from the side it was asked from (`feel-scene-enter`, `feel-scene-travel`); a named shared thing glides between its two places | leave `--motion-fast`; enter `--motion-handoff` on `--spring-gentle`; shared `--motion-spring-glide` | the page changes at once |
| Skeleton | loading | `skeleton-reveal` after `--motion-fast`, then `skeleton-breathe` 3 times; with the feel one band of light crosses instead, three times at most (`feel-skeleton-sweep`) | reveal token; breathe 1.4s exception | none |
| Meter (`ui/Meter`) | the value changes; no value known; done while on screen | fill width follows the value; indeterminate fill runs `lucy-slide`; with the feel, done blooms once (`feel-bloom`) | `--motion-reveal`; `--motion-loop-slide` 1.6s loop | none; the words still say the value |
| Arrivals (`data-arrive`, `data-stagger`) | first drawn | rises a little and fades in once (`feel-arrive`), neighbours `--motion-stagger` apart | `--motion-spring-snappy` on `--spring-snappy` | shown at rest |
| Small answers | a press, a count or a badge; real news | `feel-pop` on `--spring-bouncy`; a tick drawing (`feel-draw`); a changed row glowing once (`feel-flash`); a removed row folding away (`feel-collapse`) | `--motion-spring-snappy`; flash four times `--motion-slow`; collapse `--motion-handoff` | shown at rest; a removed row goes at once |
| Vibe groups | Make a Mix loads | `feeling-reveal` | `--motion-handoff` | none |
| Request pill | a request is working | `request-pulse` | 1.8s loop, exception | none |
| Pending line | a render is in line | `pending-flow` | 2.4s loop, exception | none |
| Lucy progress | Lucy is working | `lucy-slide` when the length is unknown; width when known | 1.6s loop exception; `--motion-reveal` | none |
| Lucy usage ladders (`views/LucyUsageLevels.tsx`, `.lucy-ladder-seg`) | a segment goes out as usage is counted, or comes back when a window resets | the segment's background colour changes once; no keyframes and no loop | `--motion-reveal` with `--motion-ease` | none: `transition: none` under Still and reduced motion; the label's words carry the figures |
| Meter (`ui/Meter`) | the value changes; no value known | fill width follows the value; indeterminate fill runs `lucy-slide` | `--motion-reveal`; `--motion-loop-slide` 1.6s loop | none; the words still say the value |
| Lucy conversation (`styles/lucy.css`) | you send; Lucy answers; a step is named; a revision adds a song | your message rises from the box (`feel-lucy-rise`); Lucy's words and each streamed chunk fade in (`feel-lucy-fade`); one pass of light on a new step (`feel-lucy-shimmer`); the added song's edge lights (`feel-lucy-edge`) | spring and effects tokens | shown at rest |
| Drag in the editor | dragging a song | drop line follows the pointer, no transition; the dragged row casts `--shadow-float` | pointer | unchanged (it is the pointer) |
| Spectrum visualizer | playing on Listen | canvas redrawn from the analyser | at most 15fps, stops when hidden or off screen | one still frame |
| Lyric focus | the player clock | current line and word colour | `--motion-reveal` | instant, still follows the clock |
| Hand-over progress | the player clock | width follows the transition | 70ms linear, exception: it tracks the clock tick | instant, still follows the clock |
| Beat (`styles/feel-music.css`, `feel/beatBus.ts`) | a measured kick or onset, or an analysed grid beat, while playing | the ring round Play, the player's top edge, the glow on the playing thing, the playing row's wash and the playing bars pulse once per beat, transform and opacity only, on at most four elements, at most three pulses a second (halved above 180 beats a minute) | each pulse 220 to 320ms | none: stops when paused, hidden, Still, reduced motion or low power; Subtle keeps only the player's ring, edge and bars |
| Ambient (`styles/feel-music.css`, `feel/hue.ts`) | a new song; a real hand-over | one fixed layer behind content takes a soft tint in the playing song's hue; during a hand-over the hue travels with the transition | `--motion-slow`; the hand-over's own clock | the tint stays, without easing; removed under low power and forced colours |
| Shell (`styles/feel-shell.css`) | the rail opens; a menu opens; the page changes; activity; playback | the rail's words (`feel-rail-label`); a menu growing from its button (`feel-menu-grow`); the page's name (`feel-crumb-in`); the bell once on new activity (`feel-ring`); the mini player rising and sinking (`feel-dock-rise`, `feel-dock-sink`); Play turning into Pause (`feel-glyph-swap`); a new song's title (`feel-title-in`); the palette growing from its button (`feel-palette-grow`); the connection banner and import chip (`feel-banner-in`, `feel-banner-out`); a new theme spreading from the theme button (`feel-theme-reveal`) | spring and effects tokens | shown at rest; the theme changes at once |
| Welcome page (`cloud/Welcome.tsx`) | the page opens; a step scrolls into view | `rise-in`: the headline a word at a time, then the lead, the buttons, the drawing, the benefits and the steps; with the feel one pass of light over the lit word (`feel-sweep`) and the step line drawn as it scrolls in (`feel-line-down`, `feel-line-across`) | `--motion-slow`, each `--motion-feedback` after the last | none: everything rests in place |
| Onboarding steps | Next; Back | the step card arrives from the side ahead (`feel-arrive-forward`) or behind (`feel-arrive-back`) | `--motion-spring-snappy` | instant |
| Blend drawing (`cloud/BlendArt.tsx`: Welcome, page not found) | shown | the playhead crosses (`blend-head`; `blend-skip` when nothing is up next), the blend point answers it (`blend-ring`), the two tags trade emphasis (`blend-tag`); with Expressive each bar lifts as the playhead passes (`blend-kick`) and the card leans toward the pointer | `--motion-loop-blend` 8s loop; the lean `--motion-slow` | a still drawing, the playhead resting on the blend; Subtle has no bar lift and no lean |
| Gate screens (`cloud/Gate.tsx`) | shown; waiting | the card and the account line `rise-in`; the waiting line runs `lucy-slide` | `--motion-slow`; `--motion-loop-slide` 1.6s loop | none |
| Cloud pages (`styles/cloud-ui.css`) | page change; a card grid or a meter appears | the page and each card `cloud-arrive`, cards one after another; a meter fills from empty (`meter-fill`) | `--motion-slow`, cards `--motion-feedback` apart | none; the words still say the value |
| Make a Mix and Listen (`styles/feel-listen.css`) | a skip; a hand-over nears; the mix is made | a ring where Skip was pressed (`feel-listen-skip`); the next song's card rises as a real hand-over nears (`feel-listen-rise`); the build moment leaves (`feel-listen-build-out`) | spring and effects tokens; the rise follows the song clock | shown at rest |
| Celebrations (`feel/moment.tsx`, `styles/feel-parts.css`) | a rare moment: onboarding done, a mix built, a first hand-off, an upgrade, an export | `feel-moment-ray` once, one at a time, one per 8 seconds | twice `--motion-spring-release`, rays `--motion-stagger` apart | none (Expressive only) |
| Rooms and devices (`styles/feel-rooms.css`) | a room opens; this device is found | the room's QR code comes in as a diagonal wave, opacity only so it scans as drawn (`feel-qr-wave`); this device's edge lights once (`feel-beacon`) | spring and effects tokens | shown at rest |
| Local first scan (`styles/feel-local.css`) | the first scan finds a phrase | the word lights like the current lyric word (`feel-word-light`) | effects tokens | shown lit |
| Account, Plan, Workspace, Library, editor, Studio (`styles/feel-account.css`, `styles/feel-library.css`) | arrivals; hover; the plan you are on | reuse `feel-arrive`, `feel-draw` and `feel-pop`; the plan you are on carries a lit edge, not a moving thing | spring and effects tokens | shown at rest |
| Music folders drop zone (`cloud/libraryWorkspace.css`) | files dragged over the page | the drop zone fades in (`mf-drop-in`), only under `prefers-reduced-motion: no-preference` | `--motion-reveal` | shown at once |
| Staff deck PIN (`business/staff/staff.css`) | a refused PIN | the dots show the danger colour once (`feel-pin-refused`); no shake | effects tokens | the colour, at once |
| Countdown, playhead, beat pips | the player clock | position set from player time each tick, no transition | clock | unchanged (it is data) |

## Cloud, Rooms, devices and the other surfaces

The hosted Cloud pages, the local-first Cloud shell, Rooms hosting and the devices list move through
the shared parts above and the feel sheets. `cloud/cloud.css`, `rooms/rooms.css` and
`devices/devices.css` are scanned by `motion-tokens.test.ts` with the app's sheets, so a duration
added there has to be a token and a keyframe a row here; `rooms.css` defines `ask-in`.

Outside that scan, the remaining feature sheets keep motion to almost nothing:

| Sheet | Motion | Still / reduced motion |
| --- | --- | --- |
| `venueops/staffDashboard.css` | Staff buttons and Stop change background at `--motion-fast`, only under `prefers-reduced-motion: no-preference` | none |
| `business/business.css`, `business/staff/staff.css` | Their feel rules are scoped to `<html data-feel>`; the staff deck's one keyframe is `feel-pin-refused`; each sheet resets animation and transition inside `.biz` and `.biz-staff` | reset under reduced motion and Still |
| `kiosk/kiosk.css` | `k-slide` is a waiting indicator while music is prepared (2.4s loop) | the sheet disables it under reduced motion; the playing motif is static |
| `guest/guest.css` | Its own small set, timed by copies of the app's tokens (`palette-drift.test.ts` keeps the copies equal): buttons squeeze and change colour on a press (`--motion-feedback`, `--motion-fast`); a working button runs `g-working` under its label (0.9s loop); cards, rows and banners arrive with `g-settle` and the notice slides up (`--motion-reveal`); a check draws in with `g-draw` and a vote pops with `g-pop` (`--motion-slow`); a request whose status changed is lit by `g-flash`; outline rows and the waiting dot breathe with `g-breathe` (1.4s and 1.8s loops); a chosen row pops its check and its count badge bumps (`g-pop`, `g-bump`), a tap that cannot add a song shakes the row (`g-no-a`, `g-no-b`), the bar of chosen songs and the connection banner slide in (`--motion-handoff`), and a waiting ring turns with `g-turn` (0.9s loop). The now-playing bars stand still at three heights while music plays: the room feed carries no tempo, so they never move on a timer | every transition and animation is reset; each keyframe only animates from a start state, so the resting state shows |
| `display/display.css` | A line that is new (the next song, a new request, the reconnecting note) arrives with `d-arrive` (twice `--motion-slow`); the whole picture drifts under 1% of the screen over five minutes with `d-drift`, so a TV left on never holds one bright shape in place; the reconnecting ring turns with `d-turn` (0.9s loop). The now-playing bars stand still at three heights while music plays, for the same reason as the guest page's. A heart rises with `d-rise` (eight times `--motion-slow`) for each love the room gave the playing song since the screen last looked, twelve at most (ADR-0488): it answers a guest's tap, never a timer | every animation is reset, and no heart is made under reduced motion: the count just changes |

## Exceptions to the tokens

These are longer or shorter than the tokens on purpose. Each is an ambient loop that says something
is still going, or follows the player clock. Their lengths are named tokens in `tokens.css`
(`--motion-loop-*`, `--motion-clock`), so no sheet holds a raw duration.

- `button-working` 0.9s, `skeleton-breathe` 1.4s, `lucy-slide` 1.6s, `request-pulse` 1.8s, `pending-flow` 2.4s: loops, longer than any token by design.
- `blend-head`, `blend-skip`, `blend-ring`, `blend-kick`, `blend-tag` 8s (`--motion-loop-blend`): one slow pass of the playhead over the blend drawing. Decoration that shows what a blend is; it never claims to follow real audio.
- `.handoff-progress i` width 70ms linear: smooths the gap between clock ticks; a token would lag the music.
- The beat bus's pulses (220 to 320ms) are script animations, not stylesheet durations; their lengths live in `MUSIC_MOTIONS` in `web/src/feel/beatBus.ts`, which may touch only transform, translate, scale and opacity.

## Keyframes

Every `@keyframes` in `web/src`, by sheet, with its kind from `gp-0257-motion.test.ts`
(answers you, arrives, or waiting; only waiting may loop). No keyframe follows the music: that kind
is the beat bus alone.

| Sheet | Keyframes |
| --- | --- |
| `style.css` | `pending-flow` (waiting), `request-pulse` (waiting) |
| `styles/foundation.css` | `lucy-slide` (waiting) |
| `styles/shell.css` | `skeleton-breathe` (waiting), `button-working` (waiting) |
| `styles/polish.css` | `feeling-reveal`, `skeleton-reveal`, `toast-appear`, `route-reveal` (arrives); `overlay-appear`, `drawer-appear`, `pop-appear`, `fade-exit`, `dialog-exit`, `drawer-exit`, `toast-exit` (answers you) |
| `styles/boot.css` | `rise-in` (arrives); `blend-head`, `blend-skip`, `blend-ring`, `blend-kick`, `blend-tag` (waiting) |
| `styles/cloud-ui.css` | `cloud-spin` (waiting); `cloud-arrive`, `meter-fill` (arrives) |
| `styles/feel.css` | `feel-arrive`, `feel-flash` (arrives); `feel-pop`, `feel-draw`, `feel-collapse` (answers you) |
| `styles/feel-parts.css` | `feel-tick-draw` (answers you); `feel-moment-ray` (arrives) |
| `styles/feel-scene.css` | `feel-scene-leave`, `feel-scene-enter`, `feel-scene-travel` (answers you) |
| `styles/feel-components.css` | `feel-panel-in`, `feel-item-in`, `feel-fade-in`, `feel-nudge`, `feel-check` (answers you); `feel-countdown`, `feel-skeleton-sweep` (waiting, never infinite: the sweep runs three times at most); `feel-bloom` (arrives) |
| `styles/feel-shell.css` | `feel-rail-label`, `feel-menu-grow`, `feel-dock-sink`, `feel-glyph-swap`, `feel-palette-grow`, `feel-banner-out`, `feel-theme-reveal` (answers you); `feel-crumb-in`, `feel-ring`, `feel-dock-rise`, `feel-title-in`, `feel-banner-in` (arrives) |
| `styles/feel-entry.css` | `feel-sweep`, `feel-line-down`, `feel-line-across` (arrives); `feel-arrive-forward`, `feel-arrive-back` (answers you) |
| `styles/feel-listen.css` | `feel-listen-skip`, `feel-listen-build-out` (answers you); `feel-listen-rise` (arrives) |
| `styles/feel-rooms.css` | `feel-qr-wave`, `feel-beacon` (arrives) |
| `styles/feel-local.css` | `feel-word-light` (arrives) |
| `styles/lucy.css` | `feel-lucy-rise` (answers you); `feel-lucy-fade`, `feel-lucy-shimmer`, `feel-lucy-edge` (arrives) |
| `styles/feel-music.css`, `styles/feel-account.css`, `styles/feel-library.css` | none |
| `business/staff/staff.css` | `feel-pin-refused` (answers you) |
| `cloud/libraryWorkspace.css` | `mf-drop-in` (answers you) |
| `rooms/rooms.css` | `ask-in` (arrives) |
| `kiosk/kiosk.css` | `k-slide` (waiting) |
| `guest/guest.css` | `g-settle`, `g-flash` (arrives); `g-draw`, `g-pop`, `g-bump`, `g-no-a`, `g-no-b` (answers you); `g-breathe`, `g-working`, `g-turn` (waiting) |
| `display/display.css` | `d-arrive` (arrives); `d-rise` (answers the room); `d-drift`, `d-turn` (waiting) |
