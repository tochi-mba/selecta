# Route, surface, state and action register

Source-checked against `main` plus this PR (2026-11-08). Every row names the file that owns it, so a
reviewer can open the code instead of trusting this page. Routes come from `web/src/router.ts`,
navigation and titles from `web/src/shell/manifest.ts`, overlays from the components named below.

## Routes and destinations

| Address | Older addresses that still work | Page (`Route`) | View | Title / breadcrumb | Navigation destination |
|---|---|---|---|---|---|
| `/` and `/mixes` | `/make`, `/make-a-mix`, `/explore`, `/explore/mixes` | `mixes` / `browse` | `views/Mixes.tsx` (+ `MixSetup.tsx`) | Make a Mix | Make a Mix |
| `/mixes/mine` | `/my-mixes` | `mixes` / `mine` | `views/MyMixes.tsx`, `CurrentMix.tsx`, `Drafts.tsx` | My Mixes | My Mixes |
| `/listen` | - | `listen` | `views/Now.tsx`, `ListenEmpty.tsx` | Listen (song title while playing) | Listen |
| `/mix/current/edit` | - | `edit` / `draft: null` | `views/Mix.tsx`, `EditorHeader.tsx`, `EditorRows.tsx`, `SeamInspector.tsx`, `Studio.tsx` | My Mixes › Edit current mix | My Mixes |
| `/mixes/drafts/:id/edit` | - | `edit` / `draft: id` | same as above, scoped to the draft | My Mixes › Edit draft | My Mixes |
| `/library` (`?q`, `?show`, `?sort`, `?pages`, `?song`) | - | `library` | `views/Library.tsx`, `SongDetails.tsx` | Library | Library |
| `/discover`, `/discover/words` | `/explore/words` | `discover` / `words` | `views/Links.tsx` | Make a Mix › Word connections | Make a Mix |
| `/discover/harmonic` | `/explore/harmonic` | `discover` / `harmonic` | `views/Links.tsx` | Make a Mix › Harmonic matches | Make a Mix |
| `/workshop` | `/workspace` | `workshop` / `overview` | `views/Workshop.tsx` | Workspace | Workspace |
| `/workshop/{analysis,sources,storage,learning,diagnostics}` | `/workspace/...` | `workshop` / tab | `views/Workshop.tsx`, `WorkshopPanels.tsx`, `LocalBackup.tsx` | Workspace › tab | Workspace |
| `/listening` | `/studies` | `listening` | `views/Listening.tsx` | Listening study | Workspace |
| anything else | - | `missing` | `shell/Shell.tsx` not-found panel | "Nothing lives at this address" | none |

The `?ui=classic` and `?ui=new` parameters switch the navigation labels only (`state/prefs.ts`
`readFlagFromAddress`); every address above keeps the same meaning in both.

## Overlays and always-on surfaces

