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
| `core.upgrade_backup` | **Backup before upgrade.** The first time a newer Selecta opens a library, it keeps a copy of the library's database before changing its tables. **Core:** An upgrade must never be the thing that loses a library. |  |
| `core.durable_local_jobs` | **Durable local jobs.** Local background work through the durable job store in the library home (work.sqlite), so it survives restarts and crashes. Off by default while the local audio jobs move onto it. |  |
| `core.engine_store` | **Engine store.** The engine's tables (ratings first) read and written through one storage layer that Desktop and Cloud share, with each account's flags bound to its own requests and jobs. Off by default because it changes how the Desktop database is opened: it stays off until its backup and restore round trip has been proved on a copy of a real library. **Cloud surface:** headless (Storage underneath existing features; it adds no page of its own to the Cloud site.). |  |
| `core.library` | **Library.** Reading a music folder, setting aside what isn't music, and the Library page with search, filters and sorting. **Core:** Without songs there is nothing to play. |  |
| `core.analysis` | **Analysis.** Beats, downbeats, key, tempo and energy for every song, in the background. **Core:** A mix can only be planned from analysed songs. |  |
| `core.playback` | **Playback.** The Listen page, the player, gapless audio, what's coming up, and rendering the transitions it plays. **Core:** Selecta is for listening. |  |
| `core.make_a_mix` | **Make a Mix.** The Make a Mix page with Selecta's pick, and adding a song to the mix. **Core:** It's the one way every mix starts. |  |
| `core.mix_undo` | **Undo.** Undoing the last change to a mix. **Core:** Every change to a mix can be taken back. |  |
| `core.workspace` | **Workspace.** The Workspace overview: what's happening now and what needs you. **Core:** It's where background work is seen and stopped. |  |

## Listen

| Flag | What it is | Needs |
|---|---|---|
| `listen.lyrics` | **Lyrics.** Line-synced lyrics on the Listen page, following the music. | `lyrics.display` |
| `listen.word_focus` | **Current-word focus.** The word being sung right now is picked out in the lyrics. | `listen.lyrics` |
| `listen.stage` | **Fullscreen lyrics.** Stage mode: the lyrics fill the screen. | `listen.lyrics` |
| `listen.visualizers` | **Visualizers.** Fifteen spectrum styles that move with the music, with an intensity setting. |  |
| `listen.beat_countdown` | **Beat countdown.** Counts the beats down to the next transition. |  |
| `listen.handoff_phrase` | **Shared words at the hand-off.** While a finished word transition plays, the countdown names the words the two songs share. | `listen.beat_countdown` |
| `listen.steering` | **Change the next song.** Bigger, Calmer and Something else for whatever plays next. |  |
| `listen.why_transition` | **Why this transition?.** Explains the move chosen for the coming transition. |  |
| `listen.first_handoff` | **First hand-off note.** Once the first finished transition has really been heard, a small note names the two songs it joined. It can be dismissed and never comes back. |  |
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
| `mixes.shaping.remember_length` | **Remember mix length.** The chosen length (30 min, 1 hour or 2 hours) is kept in this browser for the next visit, like the other shaping choices. | `mixes.shaping` |

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
| `lucy.cloud_conversation` | **Lucy's conversation in Cloud.** Talk to Lucy in the browser about your library and mixes; she proposes changes you can save. | `lucy`, `cloud.local_media` |
| `lucy.usage_windows` | **Lucy's allowance on a session and a week.** Measures Lucy by what each message costs, on a five-hour session and a weekly limit, in place of turns a month (ADR-0481 to ADR-0484). The build ships on so a rule can grant it, and with no matching rule it is off. **Cloud surface:** unreleased (The session and week meters and their pages are not built yet (ADR-0484)). | `lucy.cloud_conversation` |
| `lucy.extra_usage` | **Extra Lucy usage in prepaid packs.** Buy a prepaid pack of extra Lucy usage, spent only once the weekly limit is reached (ADR-0486). The build ships on so a rule can grant it, and with no matching rule it is off. **Cloud surface:** unreleased (The pages for buying and seeing extra usage are not built yet (ADR-0486)). | `lucy.usage_windows` |
| `lucy.usage_shadow` | **Measure Lucy's new allowance in the background.** Records what each Lucy turn would use under the new allowance without changing anything a member sees. Turning it off stops that recording at once. **Cloud surface:** headless (A background measurement of each turn; nothing on a Cloud screen changes). | `lucy.cloud_conversation` |

## My Mixes

| Flag | What it is | Needs |
|---|---|---|
| `drafts` | **Drafts.** Mixes you build and edit without touching what's playing. |  |
| `render_line` | **Render line.** Prioritized drafts render in the background after the current mix, in an order you choose. | `drafts` |
| `mymixes.lean_list` | **Lean draft list.** Pickers and shortcuts fetch only each draft's name, not its songs and readiness. | `drafts` |
| `mymixes.continue_working` | **Continue working.** A shortcut back to the draft you last edited. | `drafts` |

## Editor

