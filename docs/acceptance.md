# Build-plan acceptance ledger

Every line here was checked on 5 November 2026 by running it, against commit `74a3e2b`, on a copy of the real library. Green CI only proves the code builds and its tests pass, so it counts for nothing here. Nothing below says whether Selecta sounds good, because only a listener can judge that.

## Works

| What | Evidence | Known limits |
|---|---|---|
| Library scan and filter | 1,389 files in 5 s: 707 songs, 614 set aside, 68 duplicates. Every audiobook folder caught | An override can only be set in the database, not in the app |
| Fast analysis, resumable | Tempos match known values (`I Wish` 105.9, `Fast Car` 104.4). Resumed cleanly after being killed mid-run | Key accuracy is still unchecked by ear |
| Lyric lookup | 583 of 707 songs have line-synced lyrics | Timing is by line, not by word |
| Core recipes | `cut_on_one`, `echo_out`, `delay_throw`, `reverb_wash`, `bass_swap_blend`, `filter_sweep` render real songs | Not yet judged by ear |
| Blend timing | Drums separated with Demucs in the 5 reel blends: typical offset 3 to 17 ms, against a 20 ms limit | Only blends that passed the audit were measured. Two have some hits further out, 26 and 56 ms at the 90th percentile |
| Audit and repair | Broken renders fail the right checks, failures steer the next attempt, and the harmony check catches a tritone or semitone clash on overlaps of 8 bars or more | Thresholds aren't calibrated against ratings. Only 6 of 36 blend renders passed, mostly on beat alignment, and it isn't known yet whether the rejected ones were really off |
| Stem windows | 46 s window in 112 s under heavy CPU load, 32 MB, 0 ms offset against the main decode | The cap deletes single files, leaving broken windows, and ignores priority |
| Set export | 4.3-minute set in 34 s, with every transition passing its audit | One transition with no audited option aborts the whole export |
| Local-only server | Foreign hosts get 403, and audio is reachable only by song ID | No Origin check, so another website can rebuild the queue. A bad request returns 500 |

## Partly works

| What | Works | Doesn't |
|---|---|---|
| Planner | Builds a queue with feasible transitions | An artist repeated 2 songs apart (the rule is 10). About 91 s for 20 songs on a 25-song library |
| Steering | Mix language and stems change the plan | More, Less, Take me to, Wordplay and Effects never change it. Undo does nothing. A locked song loses its lock on re-plan |
| Mix language | `seamless` planned real blends | `punchy` names a recipe that doesn't exist (`backspin`). `wordplay` plans cuts with no link: 1 of 5 shared any word, by chance |
| Lyric links | Matches on whole tokens | Top results are generic ("you know that"). A full-library run would build about 22 million pairs (my estimate: about 9 GB), so it hasn't been run |
| Web interface | Screens load, search works, storage slider saves | See below |

## Not real yet

| Claim | What's actually there |
|---|---|
| Extended recipes | `drop_swap`, `half_double` and `word_cut` are sample-identical to `cut_on_one`. `brake` is identical to `reverb_wash`. `long_blend` is `bass_swap_blend`. Nothing can loop, because the renderer has no loop control. `riser_air` adds no riser. `tempo_ramp` is a relabelled filter sweep, and it failed its audit on the 120 to 135 BPM test pair |
| Stem recipes | The planner never supplies stems, so they fall back to an echo. Given a real stem window, A renders silent |
| Wordplay | `word_cut` and `word_loop` never read a word. No word aligner exists. `cut_safe` and `energy_minimum_boundary` are never called outside their tests |
| Same-melody search | Flagged 300 of 300 song pairs, and matched a tune against its own notes shuffled and transposed, because it averages note order away first |
| Other discovery | No fingerprint, rhythm, shortest-path or LLM judge code exists, so "Take me to" has nothing to run on |
| Blind listening test | Rating functions exist, but no route calls them. The page has no audio, its buttons send nothing, and no baselines exist |
| Playing a set in the browser | The Deck plays one original file through a plain audio tag, with no transition and no loudness match. No route serves a rendered transition |
| Deck and Stage content | Lyrics, the section strip and "hold the word" are hard-coded placeholders |
| Dead controls | `Resume set`, and every rating, tag and Next button in the Listening Room |
| Screens and layout | No Start screen or folder picker. Navigation disappears below 750 px |
| "Priority songs are protected" | The stem cache evicts by file access time only and never reads priority |
| "Local only" | The stylesheet imports Google Fonts, so the page contacts Google |
| Intertwined transition | No beat alignment: on 30 eligible pairs the median offset was 145 ms, and 93% were over 40 ms, which reads as two separate hits. Its timing is hard-coded in seconds, it isn't audited, and the planner can't reach it |

## Still needs a person

- Whether any transition sounds good.
- Beat, downbeat and key accuracy on rap and Latin tracks.
- Whether any discovery is clever rather than corny.
- The blind comparison, once it exists. "Best DJ" isn't proven until Selecta wins it on bad-transition rate.