| Surface | Kind | Owner | Opens from | Closes with / returns focus to |
|---|---|---|---|---|
| Mini-player | always on (off Listen, while a mix is active) | `shell/Shell.tsx` | playback | - |
| Stage (fullscreen lyrics) | immersive view | `views/Now.tsx` | Listen "Fullscreen lyrics" | Escape / "Exit fullscreen" → the button that opened it |
| Requests | drawer | `App.tsx` + `views/Requests.tsx` | context bar, `R`, palette | Escape / Close → opener |
| Activity | drawer | `App.tsx` + `ui/ActivityPanel.tsx` | bell in the context bar, palette | Escape / Close → opener |
| More (narrow screens) | drawer | `shell/Shell.tsx` | bottom navigation "More" | Escape / Close → More |
| Keyboard shortcuts | dialog | `App.tsx` | `?`, help button, palette | Escape / Close → opener |
| Search and commands | dialog | `ui/CommandPalette.tsx` | Ctrl/Cmd K, context bar | Escape → opener |
| Music terms (glossary) | dialog | `ui/Glossary.tsx` | `?` term hints, shortcuts dialog, palette | Escape / Close → opener |
| Shape the next mix | dialog | `views/MixSetup.tsx` | Make a Mix "Customize" / "Shape first" | "Done shaping" / Escape → opener |
| Song details | sheet | `views/SongDetails.tsx` | Library row title, palette song result | Escape / Close → the row |
| Transition / Song inspector | side panel or sheet | `views/Mix.tsx` + `SeamInspector.tsx` | selecting a seam or song in Edit | Close → the selected row |
| Stem Studio | workspace panel | `views/Studio.tsx` | inspector "Open the Studio" | Close → inspector |
| Save as an audio file | dialog | `views/ExportPanel.tsx` | Edit "Download audio" | Escape / Close → opener; jobs continue in `ExportJobs.tsx` |
| Delete mix / Clear current mix | confirmation dialogs | `views/Mix.tsx` | Edit whole-mix menu | Cancel → opener |
| Delete draft | confirmation | `views/Drafts.tsx` | draft menu | Keep draft → menu |
| Apply batch Library action? | confirmation | `views/Library.tsx` | selection rail actions | Cancel → rail |
| Stop watching this folder? / Re-link a moved folder | dialogs | `views/WorkshopPanels.tsx` | Sources tab | Cancel → opener |
| Replace local data on next restart? | confirmation | `views/LocalBackup.tsx` | Storage › backups | Cancel → opener |
| Notifications | toast stack | `ui/toasts.tsx` | any outcome | dismiss / timeout; history in Activity |
| Server unreachable banner | banner | `shell/Shell.tsx` | lost connection | clears itself on reconnect |

## Special entry states

| State | Behaviour | Evidence |
|---|---|---|
| First launch (no music folder) | Setup asks for the folder before anything else, says what leaves the PC | `web/src/App.test.tsx` "asks where the music is before anything else"; `web/e2e/finishing.e2e.ts` "a first run says what leaves this PC" |
| Missing route | Not-found panel with a way back; API mistakes stay API errors | `web/src/shell/Shell.test.tsx` "an address that goes nowhere says so"; `web/e2e/pages.e2e.ts` "addresses that go nowhere say so" |
| Missing draft | Explained, never swapped for another mix | `web/src/App.test.tsx` "says so if the draft has gone" |
| Second tab starts playing | Only one tab plays; the other stops and says so | `web/e2e/listen.e2e.ts` "only one tab plays at a time" |
| Server away / back | Banner, content kept, recovers by itself | `web/e2e/flows.e2e.ts` "it says so, keeps what’s on screen, and recovers by itself" |

## State matrix

Rows are surfaces; cells say how each state is shown, or why it cannot happen there. "Skeleton" is
`ui/Skeleton.tsx`; "Problem" is `ui/controls.tsx` `Problem` with a retry; "Banner" is the shell's
offline banner.