| Flag | What it is | Needs |
|---|---|---|
| `editor` | **Editor.** Change a mix song by song: reorder, add, remove, swap and clear. |  |
| `editor.energy_horizon` | **Start-to-finish horizon.** Story view draws the same five-stop energy horizon as the mix builder, measured from this mix or draft's own songs. | `editor` |
| `editor.suggestions` | **Song suggestions.** Songs suggested for a spot before you search, each saying how it would hand over. | `editor` |
| `editor.locks` | **Locked songs.** A locked song stays where it is when the mix is rebuilt. | `editor` |
| `editor.drag_preview` | **Move preview.** While a song is dragged, the transitions the drop would change are marked before it lands. | `editor` |
| `editor.phone_layout` | **Editor for every screen.** A browser mix as a list of songs and the transitions between them, with the opened transition in a sheet on a phone and beside the list on a tablet or wider screen. The Desktop app, with the transition inspector, keeps its classic editor. Without it, the editor keeps its earlier layout at every size. | `editor` |
| `seam_inspector` | **Transition inspector.** Pick the move for any transition, hear it, render it and see its checks. | `editor` |
| `seam_inspector.exact_cues` | **Exact cues.** Choose the exact bars and phrase a transition leaves and lands on. | `seam_inspector` |
| `seam_inspector.compare` | **Compare with before.** Hear a transition's earlier finished render beside the new one, once both really exist. | `seam_inspector` |
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
| `move.loop_room` | **Loop and blend.** When a song leaves no clean bars to blend over, its last clean phrase loops so the next song can still come in slowly. Off until it has been listened to. |  |
| `move.tempo_bridge` | **Tempo bridge.** Songs too far apart in tempo to blend: the first is stripped to its beat and walked to the next one's speed over sixteen bars, then the next comes in untouched. Off until it has been listened to. |  |
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
| `render.one_engine` | **One engine for stem seams.** On: Studio shapes, strip and land and intertwined stems play through the same engine as every other transition, so the next song is nudged into the pocket, the beats are lined up on a second take, and the vocal check hears the separated voices; word and ride moves also lock half- and double-time songs to one pulse. Off: those seams mix their own stems as before, with none of that. |  |
| `analysis.phrases` | **Phrase lines.** Transitions land on 8-bar phrase lines instead of any 4-bar mark, the way a DJ counts a song. |  |
| `analysis.vocal_sense` | **Hear the voices.** When a song has no synced lyrics, listen to its separated voice to tell when someone sings, so it can still earn long blends and clashing voices are caught. | `stems` |
| `planner.true_key` | **Heard harmony.** Key scoring also hears the measured chroma of the exact bars that will play together, not just the two key labels. |  |
| `planner.arrival` | **Rolls land on arrivals.** A phrase roll promises a drop, so the next song has to arrive on one: a chorus coming in, or its energy stepping up. |  |
| `planner.motivated_punctuation` | **Motivated punctuation.** An echo, cut or wash needs an audible reason - a line just finished or the song's structure turned - or it scores far lower. |  |
| `planner.energy_intent` | **No unintended drops.** A punchy move from a hot exit into a much colder landing is refused unless the landing is a chorus. |  |
| `planner.rhythm_fit` | **One drummer.** When two songs' drum patterns fight (four on the floor over a broken beat, straight over swung), a blend keeps only one song's kick and hats at a time and hands them over on a phrase line. Off until it has been listened to. |  |
| `planner.calibrated_gates` | **Gates from your ratings.** The planner's limits on tempo gap, key distance, beat grid and overlap length use the values `selecta calibrate --apply` fitted to your Good and Bad clicks, within safe bounds. Off: the hand-set limits. Off until the owner chooses to apply a fit. |  |

## Requests

| Flag | What it is | Needs |
|---|---|---|
| `requests` | **Requests.** Ask for a song while a mix plays, and Selecta finds a spot where it fits. |  |
| `requests.bridges` | **Bridges.** Up to three songs from across the library to reach a request that doesn't fit. | `requests` |

## Discover

| Flag | What it is | Needs |
|---|---|---|
| `discover.word_links` | **Word connections.** Lyric links between songs, where a word in one hands off to the same word in the next. | `lyrics.display` |
| `discover.relationship_map` | **Connection map.** An optional map of the word connections found, drawing only the ones returned. | `discover.word_links` |
| `discover.scan_reveals` | **Connections found while preparing.** While the first songs are being prepared, the newest word connections the library has really found are named, and nothing is shown until there is one. | `discover.word_links` |
| `discover.harmonic` | **Harmonic matches.** Songs that might share chords, with an audition in four steps. |  |

## Library

| Flag | What it is | Needs |
|---|---|---|
| `library.batch` | **Batch actions.** Select several songs and act on them at once. |  |
| `library.priority` | **Priority songs.** Songs analysed first, whose stems are kept when the cache is cleared. |  |
| `library.never_play` | **Never play.** Songs Selecta won't pick when it builds a mix. |  |
| `library.related_links` | **Connected songs.** A song's details list the word connections found for it, each marked heard and kept or still a candidate. | `discover.word_links` |
| `library.corrections` | **Corrections.** Fix a song's measured tempo, or say whether it's music. |  |
| `library.capability_readiness` | **Readiness by capability.** Song details say separately whether a song can play, join mixes, have stems split and show timed lyrics. |  |
| `library.card_view` | **Card view.** The Library as cards instead of a list. |  |
| `library.folders` | **Music folders.** The Sources tab: more than one folder, checking for new songs, and stopping watching one. |  |
| `library.relink` | **Re-link a moved folder.** Point Selecta at a folder that moved, with a preview first. | `library.folders` |
| `library.folder_watching` | **Watching for new songs.** Songs added to a music folder come in by themselves within about a minute. |  |
| `lyrics.lookup` | **Lyric lookup.** Line-synced lyrics from LRCLIB. Only artist, title, album and duration are sent. |  |
| `lyrics.display` | **Lyric display.** Shows lyric text in listening and discovery views where its use is permitted. | `lyrics.lookup` |
| `lyrics.word_timing` | **Word timing.** When each sung word lands, for moves that hand over on a word. | `lyrics.lookup` |
| `analysis.time_estimates` | **Time estimates.** How long analysing the rest of the library will take, and how accurate past estimates were, from this computer's own speeds. |  |
| `library.scan_resume` | **Scans carry on after a stop.** A library scan saves its progress as it goes, so a scan interrupted by closing SelectaDJ or the computer carries on where it stopped. An interrupted export or lyric lookup is offered again. |  |
| `library.art_embedded` | **Covers from your own files.** Shows the cover picture stored inside a song's own file. In Cloud it is read on your device and never uploaded (ADR-0478). Off: the generated colour tile, as before. |  |
| `library.art_lookup` | **Covers and song details from the web.** For a song whose file has no cover, looks up the release on MusicBrainz and its cover on the Cover Art Archive, and keeps the result in SelectaDJ's own catalogue. Only the artist, title, album and length are sent (ADR-0478). Off by default: the sources' terms are the owner's to clear first. | `library.art_embedded` |
| `library.audio_identity` | **Songs known by their audio.** A song is known by a hash of its audio alone (docs/engineering/audio-identity.md), so editing a tag, adding artwork or a rating written by another player keeps it the same song with its measurements and corrections. Desktop stores it with the hash job and analysis (it needs core.engine_store for the column); Cloud stores it when a device registers a song and keeps a re-tagged file as the same song. Off: no audio id is computed, sent, stored or matched, and nothing visible changes. **Cloud surface:** headless (Song identity underneath the library; it adds no page or control of its own.). |  |

