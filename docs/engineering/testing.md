# Testing

What to test, how to run it, and what CI demands. The full catalogue of cloud test cases, module by module, is the [test plan](../saas/18-test-plan.md).

## Running tests

Run the files you touched; let CI run everything (the whole Python suite takes over ten minutes).

```bash
.venv/Scripts/python.exe -m pytest tests/test_cloud_work.py -q
```

With coverage for the package you changed:

```bash
.venv/Scripts/python.exe -m pytest tests/test_cloud_work.py -q --cov=selecta.work --cov-branch --cov-report=term-missing
```

Web: `pnpm test` (Vitest), `pnpm e2e` (Playwright on Edge, muted), `pnpm e2e:flags` (every page with each flag off).

Tests marked `slow` load audio models and are skipped unless you pass `--slow`.

## Cloud tests: both databases

Cloud store tests use the shared fixtures in `tests/cloud_db.py` (registered in `conftest.py`):

| Fixture | Gives you |
|---|---|
| `cloud_engine` | A database at the newest schema, built by the real migrations. Runs on SQLite, and again on PostgreSQL when `SELECTA_TEST_POSTGRES_URL` is set (always in CI), each run in its own schema |
| `sqlite_engine` | SQLite only |
| `postgres_engine` | PostgreSQL only; skipped without a server. Use it for row locks, `SKIP LOCKED`, `LISTEN/NOTIFY`, advisory locks, row-level security and race tests |
| `clock` | Freezes SQLite database time; `clock.advance(seconds)` moves it |

`tests/cloud_helpers.py` builds the cloud app over a migrated database (`make_cloud_app(tmp_path)`), with `FakeVerifier` standing in for AuthKit.

To run the PostgreSQL half locally, point it at a disposable database:

```bash
SELECTA_TEST_POSTGRES_URL=postgresql+psycopg://user:pass@localhost:5432/selecta_test .venv/Scripts/python.exe -m pytest tests/test_cloud_work.py -q
```

## Rules for good tests here

- **Name the rule** the test proves: `test_a_stale_fencing_token_cannot_publish`.
- **Deterministic:** no real sleeps for timing logic (use `clock`), seeded randomness, no network (`httpx.MockTransport` and fakes).
- **Properties for invariants:** use Hypothesis for "for all inputs" rules (fairness, never granting beyond a plan, round-robin ordering), and `RuleBasedStateMachine` for long random sequences (the job lifecycle). Profiles: `dev` (50 examples), `ci` (300), `nightly` (5,000), chosen by `HYPOTHESIS_PROFILE`.
- **Real migrations, not `create_all`**, so every run also tests the schema.
- **Every bug gets a regression test** before the fix.
- **Never weaken a test to make it pass.** If the test is wrong, say why in the commit.

## What CI checks

Four workflows live in `.github/workflows/`. `test.yml` runs on every pull request and every push to `main`; its `verify` job passes only when every other job passed, so it's the one check to require before merging.

| Job (`test.yml`) | Runs | Starts after |
|---|---|---|
| Workflows (Linux) | actionlint and shellcheck over every workflow file | |
| Lint (Linux) | Ruff, the file-length rule, and no live credential in any tracked file | |
| Checklist evidence (Linux) | No ticked checklist box without `Evidence:` | |
| Web (Linux) | Vitest and the production build | |
| Cloud / PostgreSQL (Linux) | Cloud tests on SQLite and PostgreSQL, branch coverage, the coverage gate | Lint |
| Python shards (Windows) | Every test on SQLite, 70% repository coverage | Lint |
| Edge E2E and Flags (Windows) | Playwright on Edge, and the flag reflow sweep | Lint, Web |

| Workflow | When | Runs |
|---|---|---|
| `nightly.yml` | Every night; Sundays; by hand | `pip-audit` and `pnpm audit` nightly; the cloud tests with Hypothesis at 5,000 examples on PostgreSQL on Sundays |
| `codeql.yml` | Pull requests and pushes to `main` | CodeQL security queries over Python and TypeScript |
| `dependabot.yml` | Monthly | One grouped update pull request each for actions, Python and web dependencies |

Every action is pinned to a full commit (the version is in a comment beside it) and Dependabot moves the pins. Every job has a time limit, no job keeps the checkout's token, and every workflow reads the repository only.

### When the repository goes private

The workflows already adjust themselves; this is what changes and what to do.

- **Minutes are billed**, Windows at twice the Linux rate, and a full `test.yml` run is about two hours of Windows time (six Windows jobs). That's why the Linux jobs gate the Windows ones, and why a new push to a pull request cancels the run it supersedes once the repository is private (`cancel-in-progress` reads `github.event.repository.private`). Runs on `main` and manual runs always finish. Push work in progress to a branch without a pull request, or as a draft you don't mind cancelling, and keep an eye on the monthly minutes in the billing settings.
- **CodeQL stops**: code scanning on private repositories needs GitHub Code Security, so `codeql.yml` skips itself. Ruff's security rules, the tenant isolation matrix and the secret checks keep running in `test.yml`.
- **GitHub secret scanning and push protection stop** unless you buy Secret Protection. `tests/test_no_committed_secrets.py` still fails any pull request that adds a live credential, but it can't block a push the way push protection does.
- **Artifacts count against a storage quota**, so screenshots keep 7 days and coverage 3 to 14.
- **Branch protection and rulesets on private repositories need a paid plan.** Without them, `verify` still reports, but nothing stops a merge while it's red.
- **Dependabot keeps working** (alerts and security updates are free on private repositories); its update pull requests each run `test.yml`, which is why they're grouped monthly.

**The coverage gate** (`tests/coverage_gate.py`): every cloud package needs 95% of lines and 90% of branches, and each critical module (scheduling policy, job claim and complete, quotas, flag decisions, authorization checks, delayed actions, tokens, Stripe signatures and snapshots, SigV4, uploads, room codes and requests, the playback lease) needs 100% of both. Run it on your own coverage report:

```bash
.venv/Scripts/python.exe -m pytest tests/test_cloud_*.py -q --cov=selecta --cov-branch --cov-report=json:cov.json
.venv/Scripts/python.exe tests/coverage_gate.py cov.json
```
