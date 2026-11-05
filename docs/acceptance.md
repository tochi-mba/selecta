# Build-plan acceptance ledger

Every line here was checked on 5 November 2026 by running it on the real library or in a real browser. Green CI only proves the code builds and its tests pass, so it counts for nothing here. Only a listener can say whether Selecta sounds good, so "Heard" says what the listener has told us so far.

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

## Transitions

| Move | Heard | Notes |
|---|---|---|
| Bass swap blend | 5 of 7 good | Prefers letting B's chorus land as A leaves, rather than fading it in |
| Filter sweep | 2 of 2 good | One note: A's vocals should ride longer |
| Tempo ramp | 1 of 2 good | Same note on the good one |
| Echo out, cut, delay throw, reverb | 0 of 4 on reel 1, then 4 of 7 on reel 2, one only "tolerable" | No measurement separated the good from the bad |
| Word cut | 3 of 5 good | Now needs tempos within 6% |
| Word blend | 1 of 1 good, "could be smoother" | Reworked after that note |
| Phrase roll | 2 of 4 good | Reworked after that note: shape comes from each pair, bass in steps. Rock songs excluded |
| Word echo | 0 of 4 | Removed |
| Vocal ride, call and response | Not yet heard | New on reel 4. Vocal ride came from the listener's notes, call and response from DJ tutorials |

The new rules were set from these same ratings, so only further reels can test them.

## Partly works

| What | Works | Doesn't |
|---|---|---|
| Planner | 8 songs in 5 s, artists kept 10 apart, locks kept, feel honoured by each seam | The arc follows energy numbers that barely vary (0.32 to 0.55) until they're rescaled |
| Steering | Bigger, calmer, something else, feel, length, start song, lock | "Take me to" isn't built |
| Stem cache | Whole windows are deleted, oldest first | Nothing passes priority songs to it yet. Each stem window now also keeps a band file, using more disk |
| Audit | Fails broken renders and sagging seams, in plain words | Beat check misreads syncopated drums, so rides allow up to 40 ms. Thresholds are starting values |

## Not built

- Melody, sample, rhythm and shortest-path discovery. The old same-melody search matched everything, and still runs under `selecta discover`, but the app no longer shows it.
- The blind listening test. "Best DJ" isn't proven until Selecta wins it on bad-transition rate.
- Stage view, the drawn Arc, and the typographic word moment.
- Loop rolls on A's band, half and double time, drop swaps and brakes. The placeholders that faked these are gone.
- The intertwined transition: no beat alignment, and the planner can't reach it.

## Still needs a person

- Whether anything sounds good, especially the moves not yet heard.
- Beat, downbeat and key accuracy on rap and Latin tracks.
- Whether the interface is actually easy to use.