## Learning

| Flag | What it is | Needs |
|---|---|---|
| `ratings` | **Ratings.** Rate a transition Good or Bad, and the planner learns from it. |  |
| `learning.memory` | **What it's learned.** The Learning tab's summary of what ratings have taught the planner. | `ratings` |
| `listening_study` | **Blind listening study.** Compare two renders without knowing which is which, and grade them. |  |
| `listening_study.skip_and_stop` | **Skip and stop in the listening study.** Skip a comparison without answering, or stop for now and pick up later, with the skipped ones counted as unanswered. | `listening_study` |

## Workspace

| Flag | What it is | Needs |
|---|---|---|
| `workspace.storage` | **Storage.** Free and cached space, and the cache budget. |  |
| `workspace.cache_care` | **Cache tidying.** When the seam worker is idle it removes crash leftovers, caches of removed or changed songs, seams from an older engine and stems unused for two weeks, shares identical clips, and compacts the library file. The current mix is never touched. |  |
| `workspace.song_audio_cache` | **Song audio cache.** A whole song asked for on its own is decoded once into the render cache and served from there, with Range and a tag from its source file. It counts toward the cache limit and goes least recently used first; the current mix's seams are never pushed out for it. Off, each request decodes the song again. |  |
| `workspace.backup` | **Local backup.** Back up the library's data and restore it on the next start. |  |
| `workspace.diagnostics` | **Diagnostics.** The raw details of what Selecta is doing, for when something goes wrong. |  |
| `workspace.library_health` | **Library health.** Overview says whether the library can be mixed or what blocks it, and which one thing to do first. |  |
| `workspace.self_service` | **What went wrong.** Faults Selecta has measured on this PC, each with its confirmed or possible cause and a scoped way to put it right. | `workspace.diagnostics` |

## Across the app

| Flag | What it is | Needs |
|---|---|---|
| `app.command_palette` | **Command palette.** Ctrl K to search songs and run commands. |  |
| `app.shortcuts` | **Single-key shortcuts.** Keys like Space, N, M and R work without Ctrl held, listed under ?. |  |
| `app.activity` | **Activity.** A list of recent changes, each with its own Undo. |  |
| `app.glossary` | **Music terms.** Plain explanations of the music words Selecta uses, and the small ? beside them. |  |
| `app.theme_choice` | **Theme choice.** Light, dark or match this computer. |  |
| `app.motion_choice` | **Motion choice.** Still, subtle or expressive movement. The computer's reduced-motion setting always wins. |  |
| `app.auto_low_motion` | **Lower motion on a struggling device.** When frames keep arriving late, decorative movement switches to Still for this visit. Nothing is hidden, and Workspace can bring full motion back. |  |
| `app.classic_nav` | **Classic navigation.** The older navigation labels over the same pages, with ?ui=classic as a way back. |  |
| `app.scene_transitions` | **Page transitions.** With Expressive motion, pages move in the direction you went and shared things travel between them, where the browser supports it; otherwise they change at once. | `app.motion_choice` |
| `app.feel_motion` | **Expressive feel.** Springy presses and releases, things arriving from where they were asked, and Expressive as the starting motion level (ADR-0477). Off: today's quiet feedback, with Subtle as the starting level. | `app.motion_choice` |
| `app.feel_depth` | **Depth and light.** Lift shadows, lit edges and a glow on the main action, on the same colours as before (ADR-0477). Off: flat surfaces as before. |  |
| `app.feel_pointer_light` | **Pointer light.** Cards and tiles show a soft light where the mouse is. Mouse only, and never the only sign of anything. | `app.feel_depth` |
| `app.feel_music` | **Moves with the music.** While a mix plays, the Play control, the player bar and the playing row answer the measured beat of the real audio, and rest when it is paused (ADR-0477). Off: they stay still. | `app.motion_choice` |
| `app.feel_ambient` | **Ambient colour.** A soft tint taken from the playing song, which travels to the next song's colour during a blend. Off: no tint. |  |
| `app.feel_moments` | **Big moments.** A short celebration at rare moments: setup finished, a mix built, the first blend heard, a room opened, a plan upgraded, an export ready. Off: the plain words only. | `app.feel_motion` |
| `app.feel_haptics` | **Phone taps.** A light tap from the phone on key presses, on phones that can do it. Off: no taps. |  |
| `app.install` | **Install as an app.** Chrome and Edge can install Selecta as its own window. |  |
| `app.attention_announce` | **Say when Workspace needs attention.** When storage fills, analysis pauses with songs left, or a song or transition fails, a screen reader hears it once on whatever page is open. The header mark stays either way. |  |

## Tools

| Flag | What it is | Needs |
|---|---|---|
| `tools.reels` | **Listening reels.** Render one transition or a reel of them, check beats by ear, and play reels in a browser. |  |
| `tools.key_benchmark` | **Key method benchmark.** Score a replacement key method against S-KEY's stored keys on this library, read-only, for choosing S-KEY's Cloud replacement. |  |
| `tools.set_mix` | **Whole-set render.** Render a planned set straight to one file from the command line. |  |
| `tools.stem_preview` | **Stem preview.** Hear two songs' stems side by side from the command line. | `stems` |
| `tools.listening_room` | **Listening Room.** A Cloud page for judging transitions by ear: each transition in the current mix is played two ways on this device, blind, as A and B, and the answers are kept in this browser until the reveal says which was which. Version 1 compares the browser player before and after early planning, one level for every song and patient analysis (cloud.seam_lead). | `cloud.browser_dsp`, `cloud.local_first` |
| `tools.old_planner` | **Rolling set planner.** The original rolling set plan, before mix ideas. |  |

## Cloud services

