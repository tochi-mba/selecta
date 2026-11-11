# Icon inventory

Every glyph in `web/src/ui/Icon.tsx`, what it means, the slot it is drawn at, who draws it and where its words come from. Every icon is `aria-hidden`; the words that name it always belong to the control or line it sits in. Owner: ADR-0277 (MP-0277-01 to -08).

`web/src/styles/icon-geometry.test.ts` fails when a glyph has no row here, when a row names a slot that does not exist, or when a source file draws a glyph at a slot or from a file this page does not list. `web/e2e/mp-0277-icon-geometry.e2e.ts` checks the same in the browser: every visible icon is drawn at a slot, and every control holding one has a name.

## Slots (MP-0277-02)

| Slot | Box | Stroke (24-grid units) | On screen | Use |
| --- | --- | --- | --- | --- |
| `compact` | `--icon-compact` 14px | `--icon-stroke-compact` 2.4 | 1.40px | A mark inside a status, badge, tag, check list or a line of small text |
| `toolbar` | `--icon-toolbar` 16px | `--icon-stroke-toolbar` 2.1 | 1.40px | A secondary in-panel button with small words, and small in-panel dismissals |
| `standard` | `--icon-size` 20px | `--icon-stroke` 1.7 | 1.42px | Navigation, the context bar, transport, menus and every other icon-only button |
| `hero` | `--icon-hero` 28px | `--icon-stroke-hero` 1.2 | 1.40px | A page's own mark beside its title |

The box and stroke live in `ICON_SLOTS` and `ICON_STROKES` (`web/src/ui/Icon.tsx`) and in `web/src/styles/tokens.css`; `web/src/styles/icons.css` applies the tokens by `data-size`. Before this, `Icon` let its default `width="20"` overwrite any size a caller asked for, so every icon drew at 20px.

## Glyphs (MP-0277-01)

