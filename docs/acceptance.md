# Build-plan acceptance ledger

This ledger combines measured acceptance runs with the latest live-library snapshot below. Evidence may come from the real library, a browser, or automated tests; a passing test proves its stated behavior, not that a transition sounds good. Only a listener can say whether Selecta sounds good, so "Heard" says what the listener has told us so far.

## Works

| What | Evidence | Known limits |
|---|---|---|
| Library scan and filter | 1,389 files in 5 s: 707 songs, 614 set aside, 68 duplicates | An override can only be set in the database |
| Fast analysis, resumable | 187 of 707 songs done. Tempos match known values. Start and pause from the Workshop | The other 520 take about 3.5 hours at about 25 s each. Key accuracy is unchecked by ear |
| Lyric lookup | 583 of 707 songs have line-synced lyrics | English gets word timing. Other languages rarely pass the check |
| Web app | Build a mix, reorder, lock, swap, edit any seam, hear it, rate it, export it. All views fit a 375 px phone with no sideways scroll. The Mixes view has a five-stop energy curve that can be drawn or adjusted with sliders, saved, and reset to each mix's own shape. Fullscreen Stage mode is already available | Folder entry is typed, not picked |
| Playing a set | Gapless Web Audio from finished audio. A real seam played through in the browser, with lyrics, the song strip, and current-word focus following playback. Word focus uses a line-level timing estimate intended only for display | Not yet run for a full set or evaluated against sung-word ground truth. Stem artifacts and mix quality still need listening |
| Set export | A 3.6-minute mix saved in 5 s and downloaded | Every seam must be rendered first |
| Draft mixes | Edit a mix without touching what's playing. Saves as you go, with its own undo. Playing one trades places with the current mix, and undo restores both. Saved mixes become drafts. Tested through the routes and pages, and on a copy of the real library | Library and Words pages still add to the current mix only |
| Render line | Prioritized drafts render after the current mix and ahead of everything else, in an order you can change. On real songs, the current mix rendered first and the first draft in line started by itself. A line seam stops for the current mix or if its mix changes | Pauses at the storage limit, and says so |
| Arranging from stems | Strip and land: measures each stem square by square, searches for the best arrangement, renders, checks and repairs. On the seam the listener shaped and rated Good, the search lands on exactly what they made, without being told | One rated example so far, so the scoring weights are starting values. Whether other pairs sound good needs ears |
| Seam Studio | Both songs' stems on one grid, heard instantly. Selecta can arrange it or fine tune yours, and says what changed. Real session: split, grid, play, use, undo. A shaped seam was rated Good by the listener | Two-bar squares only |
| Hearing what's detected | One press plays the chords read, each song with them, then both, with chord names lighting up. Real audition took about 15 s to prepare under load. The chord list went from one song in the first slot to 184 | Whether a match is real is for the listener to judge |
| Song requests | Planned together: no song is used twice, and each spot goes to one request at a time. Rechecks on any track change, mix edit or press. Shown faded in Edit until ready, and a bridge joins in one step. 8 waiting requests recheck in about 0.2 s on 581 songs | Not heard from start to finish with a real bridge rendering. On one 122 to 132 BPM mix, of 60 random songs, 5 fit directly, 11 through a bridge, 40 had no clean way in, and 4 had no steady beat. Those can still be played anyway |
| Find a bridge | Goes through the whole library, up to 3 extra songs, every spot in the mix. The same 60 songs took 41 s in all starting from nothing, and what's found is kept for next time | Half and double time don't count as close tempos here yet |
| Songs always get played | A way out can't start before the way in has finished, plus 30 seconds. Fixed whenever a mix is read, in the current mix and drafts. On one real mix, 4 of 15 songs were being skipped past before this | A place chosen by hand is flagged rather than moved |
| New songs arriving | Looks every minute, and each song comes in once it's finished copying. A long download doesn't hold back what's finished. A vanished folder or most of a folder going is held back, not deleted | Unreadable files wait until they change or a full rescan |
| Spare time | After the top 30 word links, the best transitions across the library, each song's best partner first, at the lowest priority. What's come out clean isn't made again even after its audio is cleared | Stops at 80% of the storage limit. Rendered clips only help requests and hand-picked moves directly. Planned mixes benefit from what's learned |
| Time estimates | From this PC's own times. Walking through 581 real analyses, typically about 1.3x out for the next song and about 1.2x for the next 25. Over 150 real jobs, quoting from the middle of the last 12 was typically 1.15x out for the next job (1.25x for stem splitting alone) and 1.2x for the next dozen. The live score is in the Workshop | Depends on what else the PC is doing. Stems still to split are worked out before a seam starts, but a seam that falls back to another move takes longer than quoted. Scanning has no estimate |
| Word links | All 583 songs searched in 3.3 s: 12,878 pairs. 896 fit musically across the 172 songs with timing | Machine-found links can still be corny. Only a listener can judge |
| Word timing | Starts within about 80 ms of what the model hears unguided, on four sung lines read by hand. On speech with known times, a steady 66 to 70 ms offset, unchanged over music, which settling onto the voice removes | No ground truth on singing. Many lines are refused, including *Layla* |
| Local-only server | Foreign hosts and other sites' changes get 403. A bad request gets 400. The page makes no outside requests | Binds to 127.0.0.1 |
| Storage and song priority | Workshop shows free and cached storage and lets the user set a cache budget. Library can mark songs for first-priority analysis/stem retention and filter to the priority list; queue-order and API tests cover priority behavior | Priority is binary, not a manually ranked queue; old cache entries without song metadata cannot be tied back to priority songs |

