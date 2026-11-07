# CI: parallel checks without weakening acceptance

The required `test` workflow is in [`.github/workflows/test.yml`](../.github/workflows/test.yml).
It runs for PRs and pushes to `main` and `build/v1`. A new commit cancels
stale runs of the same PR, but **not** a different PR or the `main` push.

## What runs

| Job | Runner | Required work |
|---|---|---|
| Python | Windows, Python 3.12 | `uv sync --locked`, Ruff, the 1,000-line rule, the full Python suite with `--cov=selecta --cov-fail-under=70` |
| Web | Ubuntu, Node 22 / pnpm 10 | frozen-lockfile install, all Vitest tests, TypeScript check and production Vite build |
| Edge E2E (1/2) | Windows | locked Python environment, FFmpeg, frozen pnpm dependencies, production build, first Playwright shard in real muted Edge |
| Edge E2E (2/2) | Windows | the same, with the other Playwright shard |
| verify | Ubuntu | fails unless Python, Web **and both Edge shards** succeeded |

These jobs run in parallel; the final `verify` check is the single
conservative status gate for the PR and branch protection. A failed, cancelled
or skipped prerequisite does not turn into a green `verify`.

**No tests have been deleted, filtered, marked optional or assigned reduced
coverage.** Python and browser tests still run on Windows, including real
FFmpeg and the actual Edge browser. Web unit tests also run on Linux, with the
production build repeated on Windows for the browser integration checks.
Playwright keeps **one worker per shard**, because tests within a runner share
a mutable fixture library. Each Windows runner uses its own isolated server,
database and port, so the two shards can run simultaneously without sharing
state. Existing retry-on-CI behavior, failed-browser screenshots/traces,
and failure artifacts are retained, with a distinct artifact name per shard.

## Where the time is saved

1. Python tests no longer block web unit tests and the browser suite from
   starting. Errors in independent suites are visible at the same time.
2. The browser suite is split across two isolated runners, reducing its
   critical path while executing all test files. This uses more runner-minutes;
   it is a wall-clock optimization, not a claim of lower compute cost.
3. `setup-uv` caches Python downloads and `setup-node` caches the pnpm store.
   Lockfiles remain mandatory. We do not cache `node_modules`, virtual
   environments or previously built application artifacts across commits.
4. The lightweight Ubuntu runner performs the unit/build checks while Windows
   remains responsible for platform-specific behavior.
5. New pushes cancel obsolete runs. `main` builds are not accidentally
   cancelled by pull-request checks.

## Guardrails and follow-up measurements

- No `paths-ignore` rule: a documentation/config change still exercises all
  gates. No `continue-on-error` for tests and no blanket exclusion of flaky
  tests or accessibility cases.
- Changes to a mix, the audio engine, browser fixtures or server API still
  trigger the real end-to-end suite, with its cross-feature state checks.
- If the two shards are unbalanced, inspect Playwright test durations and
  consider `fullyParallel` **only after** establishing per-test database
  isolation; do not increase workers against one mutable server.
- Compare the durations of the four required job groups and the aggregate
  wall-clock time against prior runs. Report observed gains only after this
  workflow completes successfully. A cache hit is not itself evidence of a
  passing test.
- Future improvements could preinstall FFmpeg in a pinned runner image or
  reuse an attested web build artifact, but only after verifying the resulting
  runtime environment and actual performance. Avoid trading test fidelity for
  an unmeasured optimization.

To reproduce locally, run `uv sync --locked`, `uv run ruff check .`,
`uv run pytest tests/test_file_length.py -q`,
`uv run pytest --cov=selecta --cov-report=term-missing --cov-fail-under=70`,
then in `web/` run `pnpm install --frozen-lockfile`, `pnpm test`,
`pnpm build` and `pnpm e2e` with Edge and FFmpeg available.
