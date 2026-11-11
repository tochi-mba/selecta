# Selecta microinteraction performance results (ADR-0162)

Measured results for MI-0162-02, -03, -04 and -05, published under MI-0162-08: machine, commit, exact
command, raw numbers, budgets, pass or fail, where the output is, and what the numbers do not show.
These are lab numbers from one shared laptop, taken on 2026-11-11 by the agent that wrote the specs.
They are not field data, not an independent measurement and not a release sign-off. Nothing here is
claimed to pass without the machine, SHA, output and limitations next to it.

## Machine (all rows)

Recorded with the fields of the reference hardware matrix in
[selecta-microinteraction-verification-protocols.md](selecta-microinteraction-verification-protocols.md)
(MI-0162-01). This laptop is not a named tier of that matrix; treat it as an unranked lab machine.

| Field | Value |
|---|---|
| CPU / cores | Intel Core i7-10510U @ 1.80 GHz, 4 cores / 8 threads |
| GPU + driver | Intel UHD Graphics (integrated), driver 31.0.101.2137; no discrete GPU; Edge ran headless, so compositing and raster were in software |
| RAM | 31.8 GB |
| Storage | Samsung MZVLB512HBJQ NVMe SSD |
| OS / build | Windows 11 Pro 10.0.26300 (build 26300) |
| Browser / build | Microsoft Edge 157.0.4341.42 (from the browser's client hints), headless, Playwright 1.56.1, `--mute-audio` |
| Display / scale | headless viewport, device scale 1: 1440 x 900 (e2e spec), 1366 x 768 (bench) |
| Power mode | plugged in (AC), Windows "Balanced" plan |
| Audio device / buffer | nothing audible: headless Edge with `--mute-audio`; AudioContext facts are in the MI-0162-03 row |
| Load from others | heavy and uncontrolled: about 25 other agents ran builds, pytest and Playwright on the same 4 cores at the same time; waiting for one of the two shared browser-test slots took from under 2 minutes to over 2.5 hours |
| Cache | every run starts a fresh server, database and browser profile (cold browser cache, warm OS file cache) |
| Recording overhead | no DevTools trace; PerformanceObserver (longtask, long-animation-frame, event, resource) and requestAnimationFrame inside the page |
| Theme / motion | system theme (light in headless); motion as stated per row |

## Commit and build

- Site built once from the shared working tree with `cd web && pnpm exec vite build --outDir dist-ci-mi-b --emptyOutDir`
  when `git rev-parse HEAD` was `6112174e99575e5ae871d25db5de831e7d478c65` (branch `feat/finish-checklists`).
  The tree had uncommitted changes from other agents; the dist is that snapshot, not exactly any commit.
  HEAD moved on (to `67ad9303e17d351954aad8f25bff6c9505afdd53` and later) while the runs waited, but the
  served dist did not change.
- An earlier build from the same morning caught another agent's half-finished edit
  (`ReferenceError: savedRequestCount is not defined` at start-up, page stuck on "Starting Selecta"), so the
  first bench attempt measured nothing. It was rebuilt, checked in a browser, and only later runs are reported.
- Spec files: `web/e2e/perf-probe.ts` (shared probe), `web/e2e/mi-0162-performance.e2e.ts` (MI-0162-02, -03),
  `web/bench/mi-0162-scale.bench.ts` (MI-0162-04, -05).

## How it is measured

- **Frames:** `requestAnimationFrame` intervals over a fixed 3,000 ms window (first interval dropped);
  p50, p95 and worst. Headless Edge paints at 60 Hz, so intervals come in steps of 16.7 ms: 33.3 ms is two
  refreshes, 50.0 to 50.2 ms is three.
- **Long tasks:** `PerformanceObserver('longtask')` entries that start inside the window, plus
  `long-animation-frame` entries with the scripts the browser blames, and the API responses that finished
  inside the window, to tie each long task to its cause.
- **Interaction (INP-like):** two numbers per action. Event Timing (`type: 'event'`, threshold 16 ms; the
  data INP is built from) and an in-page input-to-next-paint time (event time stamp to a task queued after
  the next animation frame). Neither is field INP; both are lab single-interaction latencies.
- **Wall times** (first rows, search, filter, pages, moves) are measured by the test runner from the action
  to the visible result, so they include the local server, SQLite and the browser.

## Budgets

The budgets were written into the specs before the first measurement and were not changed afterwards.

| Measure | Lab budget asserted | Release threshold (MI-0164-06), reported only |
|---|---|---|
| p95 frame in a window | ≤ 50 ms | ≤ 32 ms |
| Long task with nobody touching the page | none over 200 ms | none over 50 ms during interaction; Library none over 100 ms from rendering the loaded page |
| Single interaction (Event Timing and next paint) | ≤ 200 ms | p75 INP ≤ 200 ms |
| Animated vs still slowest interaction (MI-0162-02) | at most 100 ms slower | not defined |
| Library first rows / search settled / filter / 100 more rows | ≤ 3,000 / 1,500 / 1,500 / 1,500 ms | "usable" |
| 100-song draft opened / keyboard move with focus kept | ≤ 5,000 / 1,500 ms | reorder within the INP target, focus kept |
| Seam schedule (MI-0162-03) | cue, stop and next start within 1 ms of the plan; scheduled ahead | no unexpected gap or overlap |

## MI-0162-02: main thread and frame costs on the animated surfaces

Command (from `web/`, inside the slot lock):

```
SELECTA_PYTHON=<repo>\.venv\Scripts\python.exe SELECTA_E2E_DIST=dist-ci-mi-b SELECTA_E2E_PORT=9135 \
  pnpm exec playwright test e2e/mi-0162-performance.e2e.ts -g MI-0162-02 --output test-results-ci-mi-b
```

Fixture: the made-up 12-song library of `tests/e2e_server.py`, mix of songs 1 to 4, Morning Light playing
(muted) with its synced lyrics throughout, and a Lucy conversation planned by the built-in planner (no AI
service). Test `MI-0162-02 animated surfaces stay inside long-task, frame and interaction budgets`. Each
surface is opened through the app's own router (the music keeps playing), left alone for a 3,000 ms window,
then used: Listen (Pause, Resume), Stage (Pause, Resume, `f` to leave), Make a Mix (open and close a card's
disclosure, three Tabs), Editor (Change, Studio tab), Studio (four squares toggled on and back off, four
arrow keys), Lucy (Show less, Show all, type "calm" in the composer and clear it). It runs twice: **still**
(OS reduced motion and the Still preference) as the baseline, then **animated** (no reduced motion and the
Expressive preference). Budgets are asserted on the animated pass.

Run A, 2026-11-11 (it overlapped with a run of MI-0162-03 on the same machine, which held a busy loop and a
render): **1 passed**.

| Surface (animated pass) | Frames in 3 s | p50 / p95 / worst frame | Long tasks in the window | Running CSS animations | Slowest Event Timing | Slowest next paint | Still baseline: p95 frame, slowest Event Timing / next paint |
|---|---|---|---|---|---|---|---|
| Listen (playing, lyrics, visualizer) | 180 | 16.7 / 16.8 / 19.1 ms | none | 1 | 72 ms (pointerdown, Resume) | 23.1 ms | 16.8 ms, 48 / 14.6 ms |
| Stage (fullscreen lyrics and visuals) | 180 | 16.7 / 16.8 / 17.8 ms | none | 1 | 144 ms (keyup, `f`) | 12.0 ms | 16.8 ms, 152 / 118.2 ms |
| Make a Mix cards | 181 | 16.7 / 16.8 / 17.0 ms | none | 0 | 48 ms (pointerdown, card disclosure) | 29.2 ms | 16.8 ms, 144 / 19.8 ms |
| Editor timeline | 180 | 16.7 / 16.8 / 33.2 ms | none | 0 | 72 ms (pointerdown, Close) | 40.0 ms | 16.8 ms, **216** / 44.5 ms |
| Studio grid (64 cells) | 181 | 16.7 / 16.8 / 16.8 ms | none | 0 | 48 ms (pointerdown, a square) | 24.8 ms | 16.7 ms, 32 / 22.4 ms |
| Lucy activity cards | 181 | 16.7 / 16.8 / 17.0 ms | none | 0 | 48 ms (keydown, composer) | 22.7 ms | 16.8 ms, 32 / 18.6 ms |

- Budgets on the animated pass: p95 frame ≤ 50 ms (worst seen 16.8), no long task over 200 ms in a window
  (none at all), every interaction ≤ 200 ms (worst 144 ms Event Timing, 40 ms next paint): **pass**.
  Against the 32 ms release threshold the p95 frames also pass.
- Animation versus still: the slowest animated interaction (144 ms) was not slower than the slowest still
  one (216 ms), so no regression was seen (budget: at most 100 ms slower). The still pass's 216 ms Editor
  Event Timing is over 200 ms but is the baseline, which is not asserted; it came with no long task and a
  44.5 ms next paint, so it is presentation delay under load.
- Long tasks during interactions (not in the quiet windows): 82 ms (animated) and 98 ms (still), both when
  entering the Stage.
- Running animations were counted with `document.getAnimations()`: only Listen and Stage had one running
  in the quiet window. The visualizer is a canvas drawn from `requestAnimationFrame`, which that count does
  not include. Make a Mix, Editor, Studio and Lucy had finished their entrance motion within the 300 ms
  before the window, so their windows show the cost of the page at rest with music playing, and their
  motion cost shows in the interaction numbers.

Run B, 2026-11-11, on its own (no other run of these specs at the same time): **1 passed**. Every surface,
both passes: 172 to 181 frames in 3 s, p50 16.7 ms, p95 16.8 or 16.9 ms, worst 19.7 ms, and no long task
in any quiet window. Animated pass: slowest Event Timing 136 ms (the `f` key entering the Stage), slowest
next paint 105.2 ms (same key), a long task of 81 ms during that key; every other surface's slowest
interaction was 72 ms Event Timing or less (Editor Change 72, Make a Mix 48, Studio 48, Listen 48,
Lucy 40). Still pass: slowest Event Timing 200 ms (the Editor Change click, again with a 38.8 ms next paint
and no long task), so animation was again not slower than still.

## MI-0162-03: audio scheduling under load (automatable part)

Command (from `web/`, inside the slot lock):

```
SELECTA_PYTHON=<repo>\.venv\Scripts\python.exe SELECTA_E2E_DIST=dist-ci-mi-b SELECTA_E2E_PORT=9135 \
  pnpm exec playwright test e2e/mi-0162-performance.e2e.ts -g MI-0162-03 --output test-results-ci-mi-b
```

Test `MI-0162-03 a seam stays contiguous on the audio clock with a busy main thread, page changes and a
render going`. The page's `AudioBufferSourceNode.start` and `stop` are wrapped (without changing them) to
record, for every sound the player hands the Web Audio clock, when it was asked for, when it starts, where
in its buffer, its length and every stop time. Mix: Morning Light then Slow Tide, with their transition
rendered for real first. Then, all at once: Slow Tide's successor (Paper Moon) is added, which starts a
real background render on the server; the page's main thread is kept busy (a 70 ms busy loop every 100 ms
and a 250 ms task every second); "Jump to the transition" is pressed; and the listener goes to Library and
types "paper", opens a Make a Mix card, opens the Editor, and returns to Listen. The load stays on until
Slow Tide has played alone for 2 s past the crossfade.