## Latest live-library snapshot — 5 November 2026, 22:16 UTC

- Scan: 1,389 files: 707 music, 614 set aside, 68 duplicates.
- Audio analysis: 93 of 707 complete; 614 remain. The background worker is running.
- Mix-ready pool: 85 songs currently pass the planner's cue and feature checks. The UI code now reports this separately from completed audio analysis.
- Lyrics lookup: 583 synced lyric rows, 7 instrumentals, 17 plain-text-only results, and 103 misses. The full 555-song uncached lookup returned 461 synced lyrics, 5 instrumentals, 11 plain-text results, and 78 misses.
- Storage: 61.3 GB free; 0.58 GB cached; the current cache budget is 25.6 GB.

The older measured mix and word-link counts below are historical results; this run is rebuilding the usable pool as analysis and lyric lookup continue.

## Transitions

| Move | Heard | Notes |
|---|---|---|
| Bass swap blend | 5 of 7 good | Prefers letting B's chorus land as A leaves, rather than fading it in |
| Filter sweep | 2 of 2 good | One note: A's vocals should ride longer |
| Tempo ramp | 1 of 2 good | Same note on the good one |
| Echo out, cut, delay throw, reverb | 0 of 4 on reel 1, then 4 of 7 on reel 2, one only "tolerable" | No measurement separated the good from the bad |
| Word cut | 3 of 5 good | Now needs tempos within 6% |
| Word blend | 2 of 3 good | Reworked after the first note. Reel 4's try "just doesn't work" |
| Phrase roll | 4 of 6 good | Shape comes from each pair, bass in steps. Rock songs excluded. Reel 4: "much better", though the last repeat could be better |
| Word echo | 0 of 4 | Removed |
| Vocal ride | 2 of 2 good, "insane" and "swaggy" | Came from the listener's notes. Now tried first between any two songs that suit it |
| Call and response | 0 of 3 on reel 4, "too algorithmic" | Rebuilt after that note: a vocal ride, with A's phrase dropped into B's real gaps between lines, at falling levels. The rebuilt version hasn't been heard |

The new rules were set from these same ratings, so only further reels can test them.

