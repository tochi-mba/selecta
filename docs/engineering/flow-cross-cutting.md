# Flow cross-cutting contracts

Inventories behind the Selecta / Flow cross-cutting ADRs (ADR-0232, ADR-0237, ADR-0238, ADR-0243).
Each section names the source that owns the behaviour and the tests that prove it.
`tests/test_flow_cross_cutting.py` checks that every file named here exists and that the network
egress list below matches the code. Written 2026-11-10 against branch `feat/finish-checklists`.

## Feedback taxonomy (SF-0232-01)

| Family | What it means | How it shows | Owner |
|---|---|---|---|
| Success | The server confirmed it happened | `info` toast (`role=status`), `Status kind="ready"` (check mark, "Ready") | `web/src/ui/toasts.tsx`, `web/src/ui/controls.tsx` |
| Pending | Asked for, not done yet | `planned` (circle), `queued` ("In line", clock), `working` ("Working on it", half), `Action` busy label with `aria-busy` | `web/src/ui/controls.tsx` |
| Blocked | Can't start until something changes | `Status kind="blocked"` ("Blocked"), disabled command with its reason in the palette | `web/src/ui/controls.tsx`, `web/src/shell/commands.ts` |
| Failed | Tried and didn't work | `problem` toast (`role=alert`, stays longer), `Problem` with Try again, `Status kind="failed"` ("Didn't work", close mark) | `web/src/ui/toasts.tsx`, `web/src/ui/controls.tsx` |
| Conflict | The thing moved on underneath the change (HTTP 409) | `problemKind()` returns `conflict`; the page says the mix moved on, refetches, and touches nothing | `web/src/api.ts` |
| Needs you | Only a person can unblock it | `Status kind="needs-action"` ("Needs you", dot) | `web/src/ui/controls.tsx` |

Proof: `web/src/state/feedbackTaxonomy.test.tsx` (distinct words and marks, conflict versus failure);
`web/src/ui/controls.test.tsx` ("problems are announced as problems", "never rely on colour alone");
`web/e2e/flows.e2e.ts` ("a change to a mix that's moved on stops, says so, and touches nothing").

## Undo availability (SF-0232-02)

Undo is offered only where the server keeps a restore point or the client holds the exact inverse.

| Action | Undo | How it's reversed |
|---|---|---|
| Add, move, remove, play next, clear mix, change a seam, a mix from a song, add a wordplay link | Toast Undo, Activity, palette "Undo the last change" | `POST /api/mix/undo` with the scope (current mix or draft) named |
| Delete a draft | Toast Undo | The toast's own restore function (`web/src/views/Drafts.tsx`, `web/src/views/Mix.tsx`) |
| Request joined into the mix | Undo on the "joined" message, only while the mix order is unchanged | `web/src/views/Requests.tsx` sends `x-mix-order` with the undo |
| Library tempo, key or music/not-music correction | "Go back to what was measured", not a toast | Override is cleared server side; the file is never written |
| Studio arrangement suggestion | "Put it back" restores the previous working grid | Local working copy, nothing applied until "Apply to this transition" |
| Export, render, cancel a request, delete a Lucy conversation, stop watching a folder | No Undo | Irreversible or a side effect; confirmed first or worded as final ("for good") |

