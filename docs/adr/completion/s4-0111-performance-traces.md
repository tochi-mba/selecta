# S4-0111-05, -06 and -07: lab performance traces (2026-11-12)

Bench: `web/bench/s4-0111-scale.bench.ts`, run with
`pnpm exec playwright test --config bench/playwright.config.ts s4-0111` against
`tests/scale_server.py 9483 20000 100` (20,001 songs, 100 in the mix), production build `web/dist-rb`.
Machine: shared 4-core Intel i7-10510U laptop, no GPU (integrated Intel UHD, headless, muted),
Windows 11, Edge 157.0.4341.46, with other agents' test runs on the same machine. One run each. These
are lab numbers, not the hardware- and version-controlled traces a person records on a named,
otherwise idle machine, and they say nothing about how anything sounds.

Budgets were written in the bench before it ran: interactions painted within 200 ms, no long task over
200 ms while typing, paging, moving or toggling, search settled within 1.5 s, a refresh at depth showing
rows within 3 s, JS heap under 200 MB after 1,000 Library rows, p95 frame at most 50 ms.

## S4-0111-05: 20,000-song Library (1 run, failed on 2 of 7 budgets)

| Reading | Value | Budget |
|---|---|---|
| Slowest keystroke painted / Event Timing | 16.1 ms / 24 ms | 200 ms |
| Search for "golden" settled after the last key (2,499 matches) | 4,253 ms | 1,500 ms (missed) |
| Ready filter press painted | 46.6 ms (result shown after 4,849 ms) | 200 ms |
| Slowest Enter on Show more, 1,000 rows loaded | 40.2 ms paint; long tasks 86 to 188 ms | 200 ms |
| Scroll over 1,000 rows, p95 frame | 50 ms, no long task | 50 ms |
| Refresh at `/library?q=golden`, first rows | 4,799 ms, search kept | 3,000 ms (missed) |
| JS heap: opened / 1,000 rows / after refresh | 5.8 / 29.5 / 31.2 MB | 200 MB |
| DOM nodes: opened / 1,000 rows | 4,139 / 38,296 | - |

Input stays responsive and memory is far under budget; the waits are the server answering a 20,000-row
search on a loaded machine, as MI-0162-04 also found (docs/adr/selecta-microinteraction-performance-results.md).

## S4-0111-06: 100-song Editor (1 run, passed)

| Reading | Value | Budget |
|---|---|---|
| Open 100 songs | 4,903 ms | 5,000 ms |
| Selection (4 clicks and an Enter) slowest paint / Event Timing | 152.4 ms / 192 ms (pointerdown) | 200 ms |
| Keyboard reorder, 6 moves, focus kept on the moved song | 130 ms paint / 160 ms Event Timing, no long task | 200 ms |
| Scroll p95 frame | 50 ms; long tasks 50 to 53 ms | 50 ms |
| JS heap opened / after | 6.7 / 10.1 MB | - |

## S4-0111-07: 64-cell Studio during analysis and a render (1 run, passed)

| Reading | Value | Budget |
|---|---|---|
| Server work | `POST /api/analysis/start` 200, `POST /api/mix/render` 200 | - |
| 16 Space toggles, slowest paint / Event Timing | 26.5 ms / 128 ms, no long task | 200 ms |
| Frames while the server worked, p95 / worst | 16.7 / 16.8 ms | 50 ms |
| JS heap at open / after toggles | 12 / 31.3 MB | - |
| Main player | started on Listen before the Studio; it plays through Web Audio, so the bench found no media element to time and measured no dropout | needs a person |

The Studio stems are stand-ins served by the bench (splitting needs the big model), as in MI-0162-05.
