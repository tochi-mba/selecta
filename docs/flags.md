# Feature flags

Every Selecta feature, and the flag that turns it off. This file is generated from
`src/selecta/flags/*.json` by `uv run selecta flags --markdown docs/flags.md`, and a test
fails if it falls behind.

Flags are for developers. Set `SELECTA_FLAGS` before starting Selecta, then restart to
change it:

| Write | To |
|---|---|
| `-requests` | turn a flag off |
| `+lucy.voice` or `lucy.voice` | turn a flag on |
| `-move.*` | turn off every flag that starts `move.` |
| `minimal` | turn off everything that isn't core |
| `all` | turn everything on |

Separate them with spaces or commas; they apply left to right. A flag that needs one
that's off is off too. Core flags can't be turned off. Turning a flag off never deletes
anything. `uv run selecta flags` shows what's on in the current shell and why.

## Core

| Flag | What it is | Needs |
|---|---|---|
| `core.local_server` | **Local server.** The server on this computer: its status, the local-only checks and the one data folder. **Core:** Everything else talks to it. |  |
| `core.library` | **Library.** Reading a music folder, setting aside what isn't music, and the Library page with search, filters and sorting. **Core:** Without songs there is nothing to play. |  |
| `core.analysis` | **Analysis.** Beats, downbeats, key, tempo and energy for every song, in the background. **Core:** A mix can only be planned from analysed songs. |  |
| `core.playback` | **Playback.** The Listen page, the player, gapless audio, what's coming up, and rendering the transitions it plays. **Core:** Selecta is for listening. |  |
| `core.make_a_mix` | **Make a Mix.** The Make a Mix page with Selecta's pick, and adding a song to the mix. **Core:** It's the one way every mix starts. |  |
| `core.mix_undo` | **Undo.** Undoing the last change to a mix. **Core:** Every change to a mix can be taken back. |  |
| `core.workspace` | **Workspace.** The Workspace overview: what's happening now and what needs you. **Core:** It's where background work is seen and stopped. |  |

## Listen

| Flag | What it is | Needs |
|---|---|---|
| `listen.lyrics` | **Lyrics.** Line-synced lyrics on the Listen page, following the music. | `lyrics.lookup` |
| `listen.word_focus` | **Current-word focus.** The word being sung right now is picked out in the lyrics. | `listen.lyrics` |
| `listen.stage` | **Fullscreen lyrics.** Stage mode: the lyrics fill the screen. | `listen.lyrics` |
| `listen.visualizers` | **Visualizers.** Fifteen spectrum styles that move with the music, with an intensity setting. |  |
| `listen.beat_countdown` | **Beat countdown.** Counts the beats down to the next transition. |  |
| `listen.steering` | **Change the next song.** Bigger, Calmer and Something else for whatever plays next. |  |
| `listen.why_transition` | **Why this transition?.** Explains the move chosen for the coming transition. |  |
| `listen.media_keys` | **Media keys.** The computer's media keys and lock screen control playback. |  |

## Make a Mix

| Flag | What it is | Needs |
|---|---|---|
| `mixes.ideas` | **Mix ideas.** Ready-made mixes under the moment, the mood, the sound and the journey. |  |
| `mixes.genre_variants` | **Single-genre journeys.** Each journey drawn from one genre only, such as Afrobeats · Slow burn. Without it, journeys draw from the whole library. | `mixes.ideas` |
| `mixes.seasonal` | **Seasonal mixes.** The Christmas mix, once there are enough Christmas songs. They stay out of every other mix either way. | `mixes.ideas` |
| `mixes.wordplay_showcase` | **Wordplay showcase.** A mix built around word hand-offs. | `mixes.ideas`, `lyrics.word_timing` |
| `mixes.shaping` | **Shape this mix.** The optional setup that shapes the next mix before it's built. |  |
| `mixes.shaping.feel` | **Transition feel.** Balanced, seamless, punchy or wordplay. | `mixes.shaping` |
| `mixes.shaping.energy_arc` | **Energy arc.** A five-stop energy curve, drawn or set with sliders. | `mixes.shaping` |
| `mixes.shaping.destination` | **Take me to.** End the mix on a song you choose. | `mixes.shaping` |
| `mixes.shaping.stem_moves` | **Stem move steering.** Never, Sometimes or Often for moves that need separated stems. | `mixes.shaping`, `stems` |

## Lucy