Run, 2026-11-11: **1 passed** (7.7 minutes, most of it the first render).

| Reading | Value | Tolerance | Result |
|---|---|---|---|
| Clip start against Morning Light's planned cue (50.5 s into it) | 0 ms off | ≤ 1 ms | Pass |
| Morning Light stops after the clip starts (30 ms fade, then 20 ms at zero gain) | 50.0 ms | 50 ± 1 ms | Pass: no gap, no extra overlap |
| Slow Tide starts before the clip ends (the crossfade) | 30.0 ms | 30 ± 1 ms | Pass: no gap, no extra overlap |
| Slow Tide's start offset against the plan (52.07 s minus the 30 ms fade) | 0 ms off | ≤ 1 ms | Pass |
| Clip handed to the audio clock ahead of its start | 8,041 ms | > 0 | Pass |
| Slow Tide handed to the audio clock ahead of its start | 49,978 ms | > 0 | Pass |
| Audio clock seconds per wall-clock second over the whole window | 0.9992 | > 0.9 | Pass |
| Fallback fade notice ("That seam wasn't ready in time") | absent | absent | Pass |
| Main-thread load during the window: long tasks, total | 475 tasks, 42,760 ms | ≥ 10 tasks | load was real |
| Slowest interaction during the load (Event Timing or next paint) | 344.6 ms | not budgeted | expected under a deliberately busy thread |
| Background render of the next transition | queued at the jump, ready by the end | running during the window | yes |
| Sounds started after the jump | 5 (song, clip, next song, then the next transition once it rendered) | - | recorded |
| AudioContext | 44,100 Hz, base latency 10 ms, output latency 48 ms (headless, muted) | - | recorded |

