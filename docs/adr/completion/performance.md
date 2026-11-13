# Performance budgets, method and measured results

## Budgets

| Measure | Budget | Why |
|---|---|---|
| Interaction to Next Paint (p75, lab) | ≤ 200 ms | web.dev "good" threshold |
| Cumulative Layout Shift while loading | ≤ 0.1 | web.dev "good" threshold |
| Long tasks during playback | none over 200 ms caused by UI work | protects input; audio runs on its own thread |
| Library search at 20,000 songs (server) | p95 ≤ 500 ms per query | type-ahead stays usable |
| Library first page at 20,000 songs (server) | ≤ 500 ms | page opens without a stall |
| Visualizer | ≤ 15 frames per second while playing; 0 when hidden, paused or Still | power and battery |
| Polling | none while the tab is hidden; refresh on return | power, server load |

Budgets are lab targets on the machines below, not field percentiles.

## Method

- Server timings: `tests/scale_server.py` builds a 20,000-song library; the timing test measures
  `/api/library` pages and searches with the real relevance function.
- Browser timings: Playwright in Edge records long tasks (`PerformanceObserver('longtask')`), layout
  shift and interaction delays on the 100-song editor and the 64-cell Studio fixtures.
- Each result names the machine, commit and run, and is a lab result.

### Responsiveness budgets (P0136, SF-0235-02)

One set of measurement code serves both programmes and the MP-0298-06 lab check:
`web/e2e/perf-probe.ts` installs the observers before any page script runs (Event Timing with
`interactionId`, Layout Instability, largest contentful paint, and an in-page input-to-next-paint
time), and `web/e2e/vitals.ts` does the arithmetic, unit tested in `web/e2e/vitals.test.ts`:

- **INP:** Event Timing entries are grouped by `interactionId` and each interaction counts once, at its
  longest entry. With fewer than 50 interactions INP is the slowest; with more, one slowest is set
  aside per 50 (the Web Vitals 98th percentile rule). Entries under 16 ms are not reported by the
  browser and are inside budget by definition; the reading also counts every input the page saw, so
  a 0 ms INP is never mistaken for an untouched page.
- **CLS:** layout shifts without recent input, grouped into session windows (gap under 1 s, window at
  most 5 s); CLS is the largest window.
- **LCP:** the latest largest-contentful-paint candidate before the first input.
- **Procedure:** `web/e2e/p0136-responsiveness.e2e.ts` loads Listen, Library, the editor, My mixes,
  Discover and Workshop fresh at 1440x900, opens and closes the command palette, presses Tab three
  times and does the surface's own action (Play and Pause; typing a search; Move up and Undo), then
  writes `p0136-lab-vitals.json` with the budgets, the machine line and one reading per surface.

**Lab versus field.** Every number above is a lab reading: one machine, one synthetic run, the
made-up library from `tests/e2e_server.py`. A field p75 needs real-user monitoring across many
visits; Selecta is a local app and sends no telemetry, so it has no field percentiles and none are
reported. The JSON report's `kind` field says this, and a lab pass is never written up as a field
result. The 200 ms INP and 0.1 CLS budgets are the web.dev "good" thresholds, used here as lab
targets.

## Machines

| Name | CPU | Memory | GPU | OS / browser |
|---|---|---|---|---|
| Owner’s PC | Intel i7-10510U, 4 cores | not recorded | integrated, not used | Windows 11, Edge |
| CI Windows runner | GitHub `windows-latest`, 4 vCPU | 16 GB | none | Windows Server, Edge |
| CI Ubuntu runner | GitHub `ubuntu-latest`, 4 vCPU | 16 GB | none | build and unit tests only |

## Measured results

Filled in from the CI run of this PR's final commit (see the PR description). Hardware-specific
measurements on the owner's PC (audio dropout under load, low-power device behaviour) stay on
[needs-a-person.md](needs-a-person.md).

## Pagination versus virtualization

The Library pages 100 rows at a time with a stable cursor and keeps earlier pages in the DOM. At
20,000 songs nobody scrolls all of them; search and filters narrow first. Virtualization was not
adopted because it breaks find-in-page, screen-reader browsing and focus restoration; the timing
test guards the decision, and it is revisited only if the budget above is missed.

## Route splits (S3-0073-06)

The editor (with the transition inspector and Studio), My Mixes, Discover and Workspace load as
their own chunks through `web/src/routeChunks.ts` (React.lazy, one Suspense boundary inside the
page Section in `web/src/App.tsx`), and are fetched while the browser is idle after the first
paint. Make a Mix, Listen, Library, the player (`web/src/player.ts`) and the audio owner
(`web/src/audio/focus.ts`, `mediaSession.ts`) stay in the entry chunk, so seam scheduling never
waits on a page download and is unchanged.

Build-size report, `node scripts/bundle-report.mjs dist-after dist-before` from `web/`
(vite 8.3.7 production builds of the same working tree, 2026-11-12):

| Build | First download (raw) | First download (gzip) | Entry chunk (raw) |
|---|---|---|---|
| Before the split | 693.7 kB | 213.5 kB | 663.1 kB |
| After the split | 537.1 kB | 169.0 kB | 442.6 kB |

That is 156.7 kB (gzip 44.5 kB) less to download, parse and run before the first page. Loaded
later: Mix 94.0 kB, Workshop 47.6 kB, Links 18.7 kB, MyMixes 3.4 kB. The report fails if the
player's own strings are not in the entry chunk; it printed "player code in the entry chunk: yes"
for both builds.