| Flag | What it is | Needs |
|---|---|---|
| `lucy` | **Lucy.** Make a mix by describing it in a conversation. |  |
| `lucy.proposals` | **Lucy's proposals.** Lucy proposes a mix with rules you can see, edit, compare and restore. | `lucy` |
| `lucy.commit` | **Saving Lucy's mixes.** Approving a proposal into the current mix or a draft. | `lucy.proposals` |
| `lucy.memory` | **Lucy's memory.** What Lucy remembers between conversations, which you can see, edit and clear. | `lucy` |
| `lucy.voice` | **Voice input.** Talking to Lucy instead of typing. | `lucy` |
| `lucy.remote_providers` | **AI services for Lucy.** Planning with Anthropic or an OpenAI-compatible host instead of the built-in planner. | `lucy` |
| `lucy.listening_history` | **Listening history for Lucy.** What you play is noted so Lucy can know your most-played songs. | `lucy` |

## My Mixes

| Flag | What it is | Needs |
|---|---|---|
| `drafts` | **Drafts.** Mixes you build and edit without touching what's playing. |  |
| `render_line` | **Render line.** Prioritized drafts render in the background after the current mix, in an order you choose. | `drafts` |
| `mymixes.continue_working` | **Continue working.** A shortcut back to the draft you last edited. | `drafts` |

## Editor

| Flag | What it is | Needs |
|---|---|---|
| `editor` | **Editor.** Change a mix song by song: reorder, add, remove, swap and clear. |  |
| `editor.suggestions` | **Song suggestions.** Songs suggested for a spot before you search, each saying how it would hand over. | `editor` |
| `editor.locks` | **Locked songs.** A locked song stays where it is when the mix is rebuilt. | `editor` |
| `seam_inspector` | **Transition inspector.** Pick the move for any transition, hear it, render it and see its checks. | `editor` |
| `seam_inspector.exact_cues` | **Exact cues.** Choose the exact bars and phrase a transition leaves and lands on. | `seam_inspector` |
| `stem_studio` | **Stem Studio.** Both songs' voice, drums, bass and melody on one grid, heard instantly. | `seam_inspector`, `stems` |
| `stem_studio.auto_arrange` | **Studio arranging.** Selecta arranges the stems itself, or fine-tunes yours, and says what changed. | `stem_studio` |
| `export` | **Export.** Save the whole mix as an audio file, with a list of exports. | `editor` |

## Transitions

| Flag | What it is | Needs |
|---|---|---|
| `stems` | **Stems.** Splitting songs into voice, drums, bass and melody, which stem moves and the Studio need. |  |
| `move.cut` | **Cut.** A clean cut onto the next song's downbeat. **Core:** Every transition falls back to a cut when nothing else passes its checks. |  |
| `move.bass_swap_blend` | **Blend.** Both songs play in time, and they trade the bass halfway. |  |
| `move.vocal_ride` | **Vocal ride.** The next song's band comes in under the voice, before it starts singing. | `stems` |
| `move.filter_sweep` | **Filter sweep.** The song filters away upward as the next one opens up. |  |
| `move.tempo_ramp` | **Tempo ramp.** Both songs drift to a shared speed for a short overlap. |  |
| `move.echo_out` | **Echo out.** The last beat rings on as the next song lands under it. |  |
| `move.delay_throw` | **Delay throw.** The last word is thrown into a delay as the next song slams in. |  |
| `move.reverb_wash` | **Reverb wash.** The song dissolves into a room as the next one arrives. |  |
| `move.word_cut` | **Word cut.** One song sets a phrase up, and the next one sings it. | `stems`, `lyrics.word_timing` |
| `move.word_blend` | **Word blend.** A vocal ride that hands over on a phrase both songs share. | `stems`, `lyrics.word_timing` |
| `move.phrase_roll` | **Phrase roll.** A phrase repeats, faster and faster, into the next song singing it. | `stems`, `lyrics.word_timing` |
| `move.call_and_response` | **Call and response.** The voices trade a phrase over the next song's band until it keeps it. | `stems`, `lyrics.word_timing` |
| `move.strip_and_land` | **Strip and land.** One song strips down to its melody, the next is teased, then its bass and drums land. | `stems` |
| `move.intertwined_stems` | **Intertwined stems.** Drums, bass and harmony trade over sixteen bars, with the vocals taking turns. | `stems` |
| `render.repair` | **Second takes.** A transition that fails a check is tried again, or with another move, before you hear it. |  |
| `render.spare_time` | **Spare-time transitions.** With nothing else to do, the best transitions across the library are tried out ahead of time. |  |

