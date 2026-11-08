# Journeys, scenes and storyboards

Task scripts for people to run are in [selecta-3-baseline.md](../selecta-3-baseline.md#task-scripts)
and [research-protocol.md](research-protocol.md). This page maps each journey to its actions, what
can go wrong, how it recovers, and the automated test that walks it.

## Casual listener

| Step | Action | Can go wrong | Recovery | Walked by |
|---|---|---|---|---|
| 1 | Type the music folder path | missing, unreadable, network, inside an existing folder, no audio | reason shown, nothing read, try another (`folder_check.py`) | `finishing.e2e.ts` "a folder that can’t be used says why" |
| 2 | Wait for six mix-ready songs | analysis slow or failing; lyrics lookup down | stage-by-stage progress; instrumental counts as ready | `finishing.e2e.ts` "the first run says which stage it’s at" |
| 3 | Press Play on the featured idea | build fails; double press | one build at a time, Problem with retry | `flows.e2e.ts` "a slow answer still gets an instant reaction on Start" |
| 4 | Listen; skip; steer Bigger/Calmer | seam not rendered in time; song file missing | next song comes in over the end; missing song skipped with a notice | `listen.e2e.ts` |
| 5 | Leave Listen | - | mini-player keeps playing | `listen.e2e.ts` "moving around the app leaves the music alone" |

## Live requester

| Step | Action | Can go wrong | Recovery | Walked by |
|---|---|---|---|---|
| 1 | Open Requests (R or the context bar) and search | no match; song not ready | says why; offers analysis | `Requests.test.tsx` |
| 2 | Ask for a song | duplicate ask; server slow | duplicate refused; ask is not claimed sent until confirmed | `integration.e2e.ts` "two requests at once" |
| 3 | Bridge needed | extra songs proposed | explicit consent, alternatives, "Don’t use a bridge", Play it anyway | `RequestsJoining.test.tsx` |
| 4 | Cancel | answer arrives late | cancelled request never comes back | `integration.e2e.ts` "a cancelled request that’s answered late doesn’t come back" |

## Mix creator

| Step | Action | Can go wrong | Recovery | Walked by |
|---|---|---|---|---|
| 1 | Save an idea as a draft | - | current mix untouched | `flows.e2e.ts` "drafts: make one, name it, fill it" |
| 2 | Add, move, lock, remove songs | the mix moved on in another tab | change refused with a message, nothing touched | `flows.e2e.ts` "a change to a mix that’s moved on stops" |
| 3 | Put the draft in the render line | out of disk space | render line says it stopped and where to fix it | `Drafts.test.tsx` "says when rendering has stopped for lack of room" |
| 4 | Play the draft | replacing an active mix | asks first; Cancel leaves playback alone | `App.test.tsx` "asks before replacing an active mix with a draft" |
| 5 | Undo | newer Undo running | older Undo blocked with a reason | `controls.test.tsx` "keeps older Undo blocked" |

## Expert editor

| Step | Action | Can go wrong | Recovery | Walked by |
|---|---|---|---|---|
| 1 | Select a transition; Detail view | another seam selected after reorder | selection follows the pair key | `finishing.e2e.ts` "a transition’s tabs work from the keyboard, and it stays clear which pair they’re about" |
| 2 | Change move, bars, cue | two quick changes on a slow server | last one wins; Undo shows what’s there | `finishing.e2e.ts` "two quick seam changes on a slow server" |
| 3 | Hear it; rate Good/Bad | render fails or falls back | requested move kept, actual move named | `Mix.test.tsx` "names what really plays separately" |
| 4 | Shape stems in the Studio | stems missing; pair changed | reasons per lane; stale Apply refused; work kept | `Studio.test.tsx` |
| 5 | Correct a song's tempo/key | invalid value | value kept with the error; Back to measured | `Library.test.tsx` "correcting a song" |
| 6 | Export the mix as FLAC | mix edited during export | job pinned to the saved revision | `integration.e2e.ts` "editing a draft during export keeps the job pinned" |

## Scenes

| Scene | Focal object | Primary action | Supporting data | Conflicts it resolves | Source state |
|---|---|---|---|---|---|
| Listen | the playing song | Play/Pause | next song, transition countdown, lyrics | display options never displace transport | player state + `/mix` |
| Explore | the featured idea | Play | idea cards with real facts | Play vs Shape vs Save consequences | `/vibes`, `/status` |
| Create | the mix timeline | select a song or transition | seams, energy, inspector | draft vs current scope | `/mix` or `/drafts/:id` |
| Library | the song list | search | readiness, details | loaded-only selection | `/library` |
| Workspace | the top issue | its fix | jobs, sources, storage | blockers vs background work | `/jobs`, `/folders`, `/storage` |

## Returning

What can be resumed, and how it is checked before use (`web/src/views/MyMixes.tsx`,
`web/src/views/Mix.tsx`):

| Object | Stored | Validated against | If gone or changed |
|---|---|---|---|
| Last draft edited | `selecta.recentDraft` (id + song order) in this browser | the server's draft with the same id and order | the shortcut is forgotten, nothing opens |
| Studio work not yet applied | `selecta.studio.<pair key>` | the same pair key and cell count | ignored, never applied to another pair |
| Library place | the URL (`q`, `show`, `sort`, `pages`) | the server | the page loads normally |
| Listen display choices | `selecta.listen` | allowed values | defaults |

Nothing resumes playback by itself; "Forget shortcut" clears the stored draft.

## Storyboards

1. **First playable set:** folder accepted → "Finding songs" → "Analysing N of M" → "6 ready" →
   the featured idea becomes playable → Play → Listen. Truthful moment: the counter, from the server.
2. **First handoff:** countdown from the real switch time → "Next" title → the seam plays from the
   audio clock → the next song is current. Truthful moment: the player event, not a timer.
3. **First edit:** My Mixes → Edit → select the transition → Detail view → change the move → render →
   Hear it. Truthful moment: the badge changes only when the server reports the render.
4. **Studio recovery:** change cells → leave for Library → come back → the unapplied cells are still
   there and labelled unapplied → Apply. Truthful moment: "not applied yet" until Apply returns.
5. **Request and consent:** ask → "finding a place" → bridge proposed with each extra song listed →
   approve → the whole route joins at once. Truthful moment: nothing joins before approval.
6. **Finish and export:** Download audio → confirm the frozen revision → job stages → file with its
   name and length. Truthful moment: the download appears only when the server finished the file.
