# The SelectaDJ design system

The single entry page for how SelectaDJ looks, moves and is built from shared parts, in the local app and in every Cloud surface. Each section says what is true in the code today, where it lives, which test keeps it true and which ADR owns it. The one-shell and consolidation decisions are [ADR-0468](../adr/adr-0468-one-shell-and-design-system-consolidation.md); the older programmes that built the system are linked under [Owning ADRs](#owning-adrs).

Where a part is still being built (guards and gallery work from the overhaul's W6 wave), this page says so rather than describing the plan as if it had landed.

## Token hierarchy

`web/src/styles/tokens.css` is the only place a value is written. It has three layers, and a component names the highest layer that says what it means:

| Layer | What it holds | Examples | Who may read it |
| --- | --- | --- | --- |
| Palette | The raw colours, once for Dark and once for Light (`--light-*`) | `--bg`, `--panel`, `--ink`, `--soft`, `--accent`, `--warn`, `--ok`, `--request`, `--scan-white` | Only `tokens.css` itself |
| Meaning | What a colour, edge or surface is for | `--surface-base/raised/control/panel/overlay/scrim/selected/scan`, `--text`, `--text-soft`, `--edge-decorative/interactive/selected/error/focus/overlay`, `--focus`, `--selected`, `--playing`, `--danger`, `--status-*`, `--link`, `--motif` | Every stylesheet |
| Parts | Shapes and spaces built from the meanings | `--primary-fill/ink/edge`, `--word-*`, `--radius*`, `--separator`, `--marker`, `--shadow-*`, `--space-*`, `--control-height`, rail and header geometry | Every stylesheet |

Rules that follow from it:

- **Components never reference the palette.** A sheet asks for `--surface-raised` or `--text-soft`, never `--panel` or `--soft`, so a theme can change what a meaning resolves to without touching a component.
- **Lime is a meaning, not a colour.** The brand lime is the main action, focus, selection, playing and work in progress. Anywhere else reaches it through `--link` or `--motif`. In Light it only ever appears as a filled shape with dark ink and a dark edge (`--primary-*`), never as text or a thin line on cream.
- **One Light palette.** Light is switched on by a light device while the choice is System, or chosen by hand (`[data-theme='light']`). Both switches only point at the `--light-*` palette, so the two can no longer drift apart (the overhaul folded two drifting blocks into one in `5d08d4b5`).
- **No status by colour alone.** Every status also has a mark and words (`Status` in `ui/controls.tsx`).
- **Named exceptions.** The guest page (`guest/guest.css`) and the big-screen display (`display/display.css`) load without `tokens.css` to stay inside their bundle budgets, so each keeps a small token block whose every value is copied from the `tokens.css` token of the same name, with a comment naming the source (`22f6881a`). A drift guard comparing those blocks against `tokens.css` is planned (ADR-0468 BF-0468-02) and not written yet.

Spacing roles and their exceptions are listed in [spacing-token-map.md](spacing-token-map.md); radii, lines and depth in the `tokens.css` comments and [ADR-0276](../adr/adr-0276-colour-surface-depth-and-borders.md).

## Type scale

There is one type scale. Its steps are `--text-xs` (0.75rem), `--text-sm` (0.875rem), `--text-md` (1rem), `--text-lg` (1.15rem), `--text-xl` (1.5rem), `--text-2xl` (2rem) and `--text-hero` (fitted, 2.8rem to 6rem). Five weights mark what they mean: `--weight-body` 400, `--weight-label` 600, `--weight-strong` 700, `--weight-heading` 800, `--weight-display` 900. A stylesheet outside `tokens.css` names a size only through a role below or as `font-size: var(--text-*)`.

Each role is a whole `font` shorthand, so a role is one declaration:

| Role | Font | Use |
| --- | --- | --- |
| `--type-hero` | 900, `--text-hero`, display face | The single headline of a first screen: Start, the Cloud welcome and the sign-in states |
| `--type-display` | 900, fitted 2.4rem to 5.2rem | A hero headline or the playing song |
| `--type-page` | 900, fitted 1.8rem to 2.8rem | The one page title |
| `--type-section` | 800, fitted 1.15rem to 1.5rem | A section or card heading |
| `--type-figure` | 900, `--text-2xl`, display face | A number or code read at a glance: a plan price, a room code, a metric |
| `--type-song` | 700, 1rem | A song title in a row, card or list |
| `--type-meta` | 400, `--text-sm` | Artist, facts, hints and statuses beside a song |
| `--type-counter` | 500, `--text-sm`, mono | Numbers that change in place (tabular) |
| `--type-label` | 600, `--text-xs` | A small bold label above or inside a control group |
| `--type-eyebrow` | 600, `--text-xs`, mono | Small capitals over a heading, with `--tracking-eyebrow` and uppercase |
| `--type-caption` | 400, `--text-xs` | The smallest running text: help under a control, a footnote |

Body text (`--body` at `--text-md`) and the sung lyric line are the two roles outside the table on purpose (UF-0369-01). The fitted lyric and Stage sizes are the documented exception to the steps: they are fitted to the window, never below `--title-floor` (24px). `--type-hero`, `--type-figure` and `--type-eyebrow` were added by the overhaul (`5d08d4b5`) for the Cloud and Rooms surfaces; `cloud.css`, `rooms.css`, `admin.css`, `devices.css`, `makeCloudMix.css`, `mixIntent.css` and the business sheets were moved onto the roles in `99d7acc8`, `0f8c0ba7`, `3c9cfa00`, `cdefdf1d`, `58eb3de6`, `33e85a48` and `9872fbb7`. The display page keeps em sizes relative to its fitted body size, as the Stage does. `typography.test.ts` and `ufTypeRoles.test.ts` check `style.css` and `styles/*.css` today; widening them to every sheet is ADR-0468 BF-0468-08.

## Breakpoints

`web/src/styles/breakpoints.ts` defines the six canonical widths:

| Name | Width | Meaning |
| --- | --- | --- |
| `compact` | 480 | A small phone: one column, tightest padding |
| `phone` | 640 | A phone held upright: stacked rows, full-width actions |
| `tablet` | 768 | A tablet held upright or a phone on its side |
| `narrow` | 900 | A narrow laptop window: a side rail folds into a top bar |
| `laptop` | 1100 | A laptop: four-up grids go to two |
| `wide` | 1400 | A wide desktop: the work column stops growing |

A sheet writes `(max-width: N)` for below a breakpoint and `(min-width: N+1)` for above it. Code that has to agree with a sheet builds its query with `below()` or `above()` so the two never disagree by a pixel. Height queries (short windows, 400% zoom) are not widths and are outside the list.

`LEGACY_WIDTHS` in the same file names every width still in a sheet that is not canonical yet (360, 420, 520, 560, 599, 620, 621, 760, 761, 767, 850, 1023, 1024, 1040), each with the canonical width it will move to and why it waits. Each one is either pinned by a row of the MP-0278-06 breakpoint register ([docs/adr/completion/css-ownership.md](../adr/completion/css-ownership.md), checked by `css-ownership.test.ts` and `mp-css-register.test.ts`) or mirrored by a `useMediaQuery` in a component (for example 760 by `views/Now.tsx`, 599 by `ui/DataTable.tsx`, 767 and 1023 by `business/console/HqConsole.tsx`). Moving one is therefore a change to that register row or component in the same commit, never a stylesheet edit alone. The shell's own 760 lives in `tokens.css` and `shell.css`.

Today no code imports `breakpoints.ts` yet, and no test yet fails a sheet that uses a width outside `BREAKPOINT_WIDTHS` and `LEGACY_WIDTHS`; that guard is ADR-0468 BF-0468-08.

## Motion

### Tokens

| Token | Default | Purpose |
| --- | --- | --- |
| `--motion-feedback` | 80ms | Direct feedback to a press |
| `--motion-fast` | 120ms | Hover and focus colour changes; menus, popovers and tooltips popping in |
| `--motion-reveal` | 160ms | Content arriving in place: route reveal, skeleton reveal, toasts |
| `--motion-handoff` | 200ms | One group handing over to the next |
| `--motion-overlay` | 220ms | A dialog opening |
| `--motion-slow` | 240ms | A drawer or sheet sliding in from its side |
| `--motion-ease` | `cubic-bezier(0.2, 0.7, 0.2, 1)` | The one easing |
| `--motion-exit-dialog` | `--motion-fast` | Dialog and workspace leaving: fade and shrink 2% |
| `--motion-exit-drawer` | `--motion-handoff` | Drawer and sheet leaving: slide back out of its side |
| `--motion-exit-toast` | `--motion-fast` | Toast leaving: fade and drop 4px |
| `--motion-exit-menu` | `--motion-feedback` | Menu, tooltip and popover leaving: fade |
| `--motion-loop-*`, `--motion-clock` | 0.9s to 2.4s; 70ms | Loops that run as long as their state does, and the hand-over bar that follows the audio clock |

Leaving is quicker than arriving. Every animated surface, its trigger and its reduced-motion behaviour is in [motion-inventory.md](motion-inventory.md), checked by `motion-tokens.test.ts`.

### The exit protocol

1. Something closing sets `data-closing` on its root.
2. `styles/polish.css` animates `[data-closing]` at the exit tokens: `.overlay` fades with `fade-exit` while its `.overlay-panel` runs `dialog-exit`; drawers and sheets run `drawer-exit`; `.toast-row` runs `toast-exit`; anything with `data-motion='pop'` (menus, popovers, tooltips) runs `fade-exit`. A closing thing takes no pointer events.
3. `web/src/ui/exitMotion.ts` removes it when the animation ends:
   - `playExit(node, done, token)` sets `data-closing`, measures the longest animation on the node or its first child, and calls `done` on `animationend`. If nothing animates (reduced motion with no fade, a sheet without keyframes, a test runner without CSS) it calls `done` at once, so nothing waits on motion that is not there. A timeout of the token's own length (read live by `motionMs`) is the fallback when `animationend` never fires (a hidden tab, `display: none`). It returns a cancel that takes `data-closing` away again.
   - `exitGhost(node, token)` plays an overlay's exit on an inert, `aria-hidden` copy, because the owner has already removed the real one; focus and reading order are back on the page while the copy fades. Ids and media are stripped from the copy and its scroll position is kept. `Dialog`, `Drawer`, `Sheet` and `Workspace` (`ui/controls.tsx`) use it.
   - `usePresence(open, token)` keeps a menu, tooltip or popover rendered while it animates out and reports `closing` so the caller renders `data-closing`, `aria-hidden` and `inert`. `Menu`, `Tooltip` (`ui/controls.tsx`) and `Popover` (`ui/primitives.tsx`) use it.
   - The toast stack calls `playExit` with `--motion-exit-toast` (`ui/toasts.tsx`).

Tests: `web/src/ui/exitMotion.test.tsx` (the protocol), `web/e2e/mp-0295-overlays-and-toasts.e2e.ts` and `web/e2e/mp-0296-motion.e2e.ts` (in the browser). Landed in `2d4eca5b` (components) and `d06c50cf` (sheets).

### Reduced motion, Still and low power

- **OS reduced motion swaps, never removes.** Every motion token goes to 0ms and other animations stop, but leaving is swapped for one short fade: the exit tokens are set to 120ms (80ms for menus) and `polish.css` runs `fade-exit` on every `[data-closing]` thing, so a closing thing still reads as leaving.
- **Still** (`data-motion='still'`, the person's own preference) and **low power** (`data-low-power='auto'`, set by `ui/lowPower.ts` when frame timing shows the device struggling, and dismissible with `keepFullMotion()`) take every token, exits included, to 0ms and stop all animation and transition outright.
- **Subtle** (`data-motion='subtle'`) shortens each token.

Known gap: `Menu`, `Tooltip` and `Popover` pass `--motion-fast` rather than `--motion-exit-menu` as their `usePresence` fallback token. Under OS reduced motion `--motion-fast` is 0ms, so the fallback timeout removes them before the 80ms swap fade can play. The protocol's comment in `exitMotion.ts` intends the exit token. Recorded under ADR-0468 BF-0468-04.

## Component catalogue

Every export of `web/src/ui/`, one line each. Contracts, ARIA and keyboard behaviour for the main controls are in [docs/adr/completion/components.md](../adr/completion/components.md).

### Controls and feedback (`ui/controls.tsx`)

- `Action` - a button that runs an async task once: busy while pending, failed with retry, survives unmount.
- `StatusKind` - the status words a `Status` can say.
- `Status` - a status as words plus a mark, never colour alone.
- `Problem` - an `alert` region saying what failed, with an optional Retry.
- `Section` - an error boundary per page or panel, so a render error never blanks the app.
- `Dialog`, `Drawer`, `Workspace`, `Sheet` - the shared overlay stack: focus trap, inert page, Escape closes the top one, focus returns; exits via `exitGhost`.
- `Menu` - a menu button and its `menu`, keyboard complete, closes after choosing.
- `Tooltip` - adds words to a control's description; shows on focus.
- `announce` - says one outcome through the polite live region.
- `LiveRegion` - the one polite live region a frame mounts.
- `Skeleton` - re-exported from `ui/Skeleton.tsx`.

### Primitives (`ui/primitives.tsx`)

- `IconButton` - an icon-only button with a required label.
- `LinkTabs` - route tabs as links with `aria-current`.
- `Tabs` - widget tabs with `tablist`/`tab`/`tabpanel` and arrow keys.
- `Field` - label, control, help and error joined by `aria-describedby`.
- `SearchField` - a labelled `searchbox` with Clear and Escape.
- `Slider` - a labelled range with `aria-valuetext`.
- `Popover` - a disclosure button and its region, not hover-only.
- `MenuItem` - a `menuitem`, with a `danger` variant.
- `moveInGrid` - arrow-key movement in a two-dimensional grid.
- `VISUALLY_HIDDEN` - the one class name that hides from the eye and keeps for a screen reader.
- `VisuallyHidden` - the component form of `.visually-hidden`.

### New in the overhaul (`0f8af6b3`)

- `ConfirmDialog` (`ui/ConfirmDialog.tsx`) - "are you sure" on the shared overlay stack. A destructive choice that can be taken back (`undo`) says so and confirming shows the 15 second Undo toast; one that cannot says "This can't be undone." and the safe answer has focus.
- `CONFIRM_COPY` - its default words ("Yes, remove it", "Keep it", "Removed. You can undo this for a few seconds.").
- `ConfirmDialogProps` - its props.
- `Meter` (`ui/Meter.tsx`) - one bar for progress (`role="progressbar"`, indeterminate without a value) and for quantities (`role="meter"`), words always said as well as drawn.
- `meterTone`, `MeterTone`, `MeterProps` - the tone from `warnAt`/`dangerAt` fractions, and its types.
- `BrandMark` (`ui/BrandMark.tsx`) - the SelectaDJ "S" badge (`.brand-mark-badge`, styled in `styles/boot.css`), always `aria-hidden`.

### Formatting (`ui/format.ts`)

- `ELLIPSIS` - the one ellipsis character.
- `userLocale` - the reader's language from the browser.
- `relativeTime` - "3 min ago" through `Intl.RelativeTimeFormat` in the reader's locale.
- `countOf` - a count with the right plural, in the reader's locale.
- `ellipsize` - shortens text to a length with the ellipsis character.
- `Truncate` - a span that truncates with the full text as `title` and `dir="auto"`.

### Motion (`ui/exitMotion.ts`, `ui/lowPower.ts`, `ui/useReducedMotion.ts`)

- `motionMs`, `playExit`, `exitGhost`, `usePresence` - the exit protocol, above.
- `useReducedMotion` - whether the OS asks for reduced motion.
- `SLOW_FRAME_MS`, `WINDOW_FRAMES`, `SLOW_SHARE`, `REST_MS`, `struggling`, `lowPowerActive`, `useLowPower`, `keepFullMotion`, `watchLowPower`, `resetLowPower` - the low-power sampler that sets `data-low-power='auto'`.

### Toasts (`ui/toasts.tsx`)

- `Toaster` - the toast stack a frame mounts; at most three visible, duplicates merge.
- `showToast` - shows a toast, optionally with Undo, scope and placement.
- `showProblem` - shows a problem toast (`alert`).
- `dismissToast`, `clearToasts`, `setToastsQuiet` - dismiss one, clear all, quiet them on the Stage.
- `Toast`, `ToastTone` - the toast types.

### Icons (`ui/Icon.tsx`)

- `Icon` - one glyph at a slot, always `aria-hidden`.
- `IconName`, `ICON_NAMES` - the glyph set; every glyph has a row in [icon-inventory.md](icon-inventory.md).
- `ICON_SLOTS`, `IconSize`, `ICON_STROKES` - the four slots and their strokes, equal to the `tokens.css` icon tokens.

### Loading (`ui/Skeleton.tsx`)

- `Skeleton` - an `aria-busy` placeholder in one of ten shapes, with a retry.
- `SkeletonVariant` - the shapes.
- `REVEAL_AFTER_MS`, `useRevealed` - skeletons appear only after 120ms, so a quick load never flashes.

### Forms and tables

- `TextField`, `Select`, `Combobox`, `Choice` (`ui/formControls.tsx`) - labelled form controls built on `Field`.
- `DataTable`, `Column` (`ui/DataTable.tsx`) - a captioned table that stacks on phones.

### Music objects (`ui/MusicObjects.tsx`, `ui/seam.ts`)

- `SongMotif`, `VibeMotif`, `MixSignature` - decorative marks drawn from IDs only.
- `SeamFamily`, `seamFamily`, `SeamDiagram`, `RouteDiagram` - how a transition and a request path are drawn.
- `EnergyHorizon`, `HORIZON_STOPS`, `measuredHorizon`, `MixHorizon`, `measuredEnergy`, `energySummary`, `EnergyOverview`, `EnergyThumb` - the energy arc, its overview and thumbnail.
- `FeelDiagram`, `LengthScale` - a mix's feel and length.
- `SeamLayers`, `seamLayers`, `SeamFacts`, `seamFacts` - what a seam is made of, in words.

### Shell-level panels and hooks

- `ActivityPanel` (`ui/ActivityPanel.tsx`) - Activity: what happened, with Undo kept after the toast.
- `CommandPalette` (`ui/CommandPalette.tsx`) - search and commands.
- `usePaletteSongs` (`ui/paletteSongs.ts`) - songs as palette commands.
- `AudioPreview` (`ui/AudioPreview.tsx`) - a play/stop preview through the audio owner.
- `GlossaryDialog`, `GlossaryHost`, `TermHint` (`ui/Glossary.tsx`) - the glossary and inline "What is" hints.
- `GlossaryTerm`, `GLOSSARY`, `glossaryOn`, `glossaryTerm`, `foldText`, `searchGlossary` (`ui/glossaryTerms.ts`) - the glossary data and search.
- `THEMES`, `ThemeMenu`, `ThemeChoices` (`ui/ThemeChoice.tsx`) - Light, Dark and System.
- `hadNoRealFocus`, `pageStart`, `returnFocus` (`ui/focusReturn.ts`) - where focus goes after a route change or a closed overlay.
- `useVisiblePoll` (`ui/useVisiblePoll.ts`) - polling that pauses in a hidden tab and backs off on failure; every poll is registered in `state/pollingPolicy.ts`.
- `useMediaQuery` (`ui/useMediaQuery.ts`) - a media query as state.
- `scrollParent`, `useStickyClearance` (`ui/useStickyClearance.ts`) - keeping a focused control clear of sticky bars.
- `ControlGallery` (`ui/ControlGallery.tsx`) - the development-only specimen sheet, below.

## Galleries

- **Local:** `ControlGallery` renders under Workspace > Diagnostics at `/workshop/diagnostics` when `import.meta.env.DEV`, or in a build made with `VITE_SELECTA_GALLERY=1`. `web/e2e/mp-0279-component-gallery.e2e.ts` measures it ([ADR-0279](../adr/adr-0279-shared-component-visual-specimens.md)). It does not yet show every `ui/` export (for example `Meter`, `ConfirmDialog`, `BrandMark` and the compact density); completing it is ADR-0468 BF-0468-07.
- **Cloud:** the Cloud test harness (`web/cloud-harness.html`, `web/src/harness/main.tsx`) has no gallery route yet; the planned `?page=gallery` route for Cloud patterns is ADR-0468 BF-0468-07.

## Guard-test index

Static guards that read the real sheets and sources (`web/src/styles/`, run with `pnpm exec vitest run src/styles`):

| Test | Keeps true |
| --- | --- |
| `uf-cascade.test.ts` | Load order matches [css-ownership.md](css-ownership.md); every sheet has an owner; every `!important` is a listed exception; raw colours only in `tokens.css`; meaning tokens defined only there. Covers `style.css`, `styles/*.css` and the Cloud, Rooms and Devices sheets. |
| `css-ownership.test.ts`, `mp-css-register.test.ts` | The ADR-0278 selector and breakpoint register in `docs/adr/completion/css-ownership.md`. |
| `spacing-tokens.test.ts` | Every margin, padding and gap is a spacing role or a listed exception ([spacing-token-map.md](spacing-token-map.md)). Covers the Cloud, Rooms and Devices sheets too. |
| `motion-tokens.test.ts` | Every duration is a motion token or a listed loop or clock exception; every keyframe is in [motion-inventory.md](motion-inventory.md). Covers the Cloud, Rooms and Devices sheets too. |
| `typography.test.ts`, `ufTypeRoles.test.ts` | The type roles exist, step down, are what the sheets use; changing numbers are tabular. |
| `surface-depth.test.ts` | Surface roles, radius roles, lime hierarchy and depth. |
| `optical-alignment.test.ts` | Page anchors and pixel edges. |
| `icon-geometry.test.ts` | Every glyph has a row in [icon-inventory.md](icon-inventory.md), drawn at a listed slot by a listed owner. Scans `ui/`, `views/` and `shell/`. |
| `boundary-roles.test.ts`, `sf0201ThemeCharacter.test.ts` | Edge roles; the two Light switches stay identical; Dark depth and Light character. |
| `s4-colour-consumers.test.ts` | Every other stylesheet and script in the site uses colour roles, with the few literals listed. |
| `s4-forced-colours.test.ts` | Forced-colours rules speak only in system colours. |
| `layer-precedence.test.ts` | [layer-precedence.md](layer-precedence.md): every fixed and sticky layer and what yields. |
| `music-graphics-inventory.test.ts` | [music-graphics-inventory.md](music-graphics-inventory.md). |
| `scope-collisions.test.ts` | No two page sheets style the same bare class. |
| `sfCascadeRatchet.test.ts` | The consolidation ratchet in [css-ownership.md](css-ownership.md). |
| `sf0202ReadingRhythm.test.ts`, `sf0203NestedCards.test.ts`, `sfCoarsePointer.test.ts`, `sfStateConsistency.test.ts`, `flow-fonts.test.ts` | Reading rhythm, no card in a card, coarse-pointer targets, one hover/focus/active language, system fonts only. |
| `lx-design-language.test.tsx` | Lucy's sheet uses only the app's tokens ([library-lucy-design-language.md](library-lucy-design-language.md)). |

Other guards that hold the system together: `src/copyAudit.test.ts` (one copy vocabulary), `src/state/pollingPolicy.test.ts` (every timer registered), `src/singleOwner.test.ts` (one audio owner), `src/importBoundaries.test.ts` and `src/routeChunks.test.ts` (bundle boundaries, so the hosted bundle stays engine-free), `src/ui/destructiveIcons.test.ts` (the close X never deletes), `src/shell/mpSurfaceInventory.test.ts` (the surface inventory `docs/adr/mp-0272-surface-inventory.json`), and the component tests beside each new part (`ui/ConfirmDialog.test.tsx`, `ui/Meter.test.tsx`, `ui/format.test.tsx`, `ui/exitMotion.test.tsx`).

Planned and not written yet (ADR-0468 BF-0468-07 and BF-0468-08): `gallery-completeness.test.ts` (every `ui/` export in the gallery); widened scopes for `surface-depth`, `typography`, `optical-alignment` and `icon-geometry` over every sheet; bans on `window.confirm`, glyph icons, raw `setInterval` outside the polling policy, hidden-input pickers without a keyboard path, em dashes in user copy and new docs, widths outside `breakpoints.ts`; and the guest/display palette drift guard.

## Owning ADRs

| ADR | Owns |
| --- | --- |
| [ADR-0273](../adr/adr-0273-spacing-and-vertical-rhythm.md) | Spacing and vertical rhythm |
| [ADR-0275](../adr/adr-0275-typography-and-long-song-names.md) | Type roles and long names |
| [ADR-0276](../adr/adr-0276-colour-surface-depth-and-borders.md) | Colour, surfaces, depth and borders |
| [ADR-0277](../adr/adr-0277-iconography-badges-and-button-geometry.md) | Icons, badges and button geometry |
| [ADR-0279](../adr/adr-0279-shared-component-visual-specimens.md) | The component gallery |
| [ADR-0295](../adr/adr-0295-overlays-toasts-and-command-palette.md) | Overlays, toasts and the command palette |
| [ADR-0296](../adr/adr-0296-motion-and-music-clock.md) | Motion and the music clock |
| [ADR-0297](../adr/adr-0297-loading-recovery-and-layout-stability.md) | Loading, recovery and layout stability |
| [ADR-0368](../adr/adr-0368-design-tokens-and-css-ownership.md) | Design tokens and CSS ownership |
| [ADR-0370](../adr/adr-0370-shared-controls-overlays-and-feedback.md) | Shared controls, overlays and feedback |
| [ADR-0462](../adr/adr-0462-shared-web-shell-and-component-reuse.md) | One shared web shell and component reuse for Cloud |
| [ADR-0463](../adr/adr-0463-local-first-cloud-ux-surfaces-and-onboarding.md) | Local-first Cloud surfaces and onboarding |
| [ADR-0468](../adr/adr-0468-one-shell-and-design-system-consolidation.md) | One shell, the consolidation decisions and their checklist |
