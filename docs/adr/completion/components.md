# Shared component contracts and states

Shared parts live in `web/src/ui/controls.tsx`, `web/src/ui/primitives.tsx`, `web/src/ui/toasts.tsx`,
`web/src/ui/Skeleton.tsx`, `web/src/ui/MusicObjects.tsx`, and since the UI/UX overhaul `web/src/ui/ConfirmDialog.tsx`,
`web/src/ui/Meter.tsx`, `web/src/ui/BrandMark.tsx` and `web/src/ui/format.ts`. Every `ui/` export is catalogued in
[docs/engineering/design-system.md](../../engineering/design-system.md#component-catalogue).

The development-only gallery (`web/src/ui/ControlGallery.tsx`, shown in Workspace › Diagnostics at
`/workshop/diagnostics` when `import.meta.env.DEV`, or in a test build made with `VITE_SELECTA_GALLERY=1`) renders a
selection of these parts in both themes, not all of them. ADR-279 measures what it shows in
`web/e2e/mp-0279-component-gallery.e2e.ts`: actions, fields (a `Field` with hint and error), tabs, a menu, 8 of the
11 status kinds (not `paused`, `recovering` or `blocked`), 9 of the 10 skeleton variants (not `rows`), a dialog, a
drawer, a problem with Retry and an empty state. It does not yet show `ConfirmDialog`, `Meter`, `BrandMark`, toasts,
`announce`, the command palette, `Section`, the music objects or the compact density, and there is no Cloud gallery.
A completeness test that fails when a `ui/` export is missing from the gallery (`gallery-completeness.test.ts`) is
pending: [ADR-0468](../adr-0468-one-shell-and-design-system-consolidation.md) BF-0468-07.

## Contracts

| Component | Role / ARIA | Keyboard | States | Notes |
|---|---|---|---|---|
| `Action` | `button`, `aria-busy` while pending | Enter/Space once | default, hover, focus, pressed, busy, disabled, failed (with retry) | can't run twice; only the pressed one shows busy; survives unmount |
| `IconButton` | `button` with required `label` | Enter/Space | as Action | icon is `aria-hidden` |
| `Field` | label + control + help + error joined by `aria-describedby`; `aria-invalid` on error | native | default, focus, invalid, disabled | never placeholder-only |
| `SearchField` | `searchbox` with label and Clear | Escape clears or hands back | empty, typing, cleared | stale results are the caller's guard |
| `Slider` | `input[type=range]` with `aria-valuetext` | arrows, Page Up/Down, Home/End | default, focus, disabled | value always also shown as text |
| `Tabs` / `LinkTabs` | `tablist` / `tab` / `tabpanel`; links use `aria-current` | arrows, Home/End (tabs); Tab (links) | selected, focus | routes use links, widgets use tabs |
| `Menu` + `MenuItem` | `menu` / `menuitem`, trigger `aria-expanded`/`aria-controls` | arrows, Home/End, Escape returns to trigger, ArrowUp opens at last | open, closed, danger item | closes after choosing |
| `Popover` | disclosure button + region | Enter/Space, Escape | open, closed | not hover-only |
| `Tooltip` | adds to the control's description | shows on focus; first Escape hides only the tooltip | shown, hidden | keeps an existing description |
| `Dialog` / `Drawer` / `Sheet` / `Workspace` | `dialog`, `aria-modal`, labelled by title, inert background | focus enters, Tab is trapped, Escape closes the top one only, focus returns | open, closing | dialogs sit above toasts |
| `Status` | text + mark (never colour alone) | - | planned, queued, working, paused, recovering, ready, warning, blocked, failed, needs-action, unavailable | words always present |
| `Problem` | `alert` region with optional Retry | Retry is a button | shown | says what failed and what is safe |
| `Skeleton` | `aria-busy` region, decorative bars `aria-hidden` | - | loading | announced once; 3 pulses then still |
| `Toaster` / `showToast` | `status` (or `alert` for problems) | Undo and dismiss are buttons | info, success, problem, with Undo | ≤ 3 visible, duplicates merge, Undo stays longer, history in Activity |
| `LiveRegion` / `announce` | one polite live region | - | - | one announcement per outcome |
| `ConfirmDialog` | `alertdialog` on the shared overlay stack, labelled by its title, described by its body | destructive: focus starts on the safe answer; Tab trapped; Escape closes as Keep it; focus returns | open, working, failed (the confirm `Action` shows the failure and the dialog stays open), closing | destructive: with `undo` confirming shows the 15 s Undo toast; without it the body says it can't be undone |
| `Meter` | `progressbar` (progress) or `meter` (quantity), named by its label, `aria-valuetext` | - | determinate, indeterminate, neutral, ready, warning, danger | words always said as well as drawn; tone from `warnAt`/`dangerAt` |
| `BrandMark` | `aria-hidden` | - | - | the words beside it carry the name |
| `VisuallyHidden` | hidden from the eye, read by a screen reader (`.visually-hidden`) | - | - | the one screen-reader-only class |
| `Truncate` | text with the full value as `title`, `dir="auto"` | - | - | uses `format.ts` and the one ellipsis character |
| `SongMotif`, `VibeMotif`, `MixSignature` | decorative, `aria-hidden` | - | - | from IDs only; no artwork or genre claims |
| `SeamDiagram`, `RouteDiagram`, `EnergyHorizon`, `EnergyOverview`, `EnergyThumb` | `img` with a text label, or a labelled list | overview segments are buttons | known / unknown / planned / rendered / failed | see `MusicObjects.test.tsx` |
| `TermHint`, `GlossaryDialog` | disclosure button "What is <term>?"; dialog with search | Enter/Space, Escape | open, closed, hidden by preference | never hides warnings |
| `AudioPreview` | play/stop button through the audio owner | Enter/Space | idle, loading, playing, failed | returns the sound when done |

## Truncation

Song and artist names wrap in full where they are the focal object (Listen, Stage, Song details).
In dense rows they may truncate with an ellipsis; the full text is then always available as the
button's accessible name and `title`, and by opening the item. RTL and mixed scripts use `dir="auto"`
or `unicode-bidi: plaintext` so punctuation stays with its own text.

## Interaction state matrix

| State | Visual | Copy | ARIA |
|---|---|---|---|
| Hover | edge darkens to `--ink` | - | - |
| Focus | 2 px `--edge-focus` outline, offset | - | - |
| Pressed / on | inverted fill (`aria-pressed=true`) or selected edge | - | `aria-pressed` / `aria-selected` / `aria-current` |
| Busy | dot animation (static when reduced) | "Saving…" etc. | `aria-busy` |
| Disabled | 42 % opacity, not-allowed cursor | reason nearby or in the palette | `disabled` |
| Error | `--edge-error` + text | what failed, what is safe, Retry | `aria-invalid` / `alert` |
| Success | brief notice | what changed, Undo if reversible | `status` |