| Flag | What it is | Needs |
|---|---|---|
| `account.identity` | **Account and sessions.** Read account settings and end sign-in sessions. **Core:** People must be able to view their account and sign out. |  |
| `account.identity_sync` | **Account sync with WorkOS.** Accept signed WorkOS events that keep emails, revoked sessions and deleted accounts in step. **Core:** Revoked sessions, password resets and deleted users must reach Selecta at once. |  |
| `account.labs` | **Labs.** Opt into preview features that your plan is allowed to use. |  |
| `account.deletion` | **Account deletion.** Request account removal and revoke active sessions. **Core:** People must always be able to request deletion of their account. |  |
| `account.data_export` | **Account data export.** Download a portable copy of available account data and original files. **Core:** People must be able to take a copy of their personal data. |  |
| `account.lucy_settings` | **Lucy settings in Cloud.** Choose whether to use Lucy, its phases and what it may share; see this month's Lucy turns. | `lucy` |
| `cloud.signups` | **New accounts.** Allow new Cloud users to complete account onboarding. |  |
| `cloud.hosted_media` | **Cloud library.** The umbrella grant for uploading and processing audio in Cloud (ADR-0456). The build ships on so a rule can grant it, and with no matching rule it is off: music on the member's devices is the default and a cloud library is a staff grant (ADR-0455). |  |
| `cloud.uploads` | **Cloud uploads.** Upload private audio files to a Cloud workspace. | `cloud.hosted_media` |
| `storage.upload_identity` | **Uploads join the song they are for.** Uploading a song that is already in your library adds the file to that same song, matched by its file, an older copy of it or its audio, so its measurements, corrections, mixes and ratings stay with it; an unsure match becomes another version of the song. Also adds a check that says what a batch of uploads would do before anything is sent. Off: an upload finds its song by the exact file only, as before. **Cloud surface:** headless (Song identity and a dry run underneath uploads; it adds no page or control of its own.). | `cloud.uploads` |
| `cloud.stored_media` | **Stored media.** List, play, export and delete audio already stored in Cloud. Reads of stored media stay open without the cloud library grant, so nobody's library goes dark (ADR-0456). |  |
| `cloud.hosted_render` | **Cloud studio.** For an account with a cloud library, the cloud studio runs the Desktop app's engine on uploaded songs: analysis at upload, the Desktop planner's order, rendered transitions placed the Desktop app's way, a lossless playback file per song and a rendered export (selecta.hosted_render). Off: uploads are stored and play as before, unprocessed. | `cloud.hosted_media`, `cloud.stored_media` |
| `cloud.hosted_brain` | **Uploaded-music mixes from SelectaDJ's own planner.** For an account with a cloud library, a server mix of uploaded songs is ordered and each transition chosen by the same planner the Desktop app uses (selecta.hosted_brain, workers.engine_core): the songs' measurements come from the account's song facts, every way into the next song is weighed and ranked, and each transition is rendered, checked and repaired by the Desktop's own rule, at most five takes and a clean cut. Off: the older order and move choice, exactly as before. Off until it has been listened to. **Cloud surface:** headless (Changes which transitions the server renders for a cloud library mix, not any screen: the cloud library card looks and works the same either way). | `cloud.hosted_render`, `cloud.brain` |
| `cloud.local_first` | **Music on the member's devices.** Selects the navigation and browser-owned playback for music on the member's devices in personal Cloud; the legacy pages remain when off (ADR-0455). |  |
| `cloud.workspace` | **Browser Workspace.** Workspace for music on this device: an overview of the library and what this browser is doing in the background, the interface choices, connecting music, this browser's storage and a browser diagnostics panel. Analysis and learning stay on a computer running SelectaDJ. When off, the device cards stay in More as This device. | `cloud.local_first` |
| `cloud.resilient_import` | **Import that survives interruptions.** A durable import journal in this browser: it retries, waits for the connection, and carries on after a reload or sign-in without re-reading finished files. | `cloud.local_media` |
| `cloud.music_folders` | **Your music folders, watched.** The member can connect several music folders on this device. Each is listed with its song count, when it was last checked and whether the browser still allows it; folders the browser still allows are checked for new, changed and missing songs when SelectaDJ opens and when the tab comes back. Folder names and handles stay in this browser; nothing about a folder goes to the server. Off, one folder is remembered only to carry on an interrupted import, as before. | `cloud.local_media` |
| `cloud.offline_shell` | **Cloud opens offline.** The app opens without a connection and the library shows what this device already knows. | `cloud.local_first` |
| `cloud.offline_playback` | **Playback through a dropped connection.** A playing device keeps playing its own files while the connection is down and settles the playback lease when it returns. | `devices.browser_player` |
| `cloud.mix_outbox` | **Mix changes wait for the connection.** Mixes made or edited offline are kept in this browser and sent when the connection returns. | `cloud.local_first` |
| `cloud.hosted_shell` | **Cloud library pages on the shared shell.** Draws the cloud library pages (overview, Listen, Make a Mix, Library and the account places in More) inside the same shell as music on the member's devices; the legacy side rail remains when off. |  |
| `cloud.page_layout` | **Cloud pages fill the frame.** Every Cloud page uses the full width of the frame, with text kept to a readable line length; account, billing and onboarding pages stay narrow and centred; Add music shows its storage beside the uploads on wide screens. Notices above the page show one at a time, with the rest folded into one line. Off, pages are drawn as before. |  |
| `cloud.one_mixer` | **One Make a Mix for songs in both places.** For an account with songs on its devices and in its cloud library, Make a Mix is the same mixer everyone has: the mix it makes becomes the current mix, so Listen, the editor, My Mixes and the mini player follow it, and Listen says when transitions are being got ready without holding up the music. Saving a mix as a file takes songs from both places, reading cloud songs to this device only; songs only on another device are left out by name. When every song is in the cloud library, the file can also be made there. Off: such an account keeps its separate cloud library card, and a file is saved only from songs on this device. | `cloud.local_first`, `cloud.stored_media` |
| `cloud.catalogue_play` | **Phones and other devices play cloud songs.** A song in your cloud library plays on any device you are signed in on: it is found by the song itself, never by this device's own files or by its name, and its link is signed again when it runs out. Choosing where the music plays counts those songs as on every signed-in device, so a phone with no music of its own can play them here. Off, songs in the cloud library are matched as before. | `cloud.stored_media` |
| `cloud.progressive_import` | **Import continues in the background.** A folder import keeps running while the member moves on: onboarding unlocks as songs land, a shell chip shows progress, and an interrupted import offers to carry on (ADR-0463 BF-0463-02). |  |
| `cloud.content_cache` | **Reuse work on the same song by fingerprint.** Derived data on this device is keyed by the song's content hash, computed here from the file itself, so the same file under another account or another title reuses it: cached song bytes, and a device-wide store of tonal profiles, waveforms and durations, with a fingerprint memo so a folder imported here before is not read in full again (ADR-0469 amendment). Off, everything is keyed per workspace, every import hashes every file, and nothing is shared. |  |
| `cloud.hosted_dedupe` | **Share machine-derived data across accounts by fingerprint.** Server side of ADR-0469: deterministic derivations of an uploaded file's bytes may be reused by another workspace that holds the same bytes as a server-hashed upload; titles, ratings and history never join, and a client-claimed hash grants nothing. Off, every workspace keeps its own derived data as before. |  |
| `cloud.local_first_labs` | **Labs: music on your devices.** Lets a beta cohort opt into music on their devices themselves, give feedback and opt out again; opting in adds the member to a cloud.local_first targeting rule (ADR-0467 step 3). |  |
| `cloud.brain` | **Planning from song facts.** SelectaDJ's planner runs in Cloud from the facts a member's device measured for their songs (ADR-0479, docs/engineering/cloud-planning.md): a device saves a song's measurements (tempo, beats and bars, sections, key, loudness, per-bar energy and tone numbers; never audio or paths) and the member's tempo and key corrections, and Cloud answers with the ranked transitions between two songs and their scripts, the repair rule's next step, a mix's order and the idea cards. A device reports each seam it rendered (the pair, the option, the audit's verdict, who rendered it, the clip's length and hash; never the clip), any device can see which seams exist for a pair, and the member's Good and Bad on them (POST /api/seams/{key}/rate, GET /api/memory/ratings, which also need this flag) teach the planner. With cloud.account_mixes, the Desktop's mix and draft routes answer for the account too. Off: these routes answer flag_off and nothing is saved or planned. **Cloud surface:** headless (Routes a device and a studio call; with cloud.device_analysis on, the browser sends its measurements and plays the planner's order and transitions, which changes no screen). | `cloud.local_media` |
| `cloud.account_mixes` | **Your mixes in one place.** The account's mixes come from one place on every device: the current mix and every draft are kept with the account in the same form the Desktop app keeps them (ADR-0479, docs/engineering/engine-store-mixes.md), and the browser reads and changes them through the Desktop's own mix routes, which also need cloud.brain. The account's song requests are kept with it the same way and answer the Desktop's request routes, since a request joins the account's mix. The first time an account uses them, its saved browser mixes are copied in as drafts once; nothing about them is changed or removed. Mixes hold catalogue song ids and transition choices, never audio or file paths. Off until it has been tried on a real account: the browser keeps its saved browser mixes as before, and these routes answer flag_off. **Cloud surface:** headless (Changes where the browser keeps a mix, not any screen: Make a Mix, the editor and My Mixes look and work the same either way). | `cloud.brain` |
| `cloud.local_media` | **Local media catalogue.** The metadata-only catalogue of songs on the member's own devices; no audio is uploaded (ADR-0458). |  |
| `billing.checkout` | **Plan checkout.** Start or change a paid Selecta Cloud subscription. |  |
| `billing.portal` | **Subscription portal.** Manage or cancel an existing paid Selecta Cloud subscription. |  |
| `account.workspace_name` | **Workspace name.** Rename the personal workspace from its starting name, offered once on Workspace. |  |
| `account.new_device_email` | **New device email.** Email the person once when a new device signs in to their account, with a way to sign out everywhere. **Cloud surface:** headless (An email sent by the maintenance task; nothing on a Cloud screen changes). |  |
| `cloud.rate_limits` | **API rate limits.** Per-account and per-IP request limits in the Cloud API, with stricter limits for checkout, account changes, search and upload plans. **Cloud surface:** operations (A request limit has no screen; a refused request says why and when to try again). |  |
| `cloud.idempotency` | **Replayed writes.** A Cloud write sent again with the same Idempotency-Key within 24 hours gets the first answer back instead of doing it twice. **Cloud surface:** operations (Replaying a stored answer has no screen; the person simply never sees a double). |  |
| `billing.standing` | **Billing notices and emails.** Tell the customer when a payment failed, needs confirming, or a plan is ending or has ended, in the app and by email. |  |
| `cloud.operations` | **Cloud operations.** Schema migrations, the worker gateway, and the maintenance and recovery commands that keep the service correct. **Core:** The cloud service can't run, recover or erase data on time without them. |  |
| `cloud.tracing` | **Job tracing.** OpenTelemetry spans across the API, worker gateway, workers and storage, one trace per job with its id as a span attribute. |  |
| `cloud.metrics` | **Service metrics.** OpenTelemetry metrics the SLOs and alerts read: lost jobs, webhook-to-entitlement time, queue age, quarantines, spend ceilings, audit writes, reconciliation drift, backups and the maintenance leader. |  |
| `cloud.error_reporting` | **Error reporting.** Send API, gateway, maintenance and worker errors to Sentry, scrubbed of signed links, tokens and email addresses. Needs SELECTA_SENTRY_DSN; nothing is sent without it. |  |
| `cloud.email` | **Transactional email.** Email people from SelectaDJ when a long job finishes or their storage goes over quota, through Postmark or Resend. Needs the SELECTA_EMAIL_* settings on the maintenance service. |  |
| `cloud.export_expiry` | **Export expiry.** The maintenance leader deletes finished exports when their plan's retention runs out (Free 7 days, Standard 30, Premium 90) and gives their bytes back to the quota. |  |
| `cloud.hosted_caps` | **Cloud studio daily caps.** A cloud library account's first analysis of a song takes one of the plan's daily song analyses, and each new transition takes its measured seconds from the plan's daily transition time (selecta.hosted_caps). Off: nothing is counted or refused. |  |
| `cloud.derived_gc` | **Derived files collector.** The maintenance leader deletes derived files no artifact row or live job names, from attempts that ended over 6 hours ago, and playback files unused for 30 days (storage.derived_gc). Off: the task runs dry and only reports, so an operator can read `selecta storage gc` first. |  |
| `cloud.operator_alerts` | **Operator alert email.** The maintenance leader emails SELECTA_ALERT_EMAIL when queued work is stuck, the worker gateway stops answering, the autoscaler fails or a pool reaches its daily spend ceiling: once an hour at most, and once when it clears (notify.operator_alerts). |  |
| `cloud.autoscale` | **Worker autoscaling.** The maintenance leader sizes each worker pool from the queue and asks the configured launcher (Modal) to start or stop workers. |  |
| `cloud.dmca_renewal_reminder` | **DMCA agent renewal reminder.** The maintenance leader raises an owner alert from 90 days before the DMCA designated agent's three-year registration lapses, and daily once it has. |  |
| `cloud.privacy_notice_draft` | **Privacy notice draft.** Shows the draft privacy notice, marked as a draft pending legal review, under Settings so the owner and a privacy adviser can read it in place. Off by default: it is not published. |  |
| `cloud.device_check` | **Device check.** A checklist under Settings for the real-device checks (Play here, an offline speaker, the iPhone screen-on note, seam alignment) that reads what this browser supports and writes a copyable record. Off by default. |  |
| `billing.webhooks` | **Billing updates.** Accept signed subscription state changes from Stripe. **Core:** Billing changes must be applied even when checkout is paused. |  |
| `devices` | **Playback devices.** Sign browsers in as devices, list, rename and sign them out, and move playback between them with Play here. |  |
| `devices.remote_control` | **Remote playback control.** Control the account's active playback session from another device. | `devices` |
| `devices.browser_player` | **Browser player.** The in-browser audio engine registered as a playback device (ADR-0457). | `devices` |
| `cloud.browser_dsp` | **Browser DSP.** The browser player's mixing DSP tiers, labelled honestly where they differ musically (ADR-0459). | `devices.browser_player` |
| `cloud.seam_lead` | **Browser transitions planned early.** In a browser mix, each transition is worked out as its song starts instead of 45 seconds before it ends, every song plays at one level (-14 LUFS, as on Desktop), and a slow analysis moment is waited for instead of turning beatmatching off for the visit (ADR-0479 phase 1). Off: transitions are planned late and songs play at their own level, as before. | `cloud.browser_dsp` |
| `cloud.browser_moves` | **Browser transition moves.** The Desktop app's moves in a browser mix: SelectaDJ picks a bass swap, filter sweep, cut, echo out or reverb wash for each transition from the audio as it plays, the member can choose one, and each transition says what really played (ADR-0459). | `cloud.browser_dsp` |
| `cloud.browser_harmonic` | **Browser harmonic matches.** Make a Mix's Harmonic matches in a browser library: each song this device can play gets a whole-song key profile measured here in spare time, songs whose profiles and keys line up are offered as pairs to hear, and the audition plays the end of one into the start of the other from the files on this device. It is not the Desktop app's bar-by-bar chord search. | `cloud.browser_dsp`, `discover.harmonic` |
| `cloud.device_analysis` | **Whole-song facts measured on this device.** In a browser library, the background measuring that makes key profiles also measures each song whole, the way the Desktop does: its beat grid, bars, energy, chroma, tone, key, sections and loudness, kept in this browser. With cloud.brain also on, those numbers (never audio, paths or file names) are saved to the account, and the account's planner orders new browser mixes and chooses each transition from them (docs/engineering/device-to-account.md). Beats come from the Desktop's own tracker, Beat This, run in the browser where its model file is served from SelectaDJ's site, its Tier 3 review has passed and the device is fast enough; elsewhere from a lighter estimate, which the account ranks below the tracker and measures again once the tracker is there (docs/engineering/device-beats.md). Off by default while the owner publishes the model file and signs the review. Off: songs get their key profile only, nothing is sent, and mixes are ordered and blended as before. **Cloud surface:** headless (Measured and sent in the background; it changes the order and transitions of browser mixes, not any screen). | `cloud.browser_dsp`, `cloud.browser_harmonic` |
| `cloud.device_render` | **Transitions rendered on this device.** The browser's own rendering of transitions: it plays each transition the account's planner describes into a short clip ahead of time, the way the Desktop does, measures it with the Desktop's checks and follows the Desktop's repair rule (docs/engineering/device-render.md). With it on, with cloud.brain on and both songs measured, a playing mix prepares its next two transitions this way and plays each finished clip between the two songs, keeping clips on this device; a transition not ready in time, or in any doubt, plays live as before (docs/engineering/device-studio-playback.md). The Listening Room then compares the planner's choice made ahead with the other two ways. Its time-stretch is the browser's own, not the Desktop's Rubber Band. Off: no transition is rendered on this device and mixes blend live as before. **Cloud surface:** headless (Renders in a background worker and changes how transitions sound, not any screen; the Listening Room's comparison is behind its own flag). | `cloud.device_analysis` |
| `cloud.browser_stems` | **Browser stem moves.** Splitting songs into voice, drums, bass and melody on this device, only around each transition, for vocal ride, strip and land and intertwined stems in browser mixes (ADR-0459 Tier 3). Each device reports unsupported until the stem model's licence review and that device's evidence record pass. | `cloud.browser_moves`, `stems` |
| `cloud.venue_tablet` | **Venue tablet posture.** The single-tablet venue posture: capability checks and readiness guidance for a browser device playing a venue (ADR-0460). | `devices.browser_player` |
| `cloud.local_export` | **Local export.** Render a mix to a file in the browser player and save it on the member's own device; nothing is uploaded. | `devices.browser_player` |
| `rooms` | **Rooms.** Let Premium hosts share a request room with guests. |  |
| `rooms.votes` | **Room votes.** Let room guests vote on song requests. | `rooms` |
| `rooms.display` | **Room display.** Pair a screen to show the room QR code and playback queue. | `rooms` |
| `rooms.keeps` | **Keep the songs you liked.** A room guest's heart saves the playing song to a list kept only on their own phone. | `rooms` |
| `rooms.reactions` | **Room reactions.** Guests love the playing song or the blend into it; the room sees counts, and the planner learns what rooms loved. | `rooms` |
| `rooms.rounds` | **Pick the next song.** The room votes between songs the DJ can blend into, and the winner goes into the mix. | `rooms` |
| `rooms.dedications` | **Room dedications.** A guest adds one line from a fixed list to their own request, shown while the song plays. | `rooms` |
| `rooms.recap` | **Tonight in numbers.** When a room ends, the host, its guests and a paired screen see the room's totals. | `rooms` |
| `rooms.cloud_songs` | **Rooms offer songs in your cloud library.** For an account with a cloud library, a room also offers the songs in it, because the device playing the room can play them from there; any signed-in device can then play the room. Songs kept only on another device stay out, as before. Off, a room offers only the songs on the device playing it. | `rooms`, `cloud.stored_media` |
| `lucy.deep_plan` | **Lucy deep planning.** Use Lucy's premium planning model and larger plan allowance. | `lucy` |
| `admin.console` | **Staff console.** Show internal tools to authenticated staff with the required permission. |  |
| `admin.workers` | **Staff console: Workers.** The staff console's Workers page: the cloud studio at a glance per pool, the gateway, autoscaler, storage and flags around the workers, customer waits, processing cost against a budget, and guarded actions (retry, cancel long waits, pause a pool, ask the autoscaler for a worker). | `admin.console` |

