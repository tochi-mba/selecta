# Selecta 3.0: keyboard shortcuts and the command palette

Covers S3-0068-01, S3-0068-04 and S3-0068-05. The list that both the handler and the help screen read is `web/src/state/shortcuts.ts`, so the help can only say what's true.

## Who gets a key

Highest first:

1. An open dialog, sheet, drawer or menu.
2. Whatever has focus and needs the key: a text box, select, slider, grid, menu, tab list, list box, combo box or radio group.
3. The page's own keys, handled by the page. The waveform, for example, stops its arrow keys from going further.
4. The global shortcuts below.

## Global shortcuts

| Key | Does | Collides with | How that's settled |
|---|---|---|---|
| Space | Play or pause | Pressing a focused button, link or summary | Those keep Space, and the shortcut stands aside |
| N | Jump to the transition | Typing | Stands aside in anything that takes text |
| Shift N | Next song | Typing | Same |
| P | Previous song | Typing | Same |
| ← → | Back or forward 5 seconds | Sliders, the waveform, the Studio grid, tabs | Those keep their arrows |
| M | Mute | Typing | Same |
| R | Request a song | Typing | Same |
| Z | Undo the newest change in the mix on screen | Browser undo is Ctrl Z, which is left alone | No modifier is used |
| F | Fullscreen lyrics | Typing | Same |
| / | Search your library | Firefox quick find | The page takes it, because a search is what's being asked for |
| ? | This list | Typing | Same |
| Ctrl K or Cmd K | Search and commands | Some browsers focus their own search on it | The page takes it, unless the preference is off |

## Exceptions

- Ctrl K is the only shortcut that works from a text box, because nothing being typed uses it. It does nothing while a dialog is open, because the dialog comes first.
- Anything with Ctrl, Cmd or Alt held is otherwise left to the browser and the system. Selecta doesn't intercept their shortcuts.
- Escape closes the top overlay, and only the top one. A menu inside a sheet closes first and the sheet stays open. If no overlay is open, it leaves a Stage that isn't in real fullscreen.
- In the Studio, Space toggles the focused square and arrow keys move around the grid. The whole grid is one tab stop, so neither reaches the global shortcuts.

## The command palette

- It's a dialog holding a labelled combo box and a list box: arrows choose, Enter goes, Escape closes, and focus returns to where it was.
- It only does what already has an ordinary way to do it. Nothing depends on knowing it exists, and it can be turned off from the shortcuts dialog or Workspace.
- It never deletes anything and never replaces what's playing. "Start a new mix" opens Explore, where choosing a mix has its usual warning. Enter runs only what's highlighted.
- A command that can't run stays in the list with its reason, and pressing Enter says the reason and does nothing.
- "Edit draft: X" goes by the draft's address. If that draft was deleted since the list was read, that page says so and changes nothing.
- It has no network dependency beyond reading the draft list from the local server, and no telemetry.