| Surface | Initial / loading | Empty | Partial | Refreshing | Saving | Failed | Offline | Unavailable | Recovery |
|---|---|---|---|---|---|---|---|---|---|
| Make a Mix | card skeletons | Setup steps until 6 songs are mix-ready | cards with "why it can't be played yet" | cards stay, counts update | "Building…"/"Saving…" on the pressed card only | Problem on the card, current mix kept | Banner, cards kept | preset explains the missing prerequisite | retry the card |
| Listen | title/lyrics placeholders, no fake waveform | `ListenEmpty.tsx` offers Make a Mix | no lyrics / untimed / instrumental fallbacks | clock from the player, not polling | steering "Finding one…" | missing audio says so and skips | playback of loaded audio continues | seam not ready: next song comes in over the end | play again at end of mix |
| My Mixes | list skeleton | "start one" invitation | drafts with failed or missing seams flagged | render line updates in place | rename/copy/delete busy on that card | "couldn't be read" ≠ no drafts | Banner | prioritize hidden when nothing left to render | Undo after delete |
| Edit | row and inspector skeletons | one-song and empty mix messages | unrendered/failed seams with "Jump to first problem" | badges update by themselves | per-action busy, revision-guarded | moved-on mix refused with a message | change not sent says so | moves list disabled reasons | Undo, retry render |
| Studio | stems loading/separating | no stems: says why | missing lanes disabled with reasons | preview playhead from deck clock | Apply busy | stale pair refused, work kept | work kept locally | shaping unavailable says why | Put it back / local recovery |
| Library | row skeletons | "Nothing matches" with clear search | cards/rows mark not-ready reasons | "Updating results…" keeps rows | correction "Saving…" | can't load ≠ no songs | Banner | set-aside list hides batch rail | retry / clear filters |
| Requests | "Loading your requests…" text; search shows a row skeleton | "nothing asked yet" | waiting / finding a place / needs approval | polls while open | "Asking…" | each request says what failed | queued ask is not claimed sent | no mix: explains waiting | cancel, retry, keep waiting |
| Discovery | pair skeleton, preparation estimate | "nothing yet" | candidates without prepared audio | list refresh keeps place | verdict "Saving…" keeps focus | can't load ≠ nothing there | Banner | pair can't be played: still answerable | try saving again |
| Workspace | panel skeletons | no folders / no jobs | jobs queued/paused/failed counted | jobs poll while visible | budget/relink busy | each panel has its own Problem | Banner | relink preview blocks unverified songs | check again |
| Export | dialog prerequisites | not applicable: export starts from a mix that has songs; with fewer than two songs the start button is disabled (`ExportPanel.tsx`), so there is no empty export list | some seams not ready: explained before start | job stages from server | "Starting export…" | failed/expired job with Try again | job keeps running server-side | expired file not downloadable | job list after reload |
| Listening study | enrolment form | no trials left | partial study restored | not applicable: the study never polls; each trial is fetched once and the page changes only when you answer | "Saving…" | failed save stays on the trial | answer kept to retry | clip missing explained | retry send |

"Populated" is the normal view each row describes; "Success" is the Saving column's end, shown as a
notice naming what changed with Undo where it can be undone (see State rules 5 and 9). A cell that
reads "not applicable" says why that state cannot happen on that surface.

## State rules

These rules apply to every surface above (`ui/controls.tsx`, `ui/Skeleton.tsx`, `state/async.ts`):

1. **Initial:** a skeleton of the real layout; known labels and chrome are real; decorative bars are
   `aria-hidden`; the region is announced once.
2. **Empty:** says what empty means here and offers the one useful next action. Never shown while a
   load is failing or still running.
3. **Partial:** shows what is known, marks what is not, and names the reason (not ready, missing,
   failed) in words as well as marks.
4. **Refreshing:** keeps the last confirmed content, selection, focus and playback; a small
   "Updating…" status only.
5. **Saving:** only the pressed control shows it is working, cannot be pressed twice, and the rest of
   the page stays usable (`Action` in `ui/controls.tsx`).
6. **Failed:** what failed, that the music and other mixes are safe, and a retry beside the problem.
7. **Offline:** the shell banner; nothing on screen is cleared and nothing pretends to be saved.
8. **Unavailable:** the control stays visible with the reason it can't be used, rather than disappearing.
9. **Recovery:** Undo or Retry on the exact object; older Undos stay blocked while a newer one runs.

## Domain states

The interface shows server states, never guesses. Types are in `web/src/api.ts`.

| Object | States (server field) | User-facing words | Owner |
|---|---|---|---|
| Song readiness | ready, not analysed, analysing, attention, missing, set aside, never play | from `state/readiness.ts` | `routes/library.py` `readiness_of` |
| Seam | none, queued, rendering, ready, failed (+ `fell_back`) | "Not rendered yet", "In line", "Rendering", "Ready", "Couldn't be made", "Fell back to …" | `SeamState.status` |
| Request | waiting, considering, needs approval, preparing, placed, played, cancelled, failed | `views/Requests.tsx` | `routes/song_requests.py` |
| Draft render line | place, eta, to_render, failed, missing | `lib.ts` draft progress words | `DraftInfo` |
| Export job | preparing, encoding, ready, failed, cancelling, cancelled, interrupted, expired | `views/ExportJobs.tsx` | `ExportJobState` |
| Analysis queue | running, paused, queued N, failed N | `state/jobs.ts` | `/api/jobs` |
| Restore | pending restart, rollback available, problem | `views/LocalBackup.tsx` | `/api/backup/status` |
| Energy | requested (five stops) vs measured (per song, may be unknown) | never drawn on one scale | `ui/MusicObjects.tsx` |

