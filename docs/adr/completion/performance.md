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