What this shows: the player schedules each seam on the audio clock ahead of time, so a main thread busy
most of the time, page changes and a render on the server did not move the cue, open a gap or add
overlap beyond the designed 30 ms crossfade. What it does not show: what a sound card actually played.
`--mute-audio` headless Edge has no audible output, so a dropout in the audio thread itself under CPU
load, or a device-level glitch, cannot be seen here.

Earlier attempts on the same day timed out before measuring anything: waiting for four, then one,
transition render(s) with the shared 280 s helper. One render took about 4.5 minutes on the loaded laptop
(measured by hand against a fresh server), so the test now renders one transition and waits up to 9
minutes for it. The budgets did not change.

## MI-0162-04: a 20,000-song Library

Command (from `web/`, inside the slot lock):

```
SELECTA_PYTHON=<repo>\.venv\Scripts\python.exe SELECTA_E2E_DIST=dist-ci-mi-b SELECTA_SCALE_PORT=9136 \
  pnpm exec playwright test --config bench/playwright.config.ts mi-0162 --output test-results-ci-mi-b
```

Fixture: `tests/scale_server.py` with 20,000 songs and a 100-song current mix (20,002 rows: 20,001 music,
1 set aside; every extra song is a copy of one synthesized song's rows under an invented name). Test
`MI-0162-04 a 20,000-song library opens, searches, filters and scrolls deep within budget`, motion
default (subtle), nothing playing.

| Reading | Run A | Run B | Budget | Result |
|---|---|---|---|---|
| First 100 rows visible after `goto('/library')` | 3,430 ms | 3,116 ms | ≤ 3,000 | **Fail** both runs |
| Count shown | "of 20001 songs" | same | 20,000+ | Pass |
| Typing "golden" (6 keys, 120 ms apart): slowest key paint / Event Timing | 30.5 / 40 ms | 29.4 / 48 ms | ≤ 200 | Pass |
| Last key to narrowed count (2,499 matches) | 2,528 ms | 1,981 ms | ≤ 1,500 | **Fail** both runs |
| Filter "Ready" press to count | 898 ms | 1,352 ms | ≤ 1,500 | Pass |
| Filter press paint / Event Timing | 48.3 / 72 ms | 49.3 / 88 ms | ≤ 200 | Pass |
| 10 x "Show more songs" by Enter (to 1,100 rows): median / worst | 947 / 1,186 ms | 1,319 / 2,064 ms | ≤ 1,500 | Pass A, **fail** B |
| Enter paint / Event Timing, focus stayed on the button | 165.7 / 104 ms, yes | 97.2 / 96 ms, yes | ≤ 200 | Pass |
| Scrolling 1,100 rows at 400 px per frame for 3 s: frames, p50, p95, worst | 54, 33.4, 300, 400 ms | 45, 50, 316.6, 316.8 ms | p95 ≤ 50 | **Fail** both runs |
| Long tasks in that scroll window | 320, 261, 363 ms | 285, 286, 271 (+ six of 50 to 154) ms | none over 200 | **Fail** both runs |
| DOM nodes with 1,100 rows | 32,069 | 32,069 | - | recorded |

Why the failing budgets fail (from the breakdown the bench records):

- **First rows (3.1 to 3.4 s).** The page is interactive at about 0.76 s (DOMContentLoaded), but the
  Library's own request only starts at about 2.3 s: the app first waits for `/api/status` (about 0.5 s),
  then `/api/status` and `/api/mix` again (the 100-song mix answer takes about 0.75 s) and `/api/jobs`.
  `/api/library` itself then answers in about 0.56 s. The budget is missed by start-up requests running
  one after another on a loaded single-process server, not by the Library query.
- **Search settled (2.0 to 2.5 s).** In run B the request left 209 ms after the last key (the 200 ms
  debounce), and the server took 1,473 ms to answer `q=golden` over 20,001 songs with 2,499 matches; the
  rest is rendering. The server-side relevance search, under contention, is the cost.
- **Scrolling 1,100 loaded rows.** Each long task follows an API answer by a few milliseconds
  (`/api/mix` every 1.5 s while any transition is unrendered, `/api/status` every 4 s, the Library's own
  refresh), and the browser blames React's scheduler (`MessagePort.onmessage`, 286 ms) or a fetch handler
  (`Response.json.then`, 286 ms). The Library renders its rows inline, so every poll that changes app
  state re-renders all 1,100 rows (about 32,000 DOM nodes), costing 260 to 360 ms each time on this
  machine. Scrolling is not what costs; the polls landing during the scroll are. With only the first 100
  rows loaded this cost is roughly a tenth. Proposed fix (not made here, because `web/src/views/Library.tsx`
  is shared and was being edited by other agents): move a row into a memoized component with stable
  callbacks, so a poll that does not change a song's own facts does not re-render its row; or stop the
  1.5 s mix poll re-rendering the Library when nothing in the mix changed. The 400 px per frame scroll is
  deliberately fast; software raster with no GPU also keeps p50 at 33 to 50 ms.
- **100 more rows, worst 2,064 ms in run B** but 1,186 ms in run A: the same request and render under
  heavier load from other agents. Not reproducible as a code problem from these two runs.

## MI-0162-05: a 100-song draft and the 64-cell Studio

Same command and fixture as MI-0162-04 (the two tests share one server). Test
`MI-0162-05 a 100-song draft and the 64-cell Studio keep focus and stay quick`. The 100-song draft is
made through the API (`POST /api/drafts` with `copy_current: true` from the 100-song current mix), and the
current mix plays (muted) while the draft is edited. The Studio is the real 2 sides x 4 lanes x 8 squares
grid for transition 1; its session and stems are served by the test (each stem is a whole synthetic song),
because the server never splits stems in tests.

| Reading | Run A | Run B | Budget | Result |
|---|---|---|---|---|
| Draft editor opened to 100 rows (in-app navigation) | 1,984 ms | 2,028 ms | ≤ 5,000 | Pass |
| Long tasks while opening | 226, 70 ms | 222, 64 ms | recorded | over the 200 ms line once, during the open only |
| Scrolling the 100-song timeline at 300 px per frame: p50 / p95 / worst | 33.3 / 50.1 / 67 ms | 33.4 / 50.1 / 50.2 ms | p95 ≤ 50 | **Fail by 0.1 ms** both runs (three refreshes) |
| Long tasks while scrolling it | none | one of 52 ms | none over 200 | Pass |
| 5 keyboard moves from row 50 (ArrowUp/Down on the grip): wall time each | 982, 955, 1,035, 983, 1,446 ms | 1,513, 2,521, 1,497, 398, 1,531 ms | ≤ 1,500 | Pass A, **fail** B |
| Focus on the moved song's grip after every move, and the draft saved the move | yes | yes | always | Pass |
| Reorder key: slowest next paint / Event Timing | 113.8 / 136 ms | 45.3 / 56 ms | ≤ 200 | Pass |
| Studio grid rendered with 64 cells | 64 | 64 | 64 | Pass |
| Studio idle 3 s: p50 / p95 / worst frame, long tasks | 16.7 / 16.9 / 31.9 ms, none | 16.7 / 17.1 / 18.3 ms, none | p95 ≤ 50 | Pass |
| 19 grid keys (7 Right, 7 Down, Ctrl+Home, Ctrl+End, Home, Left to the lane name, Right): focus landed on the expected cell every time | yes | yes | always | Pass |
| Grid keys: next paint p50 / worst | 10.3 / 19.5 ms | 14.4 / 32.7 ms | ≤ 200 | Pass |
| Grid keys and Space toggles: slowest Event Timing | 176 ms | 288 ms (the click a Space press makes on a square) | ≤ 200 | Pass A, **fail** B |
| Space toggles: pressed state changed, focus stayed | 46, 170, 23 ms | 45, 43, 67 ms | recorded | Pass |
| Long tasks while moving round the grid | none | none | none over 200 | Pass |
| Opening the Studio (8 whole-song stand-in stems decoded) | 7,852 ms | 12,723 ms | not budgeted | not representative: real stems are short windows |

Why: the move time is a server round trip (each move saves the 100-song draft and answers with the whole
draft) under contention; the key press itself paints in under 120 ms and focus is never lost. The 50.1 ms
p95 is three 60 Hz refreshes in software compositing; the release threshold of 32 ms (two refreshes) is
not met either. The 288 ms Studio Event Timing in run B is not matched by the in-page next-paint time
(32.7 ms worst) or by any long task, so it is presentation delay in the headless software compositor at
that moment rather than script work; it is still a failed reading and is reported as one. While the current
mix plays, the player asks `/api/seams/<key>` about eight times a second for the next unrendered seam, which
adds server load during every MI-0162-05 reading (seen in the API timeline); that is worth a separate look.

## Not shown by these numbers

- One shared, overloaded laptop with no GPU, headless and muted. Other agents' builds and tests ran on the
  same cores, so the same budget can pass in one run and fail in the next; two runs are not a distribution.
- Synthetic data: invented titles, one song's analysis copied 20,000 times, stand-in Studio stems. A real
  library's search relevance, artwork and metadata spread are not represented.
- Not independent: the same agent wrote the budgets, the specs and this page.
- No captured audio. MI-0162-03 checks the times the player hands the Web Audio clock, not what comes out
  of a sound card under CPU load. A person must still capture real audio.
- No trace files were recorded (no DevTools tracing); the raw readings are the `MI-0162 {...}` JSON lines
  each spec prints, summarised above. Failure artifacts went to `web/test-results-ci-mi-b/` (git-ignored)
  and were deleted afterwards.

## Still needs a person

- MI-0162-02: a named reviewer's performance recording on the reference hardware tiers, not this laptop.
- MI-0162-03: captured real audio of a seam while a background render runs and the UI is used, on a real
  output device, listened to and checked for gaps or overlaps.
- MI-0162-04: the real-dataset benchmark (a real 20,000-song library) and a decision on the Library row
  re-render fix above.
- MI-0162-05: a person's keyboard and trace session on the reference hardware.
- MI-0162-08: the independent quality ledger entry; this page is the agent's own measurement.
