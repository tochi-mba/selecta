# Spacing token map

Every margin, padding and gap in the app's own stylesheets (`web/src/style.css` and `web/src/styles/*.css`) is one of the roles below or a documented exception. Values live once, in `web/src/styles/tokens.css`. `web/src/styles/spacing-tokens.test.ts` fails on any raw `px` in a spacing declaration that is not `0`, a `1px` hairline or a listed exception, on a stale exception, and on any spacing token used here but missing from this page. The separate surfaces (`web/src/cloud`, `guest`, `rooms`, `display`, `devices`, `admin`) keep their own stylesheets and are outside this map.

Owner: ADR-0273 (MP-0273-01 to -08). Geometry proof: `web/e2e/spacing-rhythm.e2e.ts`.

## The scale

| Token | Value | Role |
| --- | --- | --- |
| `--space-1` | 4px | Inside one control or one small cluster |
| `--space-2` | 8px | Between controls in a row; icon to label |
| `--space-3` | 12px | Inside a row or panel; heading to what it introduces |
| `--space-4` | 16px | Between rows and small panels; phone card padding |
| `--space-5` | 24px | Card and panel padding; between groups in a section |
| `--space-6` | 32px | Between distinct sections; top of a page |
| `--space-7` | 48px | The largest rhythm step |

## Half steps

| Token | Value | Role |
| --- | --- | --- |
| `--space-hair` | 2px | A title over its own subtitle; stacked lines that read as one block; segmented control inset |
| `--space-dense` | 6px | Chip and pill rows, dense control padding |
| `--space-snug` | 10px | Row and small-control padding between 8 and 12 |
| `--space-cozy` | 14px | Control and small-panel inline padding |
| `--space-loose` | 20px | Legacy section margins between 16 and 24 |

## Roles

| Token | Value | Role |
| --- | --- | --- |
| `--list-indent` | 18px | Bulleted list text from its marker |
| `--timeline-indent` | 26px | A seam, gap or adder nests under its song in the editor |
| `--control-pad-block` | 9px | Vertical padding that makes a 24px line plus a 1px border a 44px target |
| `--icon-size` | 20px | `ui/Icon.tsx` default box, used to clear a leading search icon |
| `--icon-gap` | `--space-2` (8px) | An icon to its own words (MP-0273-02) |
| `--icon-gap-dense` | `--space-1` (4px) | Reviewed dense controls, listed below |
| `--field-gap` | `--space-1` (4px) | Label, control, help and error inside one field (MP-0273-03) |
| `--rhythm-related` | `--space-3` (12px) | A page heading to the text or controls it introduces (MP-0273-04) |
| `--rhythm-group` | `--space-5` (24px) | Between groups inside one section |
| `--rhythm-section` | `--space-6` (32px) | Between distinct sections |
| `--page-end` | 120px | Room after the last action, on top of the fixed chrome (MP-0273-07) |
| `--row-pad`, `--row-gap`, `--control-height` | 12px, 8px, 44px; compact 8px, 4px, 36px | Density, below |

## Icon gaps (MP-0273-02)

Any `button` or `a.button` whose direct child is an `.ui-icon` lays out as an inline row with `--icon-gap` between the icon box and its words (`web/src/styles/polish.css`, zero specificity so a control that sets its own display still wins). The rail links, Request a song, context bar buttons, editor song actions and menu items use the same token.

Reviewed dense controls use `--icon-gap-dense` or less, on purpose:

- `.status` marks: a 14px mark beside a short status word inside rows and pills.
- `.locked-badge`: a 14px lock beside "Locked" under a song title.
- `.music-route.compact` icons: a row of tiny route marks, `--space-1`.
- The phone tab bar (`.nav li a`, `.nav-more-mobile` at 760px and below): the icon sits **above** its label, 2px apart, so five destinations fit a 320px screen.

## Fields (MP-0273-03)

`Field` (`web/src/ui/primitives.tsx`) renders label, control, help, then error, in that order, each `--field-gap` apart in one grid (`.field`, `.correct-field`, `.glossary .field`). Separate fields sit at least `--space-2` apart, so a hint always reads with its own control.

## Heading rhythm (MP-0273-04)

- A page heading (`.display`) to the first thing under it: 12 to 48px (`.lede` ends `--rhythm-group`, `.page > .display.small` ends `--space-5`).
- A section heading (`.section-title`) starts `--rhythm-section` after the previous section and sits `--space-2` above what it introduces.
- Section breaks that were 26 or 28px (`.next-up`, `.didnt`, `.vibe-group`, `.hero`) now use `--rhythm-section` or `--rhythm-group`.

## Compact density (MP-0273-06)

Compact applies only inside `.density` (Library rows, the editor timeline, My Mixes drafts) when `data-density="compact"` is on the root. It changes only space, never type size:

| Token | Comfortable | Compact | Compact on a coarse pointer |
| --- | --- | --- | --- |
| `--control-height` | 44px | 36px | 44px |
| `--row-pad` | 12px | 8px | 8px |
| `--row-gap` | 8px | 4px | 4px |

Song titles stay at least 14px and metadata at least 12px. Every control in a compact row is at least 24px on a fine pointer (WCAG 2.5.8) and at least 44px on touch; Library row actions are also at least `--control-height` wide, so an icon-only action is square.

## End-of-page clearance (MP-0273-07)

`.content` pads its bottom by `--bottom-chrome` (phone tab bar with its safe-area inset, plus the mini-player when it shows) and `--space-5`; `.page` adds `--page-end`. `html` scroll padding uses the same numbers, so a focused control is never under the bars. On Listen the transport bar also docks on phones, and its own 76px is added to the scroll padding there.

## Musical geometry (MP-0273-08)

These gaps draw time, so they are not rounded to the scale. They are owned by the grid they belong to:

| Token | Value | Used by |
| --- | --- | --- |
| `--grid-beat-gap` | 3px | `.studio-lane` (eight-lane Studio cells, both gap and lane spacing), `.beat-pips`, `.seam-visual-bars`, `.music-seam-diagram` |
| `--grid-bar-gap` | 2px | `.energy-overview ol`, `.lucy-energy-bars`, `.lucy-seam-strip` |
| `--grid-cell-gap` | 1px | `.energy-thumb` (96px energy picture on mix cards) |

## Documented raw exceptions

| File | Selector | Value | Why |
| --- | --- | --- | --- |
| `styles/creation.css` | `.story-seam` | `margin-inline-start: 17px` | Centres the seam line under the 36px story number on phones |
| `styles/lucy.css` | `.lucy-msg.is-user article` | `clamp(0px, 8vw, 80px)` | Conversation indent ceiling, proportional to the viewport |
| `styles/lucy.css` | `.lucy-msg.is-assistant article` | `clamp(0px, 6vw, 60px)` | Conversation indent ceiling, proportional to the viewport |
| `styles/music-objects.css` | `.energy-overview button` | `padding: 3px` | Energy bar inset, matching `--grid-beat-gap` |
| any | any | `1px`, `-1px` | Border compensation hairlines |
