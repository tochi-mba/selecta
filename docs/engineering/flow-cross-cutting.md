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

Local files: original music is only read; analysis, stems, renders and exports go under the Selecta
home (`SELECTA_HOME`, default `~/.selecta`). No module changes file permissions.
Proof: `tests/test_flow_cross_cutting.py` (egress allowlist and local bind),
`web/e2e/pages.e2e.ts` ("the page only ever talks to this computer"),
`web/e2e/finishing.e2e.ts` ("a first run says what leaves this PC before anything is sent").
