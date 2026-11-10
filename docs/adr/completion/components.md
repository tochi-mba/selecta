# Shared component contracts and states

Shared parts live in `web/src/ui/controls.tsx`, `web/src/ui/primitives.tsx`, `web/src/ui/toasts.tsx`,
`web/src/ui/Skeleton.tsx` and `web/src/ui/MusicObjects.tsx`. The development-only gallery
(`web/src/ui/ControlGallery.tsx`, shown in Workspace › Diagnostics when `import.meta.env.DEV`, or in a
test build made with `VITE_SELECTA_GALLERY=1`) renders each state in both themes. ADR-279 measures it in
`web/e2e/mp-0279-component-gallery.e2e.ts`: actions, fields (a `Field` with hint and error), tabs, a
menu, every status kind, every skeleton variant, a dialog, a drawer, a problem with Retry and an empty
state.

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
| `Status` | text + mark (never colour alone) | - | ready, working, planned, warning, blocked, failed, recovering, request, unavailable | words always present |
| `Problem` | `alert` region with optional Retry | Retry is a button | shown | says what failed and what is safe |
| `Skeleton` | `aria-busy` region, decorative bars `aria-hidden` | - | loading | announced once; 3 pulses then still |
| `Toaster` / `showToast` | `status` (or `alert` for problems) | Undo and dismiss are buttons | info, success, problem, with Undo | ≤ 3 visible, duplicates merge, Undo stays longer, history in Activity |
| `LiveRegion` / `announce` | one polite live region | - | - | one announcement per outcome |
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