| Icon | Purpose | Slots | Owners | Named by |
| --- | --- | --- | --- | --- |
| `play` | Start playing or previewing | standard, compact | `shell/Shell.tsx`, `views/EditorRows.tsx`, `views/EditorStory.tsx`, `views/Links.tsx`, `views/Requests.tsx`, `views/Studio.tsx` | The button's words or `aria-label`; "Playing now" tag words |
| `pause` | Pause playback | standard | `shell/Shell.tsx` | Mini-player button `aria-label` |
| `stop` | Stop a preview, voice input or Lucy run | standard | `views/Links.tsx`, `views/LucyComposer.tsx`, `views/Requests.tsx`, `views/Studio.tsx` | The button's words, or the mic button's hidden words |
| `next` | Go to the next song | standard | `shell/Shell.tsx`, `views/Now.tsx` | `aria-label` "Next song" and `title` |
| `previous` | Go back a song | standard | `views/Now.tsx` | `aria-label` "Previous song" and `title` |
| `volume` | Sound is on; press to mute | standard | `shell/Shell.tsx` | `aria-label` and `title` |
| `muted` | Sound is off; press to restore | standard | `shell/Shell.tsx` | `aria-label` and `title` |
| `music` | Listen destination | standard | `shell/manifest.ts` | The destination label |
| `mixes` | My Mixes and classic Mixes destination | standard | `shell/manifest.ts` | The destination label |
| `library` | Library destination | standard | `shell/manifest.ts` | The destination label |
| `discover` | Classic Discover destination | standard | `shell/manifest.ts` | The destination label |
| `settings` | Workspace destination; Lucy settings | standard, toolbar | `shell/manifest.ts`, `views/Lucy.tsx` | The destination label; the button's words |
| `edit` | Open the editor or edit one part | standard, toolbar | `shell/Shell.tsx`, `views/EditorStory.tsx`, `ui/ControlGallery.tsx` | The link or button words; gallery `aria-label` |
| `close` | Close, dismiss, cancel or remove; a failed status mark | standard, toolbar, compact | `ui/controls.tsx`, `ui/primitives.tsx`, `ui/toasts.tsx`, `views/Lucy.tsx`, `views/LucyDialog.tsx`, `views/LucyProposal.tsx`, `views/Mix.tsx`, `views/Requests.tsx` | `aria-label` and `title`, or the status words |
| `check` | Done, passed or ready | compact, toolbar | `ui/controls.tsx`, `views/LucyProposal.tsx`, `views/LucySongs.tsx`, `views/Requests.tsx`, `views/SeamInspector.tsx` | The words beside it |
| `warning` | Needs attention, blocked or a failed check | standard, compact | `shell/Shell.tsx`, `ui/controls.tsx`, `views/Mix.tsx`, `views/SeamInspector.tsx` | The link `aria-label`, button words or status words |
| `clock` | Queued status mark | compact | `ui/controls.tsx` | The status words |
| `minus` | Unavailable status mark | compact | `ui/controls.tsx` | The status words |
| `more` | Open a row's menu | standard | `views/Drafts.tsx`, `views/EditorRows.tsx`, `views/LibraryRow.tsx`, `views/LucyHistory.tsx` | Hidden words in the trigger, and `title` |
| `help` | Keyboard shortcuts | standard | `shell/Shell.tsx` | `aria-label` and `title` |
| `up` | Move up; collapse a disclosure | standard, toolbar | `views/Drafts.tsx`, `views/EditorRows.tsx`, `views/EditorStory.tsx`, `views/LucySongs.tsx` | `aria-label` and `title`, or the disclosure words |
| `down` | Move down; expand a disclosure or menu | standard, toolbar, compact | `views/Drafts.tsx`, `views/EditorRows.tsx`, `views/EditorStory.tsx`, `views/LucyProposal.tsx`, `views/LucySongs.tsx` | `aria-label` and `title`, or the disclosure or menu words |
| `trash` | Delete or remove | standard | `views/Drafts.tsx`, `views/EditorRows.tsx`, `views/LucySongs.tsx`, `views/Mix.tsx` | The item words, or `aria-label` and `title` |
| `plus` | Add a song, start a new chat, request | standard, toolbar, compact | `views/EditorRows.tsx`, `views/LucyHistory.tsx`, `views/Requests.tsx` | The words beside it |
| `search` | Search and commands; a search field | standard | `shell/Shell.tsx`, `ui/primitives.tsx` | The button's `aria-label`; the field's label |
| `grip` | Drag handle | standard | `views/EditorRows.tsx` | The handle's `aria-label` and `title` |
| `bell` | Activity and Undo | standard | `shell/Shell.tsx` | `aria-label` (with the count) and `title` |
| `expand` | Not drawn anywhere; kept in the set | standard | - | - |
| `explore` | Make a Mix destination | standard | `shell/manifest.ts` | The destination label |
| `folder` | Not drawn anywhere; kept in the set | standard | - | - |
| `rail` | Collapse or expand the side bar | standard | `shell/Shell.tsx` | `aria-label` and `title` |
| `command` | Not drawn anywhere; kept in the set | standard | - | - |
| `lock` | Locked song; lock and unlock | standard, compact | `views/EditorRows.tsx`, `views/LucySongs.tsx` | The words "Locked", "Lock" or "Unlock" |
| `request` | Request a song | standard | `shell/Shell.tsx` | `aria-label` (with the count) and `title` |
| `circle` | Planned status mark; an idea's scope | compact | `ui/controls.tsx`, `views/Mixes.tsx` | The status or scope words |
| `half` | Working and recovering status mark | compact | `ui/controls.tsx` | The status words |
| `dot` | Needs-you status mark | compact | `ui/controls.tsx` | The status words |
| `sun` | Light theme | standard | `ui/ThemeChoice.tsx` | The option words, or the trigger's hidden words and `title` |
| `moon` | Dark theme | standard | `ui/ThemeChoice.tsx` | The option words, or the trigger's hidden words and `title` |
| `system` | Match this computer's theme | standard | `ui/ThemeChoice.tsx` | The option words, or the trigger's hidden words and `title` |
| `mic` | Speak instead of typing | standard | `views/LucyComposer.tsx` | Hidden words and `title` |
| `thread` | Lucy's mark | hero | `views/Lucy.tsx` | The Lucy heading beside it |

## Gaps, badges, states and targets (MP-0277-03 to -08)

- **Gaps.** An icon sits `--icon-gap` (8px) from its words, `--icon-gap-dense` (4px) in the reviewed dense pairs in `spacing-token-map.md`, in a lone line of small text (`.icon-words`), a request result and a quality check. A busy `Action` keeps its idle label in place under the working words, so the gap does not change while it works; a wrapped label keeps the same gap.
- **Badges.** Request and Activity counts reserve two tabular digits from their start edge, `--icon-gap` after the icon, on the icon's vertical middle (`.context-bar .count`, `.nav .count`), so 1 to 99 moves neither the icon, the first digit nor the control's width; the mini-player's count reserves three.
- **States.** Hover, pressed, current, focused and disabled each change something other than hue: an edge appears, the fill or ink changes lightness, a focus ring is drawn, or the control fades.
- **Icon-only controls.** Each has an `aria-label` or hidden words, a `title` (or the Listen tooltip when shortcuts are on), a focus ring, and a target of at least 24px on a fine pointer and 44px on touch.
- **Direction.** No glyph mirrors in a right-to-left page: transport keeps the tape direction, as media players do, and up and down are vertical. Badges follow their icon in reading order.
