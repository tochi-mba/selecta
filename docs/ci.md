# CI: faster without cutting corners

The required [test workflow](../.github/workflows/test.yml) runs on every PR
and on main/build/v1 pushes. New commits cancel obsolete PR runs, not other PRs
or main runs.

## Parallel jobs

| Job | Execution | Required proof |
|---|---|---|
| Python shards 1/2 and 2/2 | Separate Windows runners, Python 3.12, FFmpeg | Locked dependencies, Ruff, 1,000-line rule, complete distributed pytest collection |
| Web | Ubuntu, Node 22, pnpm 10 | Frozen dependencies, all unit tests, TypeScript, production build |
| Edge shards 1/2 and 2/2 | Separate Windows runners, real muted Edge and FFmpeg | All Playwright E2E tests, real audio, accessibility checks, error recovery |
| verify | Ubuntu | Every prerequisite succeeded **and** combined Python coverage reached at least 70% |

A failed, skipped, missing, or cancelled prerequisite fails the final verify gate.
There are no paths-ignore shortcuts, no continue-on-error and no removed tests.

## Python: sharded execution with whole-suite coverage

Historically the full Python suite required around 18 minutes on one Windows
runner. Every collected test node ID, including each parametrized instance, is
assigned deterministically using SHA-256 to exactly one of two isolated
runners. The helper is tested for exhaustive and disjoint partitioning. Slow
tests remain opt-in as before; standard tests run once across the two shards.

Each runner uploads its actual coverage data with relative source paths, not
its percentage. The Ubuntu verifier combines **both** files and runs
`coverage report --fail-under=70`. It only does so if all Python shards
succeeded. If a coverage artifact is missing, combining/reporting fails.
The per-shard `--cov-fail-under=0` is deliberate: the 70% threshold is
enforced on the **aggregate**, exactly as it was for the original full run.
Locally, without SELECTA_TEST_SHARD, all Python tests still run unchanged.

## Edge: real-browser tests, isolated and balanced

Playwright uses `fullyParallel` only for balanced *assignment by test* to
each shard. `workers=1` still serializes tests within each Windows runner,
so its mutable fixture library and server cannot be accessed by concurrent
test workers. Each runner has its own database and local port 8799.
The per-page tests explicitly reset their mix before every test so they do
not depend on file order. Existing retries, screenshots and traces on failure
are retained with separate artifact names.

Both Python and Edge use the locked Python environment and FFmpeg; Edge
builds and runs the real production web app. No audio, security, API,
accessibility or recovery checks have been disabled.

## Caches and measurement

UV and pnpm caches accelerate dependency downloads while lockfiles stay
authoritative. Cached build outputs, virtual environments and node_modules
are **not** shared across commits. Web checks run on fast Linux, while
platform-specific Python/Edge checks stay on Windows. These optimizations
target wall-clock latency, not necessarily fewer billable runner-minutes.

Only completed and comparable full runs demonstrate a real speedup. Do not
raise Playwright workers above one without per-worker database isolation.

To reproduce the full gate locally, run:

```sh
uv sync --locked
uv run ruff check .
uv run pytest tests/test_file_length.py -q
uv run pytest --cov=selecta --cov-report=term-missing --cov-fail-under=70
cd web
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm e2e
```

Edge and FFmpeg must be available for the local browser run.