## Autopilot and venue

| Flag | What it is | Needs |
|---|---|---|
| `cloud.mix_create` | **Make a mix in the Cloud.** Create and edit planned mixes from cloud library songs, using the same mix contract as the Desktop app. Seams are plain crossfades until songs have tempo and key facts. |  |
| `cloud.single_audio_owner` | **One Cloud player.** Cloud Library previews and Cloud Listen play through one persistent player that keeps playing across pages. |  |
| `cloud.account_states` | **Clear Cloud account states.** Exact Cloud routes and distinct messages for signed-out, expired, suspended and unreachable accounts. |  |
| `cloud.library_states` | **Truthful Cloud Library states.** Tell loading, failed, empty and ready apart, and report each uploaded file's own result. |  |
| `rooms.nickname_confirm` | **Confirmed guest nicknames.** Show a guest's nickname as saving, saved or not saved, and ignore older Room updates that arrive late. |  |
| `mixes.intent_language` | **Plain Make a mix choices.** Separate quick listen from a saved mix and say how long each setting lasts and what it applies to. |  |
| `autopilot.venue_mode` | **Autopilot venue mode.** Night sessions for a venue with defined autonomy levels, and pause, stop and manual takeover always available. |  |
| `autopilot.venue_policy` | **Venue music identity.** Versioned venue music policies, schedules, hard limits and timed overrides for Autopilot. | `autopilot.venue_mode` |
| `autopilot.horizon` | **Rolling musical horizon.** Plan the next stretch of the evening ahead, rank songs deterministically and replan only at safe points. | `autopilot.venue_mode` |
| `autopilot.safe_transitions` | **Conservative Autopilot transitions.** Check every transition before it plays and fall back to simpler, safer blends when a check fails. | `autopilot.venue_mode` |
| `autopilot.ai_director` | **AI DJ director.** Let an AI suggest typed, bounded changes to the Autopilot plan that staff can inspect and undo. | `autopilot.venue_mode` |

