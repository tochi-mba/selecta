# Action-tier register: every primary surface's actions, by tier (FP-0269-01, -02, -05)

One row per existing action on each primary surface: its exact label, the state it is offered in, how often
it is used, what it costs if pressed by mistake, where it lives in the source, and its tier. Labels are
quoted exactly as the source writes them; `web/src/shell/actionTierRegister.test.ts` fails if a label is
no longer in its source file, if a surface lacks exactly one primary action (or a justified pair), or if a
tier is not one of the three below.

## Tier rubric

- **primary**: the one obvious next step for an ordinary visit in that state. Usually filled lime with dark ink
  (`.primary`), first in reading order, visible without any disclosure.
- **contextual**: shown only when its state is true (a selection, a seam, a playing song, a draft), or a
  secondary step next to the primary one. Quiet styling, still visible without a disclosure.
- **advanced**: professional or rarely used. Always reachable by a named disclosure, menu, tab or
  dialog with words on it, never by hover or a shortcut alone (FP-0269-04).

**Written exceptions.** Emergency, error and destructive controls are not demoted by frequency:
a retry on a failure is shown at the failure (contextual, never advanced); a destructive action
(delete, clear, replace the playing mix) always opens a confirmation that names its consequence,
and its Undo is offered in the notice afterwards; Pause is always on screen while music plays.
**Justified pairs:** Explore cards offer Play and Shape first side by side because they are equally
direct ways into the same mix (one plays, one opens the editor); Library's selection rail offers
Prioritize and Never play as equal bulk changes.

Older ADRs that own these surfaces and are not changed by this register: ADR-0204 (navigation),
ADR-0234 (themes), ADR-0257 to ADR-0259 (Library selection, Explore truthfulness), ADR-0267 and ADR-0268.

## Register