## Requests

| Flag | What it is | Needs |
|---|---|---|
| `requests` | **Requests.** Ask for a song while a mix plays, and Selecta finds a spot where it fits. |  |
| `requests.bridges` | **Bridges.** Up to three songs from across the library to reach a request that doesn't fit. | `requests` |

## Discover

| Flag | What it is | Needs |
|---|---|---|
| `discover.word_links` | **Word connections.** Lyric links between songs, where a word in one hands off to the same word in the next. | `lyrics.lookup` |
| `discover.harmonic` | **Harmonic matches.** Songs that might share chords, with an audition in four steps. |  |

## Library

| Flag | What it is | Needs |
|---|---|---|
| `library.batch` | **Batch actions.** Select several songs and act on them at once. |  |
| `library.priority` | **Priority songs.** Songs analysed first, whose stems are kept when the cache is cleared. |  |
| `library.never_play` | **Never play.** Songs Selecta won't pick when it builds a mix. |  |
| `library.corrections` | **Corrections.** Fix a song's measured tempo, or say whether it's music. |  |
| `library.card_view` | **Card view.** The Library as cards instead of a list. |  |
| `library.folders` | **Music folders.** The Sources tab: more than one folder, checking for new songs, and stopping watching one. |  |
| `library.relink` | **Re-link a moved folder.** Point Selecta at a folder that moved, with a preview first. | `library.folders` |
| `library.folder_watching` | **Watching for new songs.** Songs added to a music folder come in by themselves within about a minute. |  |
| `lyrics.lookup` | **Lyric lookup.** Line-synced lyrics from LRCLIB. Only artist, title, album and duration are sent. |  |
| `lyrics.word_timing` | **Word timing.** When each sung word lands, for moves that hand over on a word. | `lyrics.lookup` |
| `analysis.time_estimates` | **Time estimates.** How long analysing the rest of the library will take, and how accurate past estimates were, from this computer's own speeds. |  |

## Learning

| Flag | What it is | Needs |
|---|---|---|
| `ratings` | **Ratings.** Rate a transition Good or Bad, and the planner learns from it. |  |
| `learning.memory` | **What it's learned.** The Learning tab's summary of what ratings have taught the planner. | `ratings` |
| `listening_study` | **Blind listening study.** Compare two renders without knowing which is which, and grade them. |  |

## Workspace

| Flag | What it is | Needs |
|---|---|---|
| `workspace.storage` | **Storage.** Free and cached space, and the cache budget. |  |
| `workspace.backup` | **Local backup.** Back up the library's data and restore it on the next start. |  |
| `workspace.diagnostics` | **Diagnostics.** The raw details of what Selecta is doing, for when something goes wrong. |  |

## Across the app

| Flag | What it is | Needs |
|---|---|---|
| `app.command_palette` | **Command palette.** Ctrl K to search songs and run commands. |  |
| `app.shortcuts` | **Single-key shortcuts.** Keys like Space, N, M and R work without Ctrl held, listed under ?. |  |
| `app.activity` | **Activity.** A list of recent changes, each with its own Undo. |  |
| `app.glossary` | **Music terms.** Plain explanations of the music words Selecta uses, and the small ? beside them. |  |
| `app.theme_choice` | **Theme choice.** Light, dark or match this computer. |  |
| `app.motion_choice` | **Motion choice.** Still, subtle or expressive movement. The computer's reduced-motion setting always wins. |  |
| `app.classic_nav` | **Classic navigation.** The older navigation labels over the same pages, with ?ui=classic as a way back. |  |
| `app.install` | **Install as an app.** Chrome and Edge can install Selecta as its own window. |  |

## Tools

| Flag | What it is | Needs |
|---|---|---|
| `tools.reels` | **Listening reels.** Render one transition or a reel of them, check beats by ear, and play reels in a browser. |  |
| `tools.set_mix` | **Whole-set render.** Render a planned set straight to one file from the command line. |  |
| `tools.stem_preview` | **Stem preview.** Hear two songs' stems side by side from the command line. | `stems` |
| `tools.old_planner` | **Rolling set planner.** The original rolling set plan, before mix ideas. |  |