## Action tiers

Primary is the one obvious next step; contextual actions appear with their object; advanced actions
are behind a named disclosure, never hover- or shortcut-only.

| Surface | Primary | Contextual | Advanced (named disclosure) |
|---|---|---|---|
| Make a Mix | Play (featured idea) | per card: Play, Shape first, Save as draft | Customize / Shape the next mix; Why this idea? |
| Listen | Play / Pause | Next song, Jump to transition, Bigger / Calmer / Something else, Good / Bad | DJ controls: lyrics focus, spectrum style, beat countdown, Stage |
| My Mixes | Open current mix | per draft: Play, Edit, Prioritize; menu: Rename, Copy, Delete | render line order |
| Edit | select a song or transition | Hear it, Move up/down, Lock, Remove, Add songs | inspector Change tab (move, bars, cue), Studio, Download audio, Clear |
| Inspector | Hear it | Good / Bad | Change, Details, Open the Studio |
| Studio | Hear everything again | cells, solo, Use throughout, Leave out | AI suggestion, Detailed grid / list, Put it back |
| Library | search | per song: Play next, Start a mix, details | selection rail (Prioritize / Remove priority / Never play / Allow), corrections (Advanced) |
| Requests | search and ask | Cancel; Use this / Don't use a bridge | Play it anyway |
| Discovery | Yes / No (harmonic) or Hear it (words) | Skip for now, Add both to the mix | Change the move |
| Workspace | the top issue's fix | Check now, Stop reading, budget | Find moved folder, backups and restore, raw diagnostics |

Emergency, error and destructive controls are exceptions: a failure's Retry sits next to the
failure, and Delete / Clear / Stop watching / Replace local data always confirm.

## Tier rubric

An action is **primary** if most visits to the screen exist to do it, **contextual** if it acts on one
visible object, and **advanced** if it changes technical parameters or many objects at once. An action
that destroys or replaces data always confirms, whatever its tier. No action may be reachable only
by hover or only by a keyboard shortcut; the command palette is an extra route, never the only one
(`shell/commands.ts`).

## Breakpoints

| Width | Shell | Listen | Edit | Library | Studio |
|---|---|---|---|---|---|
| ≥ 1280 px | rail open (212 px), context bar | song, transport and lyrics side by side | timeline + resizable inspector panel | list or cards, full facts | full grid |
| 761–1279 px | rail collapsible (72 px) | stacked hero, lyrics below | inspector panel narrower (keyboard-resizable) | facts wrap | grid scrolls horizontally |
| ≤ 760 px | bottom navigation + More drawer; player stacks above it | transport before display options | inspector becomes a sheet | rows stack, actions wrap | grid scrolls by itself, sticky lane labels |
| keyboard open | bottom chrome and mini-player yield (`--keyboard-inset`) | - | sheet scroll padding | - | - |
| Stage | no chrome | lyrics fill the page | - | - | - |

All geometry comes from `web/src/styles/tokens.css` (`--rail-*`, `--bottom-chrome`, `--keyboard-inset`).

## Discovery capabilities

| Capability | Word connections | Harmonic matches |
|---|---|---|
| Audition | the rendered transition, through the single audio owner | four stages: chords, song A, song B, both |
| Mutation | Add both to the mix (current or a named draft), atomic, order-guarded | Yes / No / Skip verdicts, editable |
| Identity | ordered pair of exact song IDs | discovery ID with both song IDs |
| States | candidate, preparing, ready, failed | candidate, preparing, playable, answered |
| Never | adds one song without the other; plays over the mix | claims a match is confirmed before an answer |