Phrase rolls now vary repetition count, acceleration, and bass arrival with the outgoing vocal span,
local energy and low-band share, the incoming section's energy and bass share, and how much of B's
beat grid is available before its word. Synthetic tests cover a sparse source into a stronger lift
and a crowded source into a bass-heavy section. These checks show pair-dependent behavior, not that
the effect sounds right; real-song listening is still needed.

The 6 November 2026 Preview snapshot had 23 ratings: phrase roll 7 Good / 9 Bad; word blend 2 Good;
vocal ride, echo out, and word cut 1 Good each; delay throw and bass swap blend 1 Bad each; other
styles unrated. Bad ratings now remove only their exact ordered song-pair/style from automatic
planning. They do not blacklist a style from other pairs. The sample is too small to infer global
style quality. Vocal ride, echo out, delay throw, reverb-wash, phrase-roll, and call-and-response
tails now respond to the incoming lyric runway. Beatmatched bass swaps also adjust to local energy
and low-band share. Tests verify the parameter mapping; listening still needs to establish
whether the stems and tails sound natural on these songs.

## Rendering

| What | Measured |
|---|---|
| Order | What's about to be heard, then the next 2 transitions, then requests, then the rest of the current mix, then the render line, then other asks, then word links and the library's best transitions in spare time. Unit tests cover the order |
| Giving way | A word render stops as soon as a mix seam is waiting. Analysis of the library pauses between songs while the mix renders |
| Speed | On the 4-core laptop with analysis paused, three of a real mix's seams finished in about five minutes. A seam needing stems can take longer |
| Helpers on Windows | A helper froze while the worker waited on its input pipe. Side by side: still frozen after 25 s, against 0.3 s with the fix. Covered by a test |
| Memory | Each analysis process holds about a gigabyte. 24 at once nearly filled the machine, so requests now share one process, one song at a time |

## Mixes

Sixteen mixes under four headings: the moment, the mood, the sound and the journey, plus Selecta's pick. Each one reads lyrics, key, tempo, energy, genre and year against the rest of the library, and says which songs belong most, not just which are allowed.

| What | Measured on the real library, 3 builds of each mix, 510 seams |
|---|---|
| Moves planned | Vocal rides 29%, blends 18%, ramps 18%, filter sweeps 15%, word moves about 8%, echoes and throws 8%, cuts under 2% and only in Rap run. Before this, 47% of "let Selecta pick" seams ended as cuts, going by every seam rendered so far |
| Variety | No move runs twice in a row where anything else fits, and each move has a cap on its share of a mix. A move's weight falls the more that mix has used it. Fallbacks read the same counts, so a fallback doesn't pile onto what the mix has plenty of |
| Length | Mixes reach the length asked for wherever enough songs exist. Small pools relax how far apart an artist must be, rather than stopping short |
| Seasonal songs | Christmas songs only play in the Christmas mix, which appears once there are enough of them |

On 6 November 2026, ten four-song mini-sets were exported to `Music/Selecta Mixes Stem Refresh 2026-11-06`.
All 40 source tracks are unique; all 30 transitions passed the seam audit, and every MP3 decoded without
errors. This establishes file integrity and automated checks, not that a person has approved the sound.

Vocal rides now find where a voice stops and starts from the separated vocal itself, so they work in any language. Moves that need exact words still rely on an English-only timing model, so those are planned only for English songs, and only where timing hasn't already failed. Past results are read back before planning, so a move that failed on two songs isn't planned for them again.

A warning on a rendered seam means a check fell short. Of 106 seams rendered before this work, 24 had one: mostly the level falling away after an echo, then beats 29 to 52 ms apart. So placements where the level falls now score lower, a steady beat gap is closed with a second take, and a clean ride or blend is tried before settling for a near miss. A near-miss ride or blend still beats a clean effect by ear, and it keeps its warning rather than hiding it. Songs and pairs behind past warnings get planned less.

On a real 12-song mix after this, all 11 seams rendered: 4 vocal rides, 2 filter sweeps, 1 blend, 2 echoes, 2 throws and no cuts, with 3 warnings. That's one mix, not a measured rate.