| Surface | State | Action | Tier | Frequency | Cost or risk | Source |
|---|---|---|---|---|---|---|
| Explore | ideas loaded | `Play` | primary | every visit | replaces the playing mix, after a confirmation; Undo afterwards | `web/src/views/Mixes.tsx` |
| Explore | ideas loaded | `Shape first` | primary | often | builds a new mix and opens it for editing; nothing plays | `web/src/views/Mixes.tsx` |
| Explore | ideas loaded | `Save draft` | contextual | sometimes | saves a draft; playback unchanged | `web/src/views/Mixes.tsx` |
| Explore | any | `Customize` | advanced | sometimes | opens the shaping dialog; changes only the next mix | `web/src/views/Mixes.tsx` |
| Explore | card detail open | `Use this feeling with Lucy` | advanced | rare | opens an editable prompt; nothing is sent | `web/src/views/Mixes.tsx` |
| Explore | replace confirmation | `Replace and play` | primary | per replace | replaces the playing mix; Undo afterwards | `web/src/views/Mixes.tsx` |
| Explore | replace confirmation | `Save as draft instead` | contextual | sometimes | keeps the playing mix; saves the new one as a draft | `web/src/views/Mixes.tsx` |
| Listen | playing | `Next song` | contextual | often | moves on one song; reversible with Previous | `web/src/views/Now.tsx` |
| Listen | playing | `Previous song` | contextual | sometimes | goes back one song | `web/src/views/Now.tsx` |
| Listen | playing | `Fullscreen lyrics` | contextual | sometimes | Stage view; playback unchanged | `web/src/views/Now.tsx` |
| Listen | Stage | `Exit fullscreen` | primary | per Stage | leaves the Stage; focus returns; playback unchanged | `web/src/views/Now.tsx` |
| Listen | any | `DJ controls` | advanced | rare | discloses visualizer and view options | `web/src/views/Now.tsx` |
| Listen | after a transition | `Rate that transition` | contextual | sometimes | records a rating; can be changed | `web/src/views/Now.tsx` |
| Listen | playing | `Change what plays next` | advanced | rare | opens requests for the next song | `web/src/views/Now.tsx` |
| My Mixes | current mix exists | `Edit` | primary | often | opens the current mix's editor | `web/src/views/CurrentMix.tsx` |
| My Mixes | no current mix | `Find a mix` | primary | first visit | goes to Explore | `web/src/views/CurrentMix.tsx` |
| My Mixes | current mix exists | `Save current mix as a draft` | contextual | sometimes | copies the mix; playback unchanged | `web/src/views/Drafts.tsx` |
| My Mixes | drafts listed | `Delete draft` | contextual | rare | destructive: confirmation, then Undo in the notice | `web/src/views/Drafts.tsx` |
| My Mixes | any | `New draft` | contextual | sometimes | creates an empty draft | `web/src/views/Drafts.tsx` |
| Editor | current mix loaded | `Play from the top` | primary | often | plays the current mix from its first song | `web/src/views/Mix.tsx` |
| Editor | draft loaded | `Play this mix` | primary | per draft | makes the draft the playing mix | `web/src/views/Mix.tsx` |
| Editor | song selected | `Play from here` | primary | often | plays the current mix from that song | `web/src/views/EditorRows.tsx` |
| Editor | song selected | `Add a song after this` | contextual | sometimes | opens the adder after that song | `web/src/views/EditorRows.tsx` |
| Editor | mix loaded | `Download audio` | advanced | rare | opens the export dialog; renders a file, never changes the mix | `web/src/views/Mix.tsx` |
| Editor | mix loaded | `Transition into this song` | contextual | often | selects that seam in the inspector | `web/src/views/EditorRows.tsx` |
| Editor | seam selected | `Open the Studio` | advanced | sometimes | opens the stem Studio for that seam | `web/src/views/SeamInspector.tsx` |
| Editor | after a change | `Undo` | contextual | often | restores the previous revision | `web/src/views/Mix.tsx` |
| Editor | clear confirmation | `Clear the current mix?` | contextual | rare | destructive: named confirmation, then Undo | `web/src/views/Mix.tsx` |
| Studio | grid open | `Apply to this transition` | primary | per Studio visit | saves the shape and re-renders that one seam | `web/src/views/Studio.tsx` |
| Studio | grid open | `Detailed list` | advanced | rare | same 64 cells as a list; no change | `web/src/views/Studio.tsx` |
| Library | songs loaded | `Start a mix` | primary | often | builds a mix from that song, after a confirmation if one is playing | `web/src/views/LibraryRow.tsx` |
| Library | songs loaded | `Details for` | contextual | often | opens song details; read-only until a correction is saved | `web/src/views/LibraryRow.tsx` |
| Library | songs loaded, none selected | `Select up to 200 loaded songs` | contextual | rare | selects loaded rows only; changes nothing | `web/src/views/Library.tsx` |
| Library | 1 to 200 selected | `Clear selection` | contextual | per selection | clears the selection; focus returns to the entry | `web/src/views/Library.tsx` |
| Library | 1 to 200 selected | `Prioritize selected` | primary | per selection | confirmation names the songs; never moves or deletes audio | `web/src/views/Library.tsx` |
| Library | 1 to 200 selected | `Never play selected` | primary | per selection | confirmation names the songs; reversible with Allow | `web/src/views/Library.tsx` |
| Library | songs not analysed | `Analyse them all` | contextual | once | starts analysis; music unchanged | `web/src/views/Library.tsx` |
| Requests | route proposed | `Use this` | primary | per request | accepts that route; consented, atomic | `web/src/views/Requests.tsx` |
| Requests | route proposed | `Don’t use a bridge` | contextual | sometimes | plays the request without a bridge song | `web/src/views/Requests.tsx` |
| Discover | pair found | `Add both to the mix` | primary | per pair | adds two songs to the current mix | `web/src/views/Links.tsx` |
| Lucy | proposal ready | `Save and play` | primary | per proposal | saves a revision and replaces the playing mix | `web/src/views/LucyApprove.tsx` |
| Lucy | proposal ready | `Save as draft` | contextual | sometimes | saves a draft; playback unchanged | `web/src/views/LucyApprove.tsx` |
| Workspace storage | any | `Download a backup` | primary | rare | writes a local archive; changes nothing | `web/src/views/LocalBackup.tsx` |
| Workspace storage | backup chosen | `Validate and preview restore` | contextual | rare | previews only; nothing replaced | `web/src/views/LocalBackup.tsx` |
| Workspace storage | preview shown | `Confirm staged restore` | contextual | rare | destructive: applies on next restart, with a named confirmation | `web/src/views/LocalBackup.tsx` |
| Shell | anywhere | `Activity and Undo` | advanced | sometimes | opens the activity list; nothing changes | `web/src/shell/Shell.tsx` |
| Shell | anywhere | `Search and commands` | advanced | sometimes | opens the command palette; every command also has an ordinary control | `web/src/shell/Shell.tsx` |
| Shell | anywhere | `Keyboard shortcuts` | advanced | rare | lists shortcuts; none is the only way to act | `web/src/shell/Shell.tsx` |

## Consequence-specific labels (FP-0269-05)

| Label | Actual effect and scope |
|---|---|
| Play (Explore) | builds a new mix and replaces what is playing, after confirmation |
| Shape first | builds a new mix and opens it in the editor without playing |
| Save draft / Save as draft | keeps a copy as a draft; never touches what is playing |
| Apply to this transition | saves the Studio shape for one seam and re-renders only it |
| Use this (Requests) | accepts that exact proposed route, atomically |
| Download audio | renders a frozen revision to a file; the mix is unchanged |