Proof: `web/src/ui/controls.test.tsx` ("Undo runs what that message was about", "says so if undoing
fails", "keeps older Undo blocked while the newer one runs and after it fails"),
`web/src/ui/CommandPalette.test.tsx` ("shows exact Undo scope but refuses an unavailable mutation"),
`web/src/shell/commands.test.ts`, `web/src/views/Drafts.test.tsx`, `web/src/views/Mix.test.tsx`,
`web/src/views/Requests.test.tsx` ("can be undone from the message that says it joined"),
`web/e2e/flows.e2e.ts` ("editing: move with the buttons, undo it, and remove a song",
"the Library: search, song details, a correction that can be put back"),
`web/e2e/integration.e2e.ts` ("... neither touches the other, and Undo knows which is which").

## Destructive confirmations (SF-0232-05)

| Action | Confirmation states | Cancel keeps |
|---|---|---|
| Delete a draft | `Delete <name>?`, and whether Undo can restore it | The draft (`Keep this draft`) |
| Clear the current mix | `Clear the current mix?`, and that Undo can bring it back until a newer edit | The mix |
| Replace the playing mix with an idea | Which mix takes over from which, and that it's playing or paused | The playing mix |
| Library batch action | The exact flags and count it applies to; refused if the filter changed while open | The songs |
| Stop watching a folder | `Stop watching this folder?`; files are not deleted | The watch |
| Replace local data from a backup | `Replace local data on next restart?` with a preview | The current data |
| Delete a Lucy conversation | `Delete this conversation?` | The conversation |

Proof: `web/src/views/Drafts.test.tsx` ("confirms before deleting, preserves the draft on cancel and
supports Undo", "keeps the delete confirmation and error visible when the server rejects the
deletion"), `web/src/views/Mix.test.tsx` ("deleting closes it, goes back to the list, and can be
undone"), `web/src/views/Library.test.tsx` ("refuses a confirmed batch action if a different filter
takes over while the dialog is open", "shows exact current flags before confirming a batch edit"),
`web/e2e/flows.e2e.ts` ("requests: asking, then seeing it find a place, and cancelling for good").

## Musical provenance and authority (SF-0237-01)

| Object | Authority | Uncertainty shown as | Owner |
|---|---|---|---|
| Song identity | Library recording ID, never the title | Duplicate titles carry "(song N)" | `web/src/ui/paletteSongs.ts`, `web/src/views/Library.tsx` |
| Song tempo and key | Analysis (measured) unless a person corrected it | "Not ready for mixes", "Being analysed", "Couldn't be analysed", "File is missing"; correction can go back to measured | `web/src/state/readiness.ts` |
| Song energy | Measured per song; the shape asked for is a request | Unknown energy is a gap, never an estimate | `web/src/ui/MusicObjects.tsx` |
| Transition (seam) | The rendered move; the asked-for move is a request | Fallback named separately; cut-off and blocked seams are not "ready" | `web/src/state/readiness.ts`, `web/src/views/SeamInspector.tsx` |
| Requests and bridges | The mix after the server joined it | A proposed route is never shown as joined | `web/src/views/Requests.tsx` |
| Mix order and revision | Server mix with its order header | 409 conflict when it moved on | `web/src/api.ts` |
| Playback | The one player's clock | Paused, missing audio and unready seam each say so | `web/src/player.ts` |
| Background jobs | Server job status | Incomplete status from another version doesn't crash; failures counted | `web/src/state/jobs.ts` |

Proof: `web/src/ui/MusicObjects.test.tsx`, `web/src/state/readiness.test.ts`,
`web/src/state/jobs.test.ts`, `web/src/views/Library.test.tsx` (readiness words),
`web/src/views/Mix.test.tsx` ("keeps the move you asked for pressed, and names what really plays separately").

## Gesture affordances and keyboard equivalents (SF-0243-01)

| Gesture | Visual clue | Keyboard or button equivalent | Cancel | Owner |
|---|---|---|---|---|
| Reorder a song | Grip handle (`draggable`, `touch-action: none`) | Move up/down buttons; grip takes arrow keys and Space | `pointercancel` clears the drop target | `web/src/views/EditorRows.tsx` |
| Seek | Crosshair over the strip (`role=slider`) | Arrow keys on the slider, media keys | `pointercancel` and lost capture restore | `web/src/views/Now.tsx` |
| Shape the energy horizon | Crosshair over the horizon | Five labelled stop controls | `pointercancel` | `web/src/views/MixSetup.tsx`, `web/src/ui/MusicObjects.tsx` |
| Paint Studio squares | Square grid (`touch-action: none`) | One tab stop, arrows move, Space toggles | `pointercancel` ends the stroke; Escape leaves | `web/src/views/Studio.tsx` |
| Resize the inspector | Separator (`role=separator`) | Arrow keys on the separator | Pointer release | `web/src/views/Mix.tsx` |

Proof: `web/src/views/Studio.test.tsx` ("is one tab stop, moves with the arrow keys, and Space turns a
square on or off", "paints a consistent value over touched cells without re-toggling a revisited
cell"), `web/e2e/finishing.e2e.ts` ("reordering with the keyboard moves the song, and focus stays on
it", "the full Studio grid works at the smallest size ..."), `web/src/state/shortcuts.test.ts`
("leaves Space to a custom role=button reorder grip and its children").

## Network egress and local files (SF-0238-01)

In local mode the server binds `127.0.0.1` (`src/selecta/cli.py`) and the page only talks to it.
Only these modules may open outbound connections:

| Module | Destination | What is sent | When |
|---|---|---|---|
| `src/selecta/lyrics/lrclib.py` | `lrclib.net` | Title, artist, album, duration; never audio | Lyric lookup, disclosed on first run; off with the lyrics flag |
| `src/selecta/lucy/providers.py` | The AI provider the person configured | Lucy conversation and the mix facts it needs | Only when Lucy is set up and used |
| `src/selecta/analysis/key.py` | GitHub raw (S-KEY weights, pinned commit) | Nothing but the download request | First key analysis without cached weights |
| Cloud-only: `src/selecta/billing/webhooks.py`, `src/selecta/identity/tokens.py`, `src/selecta/identity/workos.py`, `src/selecta/identity/deletion_effects.py`, `src/selecta/storage/r2.py`, `src/selecta/workers/remote.py` | Cloud services | Cloud mode only (ADR-0391, ADR-0392) | Never in local mode |
| Cloud image build only: `src/selecta/workers/model_lock.py` | The pinned model URLs in `services/worker/models.lock.json` | Nothing but the download request; each file is checked against its SHA-256 | Only when the Cloud worker image is built (ADR-0396); never at run time or in local mode |

Local files: original music is only read; analysis, stems, renders and exports go under the Selecta
home (`SELECTA_HOME`, default `~/.selecta`). No module changes file permissions.
Proof: `tests/test_flow_cross_cutting.py` (egress allowlist and local bind),
`web/e2e/pages.e2e.ts` ("the page only ever talks to this computer"),
`web/e2e/finishing.e2e.ts` ("a first run says what leaves this PC before anything is sent").

## Breakpoint behaviour per scene (SF-0233-01)

Widths are the `max-width` media queries in the owning stylesheets; heights are `max-height`.
Every row is exercised by `web/e2e/mp-0298-responsive-and-a11y.e2e.ts` ("MP-0298-01 every page
holds from 320 to 3840px, at both sides of 620 and 760, and in short landscape").

| Scene | Wide (over 1040px) | 1040px and below | 760px and below | 620px and below | Short height | Owner |
|---|---|---|---|---|---|---|
| Shell and navigation | Side rail (`min-width: 761px`) | Side rail | Bottom bar; Request becomes an icon; drawers and sheets rise from the bottom at full width | Same | Dialogs start at the top and fit the window (`max-height: 520px`); with an on-screen keyboard up, overlays pad by `--keyboard-inset` | `web/src/styles/shell.css` |
| Listen | Stage and side column | One column; side column stops being sticky | Song identity, transport, then display options in that order | Mini-player requests compact at 420px | Transport stays fixed | `web/src/styles/listening.css` |
| Make a Mix ideas | Three cards a row | Two cards a row | Two cards a row | One card a row | Scrolls | `web/src/styles/listening.css` |
| Mix editor and inspector | Timeline with the inspector beside it | Inspector below the timeline | Editor actions in a two-column grid, primary action full width | Song rows wrap their actions under the title | Scope bar stops being sticky (`max-height: 420px`) | `web/src/styles/creation.css`, `web/src/styles/shell.css`, `web/src/styles/typography.css` |
| Library | Column headers over rows | Headers hidden, actions beside facts (`max-width: 1024px`) | Same | One column: name, facts, readiness, actions | Scrolls | `web/src/styles/operations.css` |
| Requests and Workshop | Rows with status beside | Same | Same | Request status moves under the song at 520px; job rows stack at 560px | Scrolls | `web/src/style.css`, `web/src/styles/shell.css` |

## Feature parity: each capability's tested journey (SF-0247-05)

Each capability row in `docs/adr/selecta-flow-feature-parity.md` names its source there; this table
names the end-to-end journey that proves it still works. `tests/test_flow_cross_cutting.py` checks
every capability is listed and every test named exists in its file.

| Capability | Tested journey |
|---|---|
| All navigation/scene routes | `web/e2e/pages.e2e.ts` "Back and Forward go where they should" |
| Player and manual Pause | `web/e2e/listen.e2e.ts` "Pause stops the clock, and Resume carries on from the same place" |
| Listen and current song identity | `web/e2e/listen.e2e.ts` "moving around the app leaves the music alone, and the mini-player follows" |
| Fifteen spectrum styles | `web/e2e/creative-visualizers.e2e.ts` "all thirteen additional horizontal visualizers are selectable without restarting real audio" |
| Mix idea selection | `web/e2e/mp-0283-make-a-mix.e2e.ts` "MP-0283-07 saving, building and a failure keep each card its size, and what is playing keeps playing" |
| Energy shaping | `web/e2e/mp-0283-make-a-mix.e2e.ts` "MP-0283-06 Shape groups energy, length and song count, with Done and Escape to leave" |
| Track and seam editor | `web/e2e/flows.e2e.ts` "editing: move with the buttons, undo it, and remove a song" |
| Transition preview | `web/e2e/listen.e2e.ts` "a preview takes the sound, and gives it back when it’s done" |
| Stem Studio | `web/e2e/finishing.e2e.ts` "the full Studio grid works at the smallest size: it scrolls by itself, and the keyboard can reach all of it" |
| Requests | `web/e2e/flows.e2e.ts` "requests: asking, then seeing it find a place, and cancelling for good" |
| Library at scale | `web/e2e/mp-0291-library.e2e.ts` "MP-0291-07 a 20,000-song library pages, searches and keeps focus without jumping" |
| Song metadata and repairs | `web/e2e/flows.e2e.ts` "the Library: search, song details, a correction that can be put back" |
| Current mix vs drafts | `web/e2e/integration.e2e.ts` "editing a draft while the current mix plays: neither touches the other, and Undo knows which is which" |
| First-run setup | `web/e2e/finishing.e2e.ts` "the first run says which stage it’s at, from what the server says, and each can go wrong on its own" |
| Workshop operations | `web/e2e/flows.e2e.ts` "Workshop tells the truth about what’s running, and diagnostics hold nothing private" |
| Frozen FLAC export | `web/e2e/flows.e2e.ts` "saving a mix as an audio file makes a real FLAC" |
| Human comparison studies | `web/e2e/flows.e2e.ts` "the listening test: nothing gives away which is which, and a failed send can be retried" |
| Themes and user preferences | `web/e2e/finishing.e2e.ts` "changing the theme while playing starts nothing again, and the title bar follows" |
| Keyboard/AT/responsive | `web/e2e/flows.e2e.ts` "keyboard alone gets from the top of the page to the content, and dialogs give focus back" |
| Performance and recovery | `web/e2e/flows.e2e.ts` "it says so, keeps what’s on screen, and recovers by itself" |
| Privacy and source safety | `web/e2e/pages.e2e.ts` "the page only ever talks to this computer" |

## Accessibility automation and its manual gap (SF-0239-05)

What a machine checks on every run, and what only a person can. `tests/test_flow_screenshot_approval.py`
checks every test named here still exists in its file.

| Check | Automated proof | Manual gap |
|---|---|---|
| Contrast (text, large text, field edges) | `web/e2e/mp-0298-responsive-and-a11y.e2e.ts` "MP-0298-05 text meets 4.5:1, large text 3:1 and field edges 3:1 in both themes"; `web/e2e/pages.e2e.ts` "every page passes the automatic accessibility checks in" (axe, light and dark) | Judging contrast over moving art and in dim rooms |
| Names, roles and labels | `web/e2e/pages.e2e.ts` "dialogs and drawers pass the automatic accessibility checks too"; `web/e2e/mp-0277-icon-geometry.e2e.ts` "MP-0277-07 icon-only controls have a name, a hint, a focus ring and a usable target" | Whether a name makes sense when heard in NVDA or VoiceOver |
| Focus order and visibility | `web/e2e/finishing.e2e.ts` "Tab reaches everything on every page at"; `web/e2e/flows.e2e.ts` "keyboard alone gets from the top of the page to the content, and dialogs give focus back" | A full NVDA with Edge session through each journey |
| Target size | `web/e2e/mp-0298-responsive-and-a11y.e2e.ts` "MP-0298-03 every target meets 24px or a WCAG exception, and primary touch targets reach 44px" | Real fingers and styluses on real phones |
| Reflow and zoom | `web/e2e/mp-0298-responsive-and-a11y.e2e.ts` "MP-0298-02 200% and 400% zoom keep every page actionable, and the Studio has its list form" | Browser zoom and OS text scaling on real devices |
| Reduced motion | `web/e2e/mp-0296-motion.e2e.ts` "MP-0296-06 Still and reduced motion remove decorative movement while the music data keeps updating"; `web/e2e/motion-preference.e2e.ts` "motion intensity is local and OS reduced-motion always wins" | Whether remaining motion is comfortable for people sensitive to it |
| Forced colours | `web/e2e/flow-forced-colors.e2e.ts` "forced colours keep controls visible, and selection and focus distinct" | Windows High Contrast themes other than the emulated one |
| Live announcements | `web/e2e/finishing.e2e.ts` "playing doesn’t flood a screen reader" | A screen-reader listening study (SF-0234-05) |