## Venue operations

| Flag | What it is | Needs |
|---|---|---|
| `venue.continuity` | **Venue audio continuity.** Gap and duplicate targets, ready-to-play fallback songs and fenced speaker leases, so a venue night keeps playing through faults. **Cloud surface:** headless (Runtime gap and duplicate targets, fallback preparation and speaker leases have no Cloud screen). | `autopilot.venue_mode` |
| `venue.fault_injection` | **Venue fault rehearsal.** Inject network, model and render faults on purpose in a test run to prove the night keeps playing. **Cloud surface:** rehearsal (Fault injection is run by the venue test and chaos harness, not by a customer-facing Cloud control). | `venue.continuity` |
| `venue.speakers` | **Venue speakers and zones.** Name the venue's speakers, group them into zones, and move or reconnect playback without two speakers playing at once. **Cloud surface:** unreleased (Speaker zone and lease models exist, but no speaker management page is mounted in Cloud). | `venue.continuity` |
| `venue.staff_dashboard` | **Staff dashboard.** One screen for venue staff: what is playing, what is next, typed steering, pending versus applied changes and an always-visible Stop. **Cloud surface:** unreleased (Staff dashboard state and isolated route tests exist, but no staff venue page or routes are mounted in Cloud). | `autopilot.venue_mode` |
| `venue.moderated_requests` | **Autopilot guest requests.** Guest requests in a venue night go through Room moderation, are planned fairly and tell the guest honestly what happened. **Cloud surface:** headless (The Room-to-Autopilot request planning bridge has no separate shipped Cloud interface). | `autopilot.venue_mode` |
| `venue.learning` | **Venue learning.** Learn a venue's taste from staff and guest feedback within a cap, with a reset, an explanation and a retention limit. **Cloud surface:** headless (Venue feedback memory, adaptation caps and retention operate in the backend without a Cloud control). | `autopilot.venue_mode` |
| `venue.rights_gate` | **Venue rights check.** Check music and model rights before each media operation in a venue and refuse the ones that are not cleared. **Cloud surface:** headless (Media and model rights checks are backend safety decisions without a person-facing Cloud page). | `autopilot.venue_mode` |
| `venue.roles` | **Venue roles.** Owner, manager, staff and guest roles decide who may steer, stop or change a venue night, and revoked devices lose access at once. **Cloud surface:** headless (Role permissions and paired-device revocation are backend authorization services, not Cloud pages). | `autopilot.venue_mode` |
| `venue.safe_gain` | **Safe venue loudness.** Cap automatic gain changes so Autopilot never makes the room suddenly louder. **Cloud surface:** headless (Automatic gain bounds are applied to venue playback decisions without a Cloud volume panel). | `autopilot.venue_mode` |
| `venue.health` | **Venue health and alerts.** Audio health signals, operator alert thresholds with runbook links, redacted logs and rehearsed recovery. **Cloud surface:** operations (Audio health monitoring, alerts and recovery rehearsal are operator tooling with no Cloud dashboard). | `autopilot.venue_mode` |
| `venue.soak` | **Long-session soak tools.** Real venue workloads, gap and resource metrics and long soak and chaos runs that record their evidence. **Cloud surface:** rehearsal (Long-session soak and chaos evidence are generated by the command-line harness, not Cloud UI). | `venue.continuity` |
| `venue.rollout_gates` | **Venue rollout gates.** Phased rollout order, no-go gates for P0 blockers and a flag-off rollback check before any venue release. **Cloud surface:** operations (Release phase ordering, readiness gates and flag rollback checks run as operational tooling). | `autopilot.venue_mode` |