Suggestions for the + button and Bigger, Calmer and Something else are scored the way mixes are built: the hand-over on both sides, how well the song suits the mix, and keeping artists apart. Each one says what will happen, such as "A voice can ride across" or "A tempo ramp gets there".

The planned shares above are what's asked for. What it sounds like, and how often a planned move survives rendering, needs more listening and more real renders.

### Local export batch — 5 November 2026

- Ten four-song MP3s were exported to `Music/Selecta Mixes Refresh 2026-11-05`, with 40 distinct library IDs across the batch. Each also has a tracklist and per-seam audit results.
- All 30 rendered seams passed the current automated checks. The renderer chose 27 clean cuts and 3 bass-swap blends. This is a cut-heavy result, not evidence of the smoother blended sound requested; the exports still need a person's listening review.

## What ratings showed

From 52 unique rated seams, 26 Good and 26 Bad, read across every data folder. `selecta ratings` prints this at any time. It's a small sample from one listener, so it steers the planner rather than ruling anything out.

| Seams with | Good |
|---|---|
| Overlap of 8 bars or more | 13 of 16 |
| Overlap of 4 bars | 0 of 6 |
| Overlap with tempos within 4% | 11 of 13 |
| Overlap with tempos 4 to 8% apart | 2 of 9 |
| Key distance of 5 or more | 2 of 10, against about 57% below that |
| A beat grid under 0.8 | 3 of 13, against 23 of 39 at 0.8 or above |
| A warning from the audit | 0 of 3 |
| Vocal ride | 5 of 6 |
| Phrase roll within 10% tempo | 3 of 4, against 4 of 14 beyond it |
| Delay throw | 2 of 6 |
| Tempo ramp | 0 of 2 |

Key closeness below 5 and matching genre tags didn't separate Good from Bad, so they don't get more weight. Because no warned seam was liked, any clean take now beats a near miss. As more ratings come in, the same counts adjust planning by themselves.

## One data folder

Packaged desktop apps quietly redirect AppData to a private copy, so one library had split into a folder for each app that started Selecta. Data now lives in `~/.selecta`, which isn't redirected. On starting, `selecta web` brings in whatever older folders have, and `selecta gather-data` does the same on request. Older folders are only read, so they stay as a backup until someone deletes them.

## Partly works

| What | Works | Doesn't |
|---|---|---|
| Planner | 8 songs in 5 s, artists kept 10 apart, locks kept, feel honoured by each seam | The arc follows energy numbers that barely vary (0.32 to 0.55) until they're rescaled |
| Steering | Bigger, calmer, something else, feel, length, start song, lock; saved transition feel is sent from the Mixes UI and overrides a mix's default style in planner tests. “Take me to” searches mix-ready songs and constrains a new plan to end on the chosen destination. Stem-assisted moves have persistent Never / Sometimes / Often steering. The planner can select a gated 16-bar intertwined-stem move, and that choice reaches the same seam renderer, audio preview, and audit path as other moves. A saved five-stop energy curve now steers both opening-song choice and the planner's energy-fit score; sliders provide keyboard access and the graph supports pointer drawing | Destination steering is an endpoint constraint in the beam planner, not yet a shortest-path search through the seam graph. The intertwined render has automated beat, phrase, vocal-overlap, low-end, and peak checks, but no reliable stem-artifact detector; listening still decides whether exposed stems sound clean |
| Stem cache | Whole windows across stems and rendered seams are budgeted together; priority-song stem windows are protected by source metadata | Existing windows created before metadata cannot be mapped to priority songs and remain ordinary eviction candidates |
| Audit | Fails broken renders and sagging seams, in plain words | Beat check misreads syncopated drums, so rides allow up to 40 ms. Thresholds are starting values |

## Discovery and evaluation: implemented, with acceptance still open

