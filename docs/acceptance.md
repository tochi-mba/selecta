# Build-plan acceptance ledger

This ledger combines measured acceptance runs with the latest live-library snapshot below. Evidence may come from the real library, a browser, or automated tests; a passing test proves its stated behavior, not that a transition sounds good. Only a listener can say whether Selecta sounds good, so "Heard" says what the listener has told us so far.

## Works

| What | Evidence | Known limits |
|---|---|---|
| Library scan and filter | 1,389 files in 5 s: 707 songs, 614 set aside, 68 duplicates | An override can only be set in the database |
| Fast analysis, resumable | 187 of 707 songs done. Tempos match known values. Start and pause from the Workshop | The other 520 take about 3.5 hours at about 25 s each. Key accuracy is unchecked by ear |
| Lyric lookup | 583 of 707 songs have line-synced lyrics | English gets word timing. Other languages rarely pass the check |
| Web app | Build a mix, reorder, lock, swap, edit any seam, hear it, rate it, export it. All views fit a 375 px phone with no sideways scroll | No drawn energy arc or Stage view yet. Folder entry is typed, not picked |
| Playing a set | Gapless Web Audio from finished audio. A real seam played through in the browser, with lyrics and the song strip following | Not yet run for a full set, and only checked by its on-screen state, not by ear. No lyric word highlighting |
| Set export | A 3.6-minute mix saved in 5 s and downloaded | Every seam must be rendered first |
| Word links | All 583 songs searched in 3.3 s: 12,878 pairs. 896 fit musically across the 172 songs with timing | Machine-found links can still be corny. Only a listener can judge |
| Word timing | Starts within about 80 ms of what the model hears unguided, on four sung lines read by hand. On speech with known times, a steady 66 to 70 ms offset, unchanged over music, which settling onto the voice removes | No ground truth on singing. Many lines are refused, including *Layla* |
| Local-only server | Foreign hosts and other sites' changes get 403. A bad request gets 400. The page makes no outside requests | Binds to 127.0.0.1 |

## Latest live-library snapshot — 5 November 2026, 22:02 UTC

- Scan: 1,389 files: 707 music, 614 set aside, 68 duplicates.
- Audio analysis: 79 of 707 complete; 628 remain. The background worker is running.
- Mix-ready pool: 48 songs currently pass the planner's cue and feature checks. The UI now reports this separately from completed audio analysis.
- Lyrics lookup: 76 synced lyric rows, 2 instrumentals, 6 plain-text-only results, and 21 misses. The first 50 newly prioritized lookups returned 45 synced lyrics, 2 instrumentals, and 3 misses.
- Storage: 64.1 GB free; 0.36 GB cached; the current cache budget is 25.6 GB.

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

## Rendering

| What | Measured |
|---|---|
| Order | What's about to be heard, then the current mix in order, then other requests, then word links in spare time. Unit tests cover the order |
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

Vocal rides now find where a voice stops and starts from the separated vocal itself, so they work in any language. Moves that need exact words still rely on an English-only timing model, so those are planned only for English songs, and only where timing hasn't already failed. Past results are read back before planning, so a move that failed on two songs isn't planned for them again.

The planned shares above are what's asked for. What it sounds like, and how often a planned move survives rendering, needs more listening and more real renders.

## Partly works

| What | Works | Doesn't |
|---|---|---|
| Planner | 8 songs in 5 s, artists kept 10 apart, locks kept, feel honoured by each seam | The arc follows energy numbers that barely vary (0.32 to 0.55) until they're rescaled |
| Steering | Bigger, calmer, something else, feel, length, start song, lock; saved transition feel is sent from the Mixes UI and overrides a mix's default style in planner tests | "Take me to" isn't built; the intertwined stem move isn't in the mix planner |
| Stem cache | Whole windows across stems and rendered seams are budgeted together; priority-song stem windows are protected by source metadata | Existing windows created before metadata cannot be mapped to priority songs and remain ordinary eviction candidates |
| Audit | Fails broken renders and sagging seams, in plain words | Beat check misreads syncopated drums, so rides allow up to 40 ms. Thresholds are starting values |

## Not built

- Melody, sample, rhythm and shortest-path discovery. The old same-melody search matched everything, and still runs under `selecta discover`, but the app no longer shows it.
- The blind listening test. "Best DJ" isn't proven until Selecta wins it on bad-transition rate.
- The drawn Arc and the typographic word moment. Fullscreen lyrics work, without the word moment.
- Loop rolls on A's band, half and double time, drop swaps and brakes. The placeholders that faked these are gone.
- The intertwined transition: no beat alignment, and the planner can't reach it.

## Still needs a person

- Whether anything sounds good, especially the moves not yet heard.
- Beat, downbeat and key accuracy on rap and Latin tracks.
- Whether the interface is actually easy to use. Every screen was walked in a browser at desktop and phone width, with page tests in `web/src`, but that can't judge taste.
