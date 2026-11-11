# Selecta microinteraction performance results (ADR-0162)

Measured results for MI-0162-02, -03, -04 and -05, published under MI-0162-08: machine, commit, exact
command, raw numbers, budgets, pass or fail, where the output is, and what the numbers do not show.
These are lab numbers from one shared laptop, taken by the agent that wrote the specs. They are not
field data, not an independent measurement and not a release sign-off. No benchmark here is claimed to
pass without the machine, SHA, output and limitations next to it.

## Machine (all rows)

Recorded with the fields of the reference hardware matrix in
[selecta-microinteraction-verification-protocols.md](selecta-microinteraction-verification-protocols.md)
(MI-0162-01). This laptop is not a named tier of that matrix; treat it as an unranked lab machine.

| Field | Value |
|---|---|
| CPU / cores | Intel Core i7-10510U @ 1.80 GHz, 4 cores / 8 threads |
| GPU + driver | Intel UHD Graphics (integrated), driver 31.0.101.2137; no discrete GPU; Edge ran headless |
| RAM | 31.8 GB |
| Storage | Samsung MZVLB512HBJQ NVMe SSD |
| OS / build | Windows 11 Pro 10.0.26300 (build 26300) |
| Browser / build | Microsoft Edge 157.0.4341.42, headless, via Playwright 1.56.1, `--mute-audio` |
| Display / scale | headless viewport (1440 x 900 for the e2e spec, 1366 x 768 for the bench), device scale 1 |
| Power mode | plugged in (AC), Windows "Balanced" scheme |
| Audio device / buffer | none audible: headless Edge with `--mute-audio`; AudioContext facts are in the MI-0162-03 row |
| Load from others | shared: about 25 other agents ran builds, pytest and Playwright on the same 4 cores at the same time |
| Cache | each run starts a fresh server and browser profile (cold browser cache, warm OS file cache) |
| DevTools recording | none: PerformanceObserver and requestAnimationFrame in the page, no trace recording overhead |

## Commit

- `git rev-parse HEAD`: `a71e19032b8a9280baa4e6a27e5f764555e9e6ef` (merge of PR #51), on branch
  `feat/finish-checklists`.
- The working tree had uncommitted changes from other agents working at the same time, and the two
  spec files below were new or changed and not yet committed when measured. The site was built from that
  working tree with `pnpm exec vite build --outDir dist-ci-mi-b --emptyOutDir`.

RESULTS-PENDING