Temporal discovery progress (6 November): audio search stores eight-bar ordered harmonic-sequence candidates across offsets and fixed transpositions, including exact source start times for audition. Sequence tests cover reordered-profile rejection, held/silent/invalid windows, transposition and offsets. Search tests cover persistence and limits. The `/api/discoveries` routes and `web/src/views/Links.tsx` expose harmonic candidates, audio auditions and saved reviews. UI tests cover advancing after a review, preparing the next pair, skipping without rating, and pausing the mix during auditions. These are implementation checks; full-library precision, runtime, melody-contour verification and stem consonance still need evidence. Candidates are not automatic-set approvals.

The blind-comparison infrastructure exists in `src/selecta/listening.py`, `/api/listening`, and the Workshop's `Listening` component. It stores hidden condition assignments, prepared audio, preferences and optional quality grades. Tests cover loudness preparation, invalid audio, hidden identities, missing responses and failed saves. Reopening a study now clears prior quality scores. None of this establishes a listening-test win: the original plan still requires about 60 stratified pairs, baseline comparisons, human responses and a measured bad-transition rate. Missing grades must remain missing rather than count as good transitions.

## Not built or not yet demonstrated

`selecta discover --exhaustive --pair-limit 1000` now checks every analysed song pair in
resumable batches. It persists positive and negative comparison checkpoints, invalidates them when
chroma, bar times, artist, duration or matcher version changes, and yields to current mix work
before each new pair. The command reports remaining pairs; rerun until that count is zero.
Regression coverage verifies reopening the database, skipping unchanged non-matches and
rechecking affected pairs after a feature change. A complete real-library sweep has not yet been
measured. This covers harmonic candidates, not the missing melody, sample or rhythm detectors.

- Verified melody-contour, sample and rhythm discovery, and shortest-path destination search. Audio search includes ordered harmonic matching as well as coarse whole-track mean-chroma candidates. The latter remain outside the audition API and are not melody matches. The default quick search still samples up to 80 partners per song and caps harmonic matches at three per song; full coverage requires the exhaustive command above.
- Completed blind listening evaluation against the planned baselines. "Best DJ" isn't proven until Selecta wins it on bad-transition rate.
- The typographic word-to-word match cut. Fullscreen Stage mode and approximate current-word focus work, but the lyric highlight has not been validated against sung-word ground truth.
- Loop rolls on A's band, a dedicated half/double-time transition, drop swaps and brakes. Tempo-free landings already compare half/double BPM relationships, but that alone does not beatmatch a long blend. The placeholders that faked the missing moves are gone.
- No blind paired listening study yet to measure whether the intertwined transition improves the mix versus a conventional blend on the same pair.

## Selecta 2.0 pages and server contracts

Measured on 6 November, with a library synthesized by `tests/e2e_server.py`, in headless Edge.

| What | Evidence | Known limits |
|---|---|---|
| A transition starts where it was planned | In real Web Audio, A hands over within 10 ms of the rendered exit, and B starts as the clip ends, at the place the clip reached | Timing only. It says nothing about how it sounds |
| Pages at every size | No sideways scroll on any page from 320 px to 4K, in landscape, or at widths equal to 200% and 400% zoom | A real on-screen keyboard wasn't tried |
| Automatic accessibility checks | Every page passes axe's WCAG 2.2 AA rules in both themes at desktop and phone width | Automatic checks only. NVDA and VoiceOver haven't been tried |
| A large library | 20,000 songs all reachable by paging, with the slowest page under 2 s | Measured in tests with made-up rows, not a real 20,000-song scan |
| Nothing leaves this computer | Every page's requests stay on this computer | Lyric lookups by the server still go to lrclib.net unless turned off |

Each task in the Selecta 2.0 tracker is listed in [implementation-evidence.md](adr/implementation-evidence.md), including what's only partly done.

## Still needs a person

- Whether anything sounds good, especially the moves not yet heard.
- Beat, downbeat and key accuracy on rap and Latin tracks.
- Whether the interface is actually easy to use. Every screen was walked in a browser at desktop and phone width, with page tests in `web/src`, but that can't judge taste.