## Business

| Flag | What it is | Needs |
|---|---|---|
| `business.signups` | **SelectaDJ for Business sign-up.** Self-serve business sign-up and selling of business plans. Off until the legal review passes; pilots work without it. |  |
| `business.start` | **Business start page.** The /business/start page: while sign-up is off, a pilot contact form that emails REX Technologies; once sign-up is on, naming a new organisation. |  |
| `business.orgs` | **Organisations, venues, zones and crates.** An organisation workspace with its venues, each venue's zones, and organisation and venue crates drawn from one shared library. |  |
| `business.zones` | **Zone playback.** One playback session per business zone: a kiosk or a staff member's browser plays a zone, remotes steer the zones in their scope, and the home kiosk takes its zone back at a song boundary. | `business.orgs` |
| `business.schedules` | **Venue schedules and programmes.** Opening hours, holiday exceptions, stay-open-late and close-now overrides, plus zone programmes and state. | `business.orgs` |
| `business.entitlements` | **Business allowances and continuity.** Pooled storage that grows with venues, paid zone limits, the opening-hours processing weight, the usage meters for managers, and the monthly continuity figure with service credits proposed for staff approval. | `business.orgs` |
| `business.offline` | **Offline zone controls.** Kiosk players keep about four hours of music saved ahead with a signed offline permit, so the music never stops when the venue internet drops; plus offline manifests, command resync and cache reports. Off, a player keeps only the next three songs and plays only while connected. | `business.kiosk` |
| `business.kiosk` | **Kiosk players.** Pair a small dedicated player to a zone with a code; it starts the music by itself, reports its health, keeps saved music for outages and tells managers when a zone goes quiet. | `business.orgs` |
| `business.workspaces` | **Workspace switcher.** Switch between your personal SelectaDJ and the organisations you belong to. Personal and business data never mix. | `business.orgs` |
| `business.billing` | **Business billing.** The owner and admin billing page: quantities and prices, a cost preview before adding venues, zones or seats, PO number and cost centres for invoices, a cost breakdown CSV, and dunning that stops a venue only at its close after warnings. Stripe test mode only. | `business.orgs` |
| `business.licensing` | **Licensing and play logs.** Music licences gate when a venue may start playing, with reminders and the owner's one-off extension; every play is logged with its source and kept 3 years by default; owners, admins and venue managers download a venue's play log as CSV; ISRC entry and coverage; acceptance of the business terms. | `business.orgs` |
| `business.roles` | **Business people and roles.** The People page: owners, admins and venue managers invite people by link into a role at chosen venues, see seats, revoke invitations and remove someone, which signs them out at once. | `business.orgs` |
| `business.devices.shared` | **Shared staff tablets and PINs.** A staff member confirms an action on a shared tablet with their personal venue PIN, so the activity log names them. | `business.roles` |
| `business.console` | **Business HQ console.** The multi-venue overview for owners, admins and viewers: venue health, zone states and what needs attention. | `business.workspaces` |
| `business.venue_view` | **Venue manager view.** One venue's page for its managers: now playing, schedule, rules, devices and people. | `business.workspaces` |
| `business.staff_controls` | **Staff quick controls.** The staff screen for a venue: skip, steer, volume within the cap, requests, and Play here to make this browser the zone's speaker. | `business.workspaces` |
| `business.mix_exports` | **Business mix exports.** Lets a business organisation save a mix as a file, which could be redistributed. Off by default; also needs the owner's setting. | `business.licensing` |
| `business.pilots` | **Business pilots.** REX Technologies staff create free pilot organisations with their venues and zones, using the same model a paying venue will. | `admin.console`, `business.orgs` |
| `business.content_controls` | **Venue content controls.** Organisation and venue music rules, the blocklist, 24-hour overrides, explicit flags from managers and file tags, and each zone's volume cap with quiet hours. | `business.orgs` |
| `business.content_controls.bulk` | **Bulk explicit editor and CSV import.** Mark many organisation songs explicit, clean or not checked at once with a count and undo, and import marks from a CSV matched by ISRC, then artist and title. | `business.content_controls` |
| `business.content_controls.lyrics_hint` | **Worth checking list.** Lists organisation songs whose lyrics contain words on a review list, for a person to check. It never marks a song clean or explicit by itself. | `business.content_controls` |
| `business.rooms` | **Rooms for Business.** Standing guest request rooms for business zones: guests join with a table-card code, staff approve or pass requests, and managers set modes and limits. | `business.orgs` |
| `business.rooms.branding` | **Rooms for Business branding.** The venue's logo, colour and welcome line on the guest request page. | `business.rooms` |
| `business.rooms.print` | **Rooms for Business print sheet.** A printable sheet of table cards with each zone's join code. | `business.rooms` |
| `business.rooms.screen_code` | **Rooms for Business screen code.** A rotating join code shown on the zone's display screen. | `business.rooms` |
| `business.rooms.keeps` | **Venue rooms: keep the songs you liked.** A venue guest's heart saves the playing song to a list kept only on their own phone. Off while Business is not on sale. | `business.rooms` |
| `business.rooms.reactions` | **Venue rooms: reactions.** Venue guests love the playing song or the blend into it; the room sees counts, and the zone learns what its guests loved. Off while Business is not on sale. | `business.rooms` |
| `business.rooms.rounds` | **Venue rooms: pick the next song.** A venue room votes between songs the zone's content rules allow now; the winner is the next request the player is given. Off while Business is not on sale. | `business.rooms` |
| `business.rooms.dedications` | **Venue rooms: dedications.** A venue guest adds one line from a fixed list to their own request. Off while Business is not on sale. | `business.rooms` |
| `business.rooms.recap` | **Venue rooms: tonight in numbers.** A zone's totals for its last trading stretch, for staff, for guests once it has closed, and for a patron screen. Off while Business is not on sale. | `business.rooms` |
| `business.rooms.display` | **Venue rooms: patron screen.** Pair a screen at /display to a zone, to show its join code, what is playing and what the room is doing together. Off while Business is not on sale. | `business.rooms` |
