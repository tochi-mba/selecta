# Selecta 3.1 - measurements

What was measured while finishing PR #25, on one PC, and how to measure it again. These are lab numbers from a synthetic library. They aren't field data, they aren't approved budgets, and none of them says how anything sounds.

## The machine

| | |
|---|---|
| Date | 2026-11-07 |
| CPU | Intel Core i7-10510U, 4 cores, 8 threads (the owner's everyday PC) |
| Memory | 31.8 GB, about 20 GB free during the runs |
| System | Windows 11 Pro 10.0.26300 |
| Browser | Microsoft Edge 156.0.4314.58, headless, muted |
| Build | Production (`pnpm build`), served by the Selecta server |
| Background | The test server's own render worker, with 99 transitions queued, during the editor and Studio runs |

## Scale

`web/bench/scale.bench.ts` against `tests/scale_server.py`: 20,002 songs in the Library and 100 in the current mix. The extra songs are copies of synthesized rows, so this measures the database, the server and the page, not decoding real music. Run it with:

```bash
cd web && pnpm build && pnpm exec playwright test --config bench/playwright.config.ts
```

| Page | Measure | Result |
|---|---|---|
| Library, 20,000 songs | First rows on screen | 1.5 s |
| | Search, from typing to new results (includes the deliberate 320 ms wait for typing to stop) | 0.41 to 0.56 s |
| | Filter | 0.24 s |
| | Show more songs, 100 at a time | 0.41 s median, 0.99 s worst, to 1,100 rows |
| | Scrolling, frame time | 18 ms median, 37 ms at the 95th percentile |
| | Longest task, slowest input | 79 ms, 56 ms |
| | Layout shift | 0.075 |
| | Page size at 1,100 rows | 22,162 elements, 38 MB of JavaScript heap |
| Editor, 100 songs, rendering | First rows on screen | 1.0 s |
| | Moving a song down | 0.32 s median, 0.35 s worst |
| | Scrolling, frame time | 17 ms median, 18 ms at the 95th percentile |
| | Longest task, slowest input | 80 ms, 120 ms |
| Studio, full grid | Squares | 64 (two songs, four parts, eight squares) |
| | Tap to pressed | 95 ms median, 125 ms worst |
| | Longest task | 157 ms |

Two runs were made. The second is shown; the first was within about 25 percent of it on every row, with the Library slower while the PC was also running the owner's real stem separation.

## Pages while the server is slow

`web/e2e/finishing.e2e.ts`, "pages hold their shape while they load": every answer delayed by 350 ms, then the layout shift on each page.

| Page | Shift | Page | Shift |
|---|---|---|---|
| /listen | 0.030 | /workshop | 0.071 |
| /mixes | 0.005 | /workshop/analysis | 0 |
| /mixes/mine | 0 | /workshop/storage | 0 |
| /mix/current/edit | 0.057 | /workshop/sources | 0.022 |
| /library | 0 | /workshop/learning | 0.012 |
| /discover | 0 | /workshop/diagnostics | 0 |
| /discover/harmonic | 0 | /listening | 0.012 |

The test fails above 0.25.

## A saved FLAC, decoded

`web/e2e/finishing.e2e.ts`, "a saved file has the songs of the mix at the moment it was saved", with `tests/check_export_audio.py`. The mix was changed and the page reloaded while the export ran.

| | |
|---|---|
| Format | FLAC, 16-bit, 44,100 Hz, 2 channels |
| Length | 240.5 s, matching the job's own record |
| Each of the 4 songs found in the file | correlation 1.000 for each, in the order of the mix when it was saved |
| A song that isn't in the mix | 0.51, which shows the check can tell songs apart |

## Rolling back

`tests/rollback_check.py` with the 3.0 merge (`3b01dc1`) checked out beside this one. A home made by this build, with a draft, a steering choice, a chosen seam move, a tempo correction and a finished export's record, read by this build, then by 3.0 in its own process, then by this build again: identical all three times.

```bash
git worktree add ../selecta-3.0 3b01dc1336aab0f1cb0a4d85be5eba359de81831
python tests/rollback_check.py ../selecta-3.0
```

## Not measured

Audio timing while a render runs, a real 20,000-song library of real files, an installed app, a real phone, and anything with a screen reader. Budgets are for the owner to set from these numbers.
