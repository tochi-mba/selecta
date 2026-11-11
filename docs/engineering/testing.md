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

### Cloud browser tests

`pnpm e2e:cloud` (from `web/`) runs every cloud browser test, `web/e2e-cloud/*.cloud.ts`, in one
Playwright project (`playwright.cloud.config.ts`) against one server on port 8812 (set
`SELECTA_CLOUD_E2E_PORT` to move it; never 8733, a running Selecta, or 8799, the local test
server). It first builds the web app into `web/dist-cloud-e2e` with `vite.cloud-e2e.config.ts`:
the real Cloud site, the Rooms guest page and display, and the test-only `cloud-harness.html`,
with AuthKit swapped for `web/e2e-cloud/fakeAuthKit.tsx`; and the same site with the real AuthKit
library into `web/dist-cloud-e2e-authkit` (`vite.cloud-e2e-authkit.config.ts`), which the server
serves at `http://localhost:<port>` for the sign-in redirect test (`sign-in.cloud.ts`: the test
routes the auth domain `https://auth.e2e.test` to the fake AuthKit in `tests/e2e_cloud_authkit.py`).
Then it starts
`tests/e2e_cloud_server.py`, the production Cloud API over a fresh schema and non-superuser role
on the test PostgreSQL when `SELECTA_TEST_POSTGRES_URL` is set (as CI does; use it locally too,
since on SQLite every tab's event stream contends for the one write lock), else a fresh migrated
SQLite file, with these stand-ins:

- sign-in: `e2e:<name>` signs in the listener `<name>` (each Cloud-site test makes its own, so
  tests never share a workspace); the bare tokens `alice` and `bob` (Premium) and `carol` (Free)
  are the Rooms and devices tests' people, made at start-up; no WorkOS;
- object storage: the in-memory R2 from the storage tests behind real `/fake-r2/...` URLs, which
  can be expired (403) and can fail chosen upload parts;
- Stripe: a fake Checkout and portal whose "payment" writes the entitlement snapshot after a delay;
- Rooms: a synthetic song library and planner, and quiet audio at `/e2e/audio/{index}.wav`.

Test controls are under `/test/...` and never exist outside this server. `/test/seed` takes a
`plan` (`free` by default, or `standard` or `premium` as an expiring override), and
`/test/flags/off {"user", "flags"}` switches features off for one test person with a real
per-user targeting rule (an empty list clears them); `/test/flags/reset {"flags"}` clears every
rule on those flags, for tests that change a flag for everyone (`tests/e2e_cloud_flags.py`).

**The Cloud flag sweep** (`web/e2e-cloud/flags.cloud.ts`, part of `pnpm e2e:cloud`; run it alone
with `pnpm e2e:cloud flags.cloud.ts`) holds the Cloud site to the local sweep's reflow contract.
For every non-core, targetable feature that names a `cloud.*` surface in the registry, a new Free
and a new Premium account (the Premium one with a room open) each have it switched off by rule,
and every page it's on is opened at 375 and 1280 px: nothing may stick out sideways, no container
or heading may be left empty, no word the registry gives the feature may show, no menu entry may
lead to a page that's gone, and no route the feature owns may be asked (nor anything refused).
It also runs everything off at once, the cloud defaults (lyric display off, SC-0406-03), a teaser
pass (a plan-locked feature shows with its plan; a rule-off one is hidden), and a live pass (a
feature switched off while its page is open closes up over `flags.changed`, without a reload). A
static check fails if a cloud-only feature names no cloud surface and isn't listed with a reason.
New Cloud pages go in the registry's `SURFACES` (`src/selecta/flags/__init__.py`) and the
sweep's `SURFACES` map. `web/e2e-cloud/admin-flags.cloud.ts` applies each Flags page action
(user, rollout, schedule, tier, kill switch, rollback) and checks history, alerts and the audit
log. On Windows, if `uv` isn't
on `PATH`, set `SELECTA_PYTHON` to the full path of the virtualenv's `python.exe`. CI runs the
suite on Linux in the `Cloud E2E` job.

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

No PostgreSQL or Docker? `pgserver` runs a real PostgreSQL 16 from a pip package, in its own throwaway environment. Start it in one terminal; it prints the URL to use (replace `postgresql://` with `postgresql+psycopg://`) and keeps running until you stop it:

```bash
uvx --python 3.12 --with pgserver python -c "import pgserver, time; s = pgserver.get_server('.pgdata', cleanup_mode=None); print(s.get_uri()); time.sleep(10**9)"
```

Each test run makes its own randomly named schema and drops it afterwards, so several runs can share one server. `.pgdata` is ignored by git.

**Row-level security is on in every PostgreSQL test.** The fixture makes a role for each run (`<schema>_owner`: not a superuser, no `BYPASSRLS`, allowed to create roles), gives it the schema, and every connection logs in as it. The policies are forced, so they bind it even though it owns the tables. Superusers skip every policy, so a test that builds its own engine on the same schema (a bigger pool for a race, say) must use `cloud_db.sibling_engine(engine, ...)`, which keeps the schema and the login role. Rows a test sets up across workspaces go in through `transaction(engine)` with no workspace, or a plain connection; reads inside `transaction(engine, workspace_id)` see that workspace only.

## Rules for good tests here

- **Name the rule** the test proves: `test_a_stale_fencing_token_cannot_publish`.
- **Deterministic:** no real sleeps for timing logic (use `clock`), seeded randomness, no network (`httpx.MockTransport` and fakes).
- **Properties for invariants:** use Hypothesis for "for all inputs" rules (fairness, never granting beyond a plan, round-robin ordering), and `RuleBasedStateMachine` for long random sequences (the job lifecycle). Profiles: `dev` (50 examples), `ci` (300), `nightly` (5,000), chosen by `HYPOTHESIS_PROFILE`.
- **Real migrations, not `create_all`**, so every run also tests the schema.
- **Every bug gets a regression test** before the fix.
- **Never weaken a test to make it pass.** If the test is wrong, say why in the commit.
- **End job and race scenarios with the invariant checker:** `selecta.audit.invariants.assert_clean(engine)` checks the database-readable invariants of [§15.2](../saas/15-stress-testing.md) (no lost jobs, no stale publish, no cross-tenant rows, quota, artifacts, duplicates, entitlements, consistent heads) and names every violation.

## What CI checks

Four workflows live in `.github/workflows/`. `test.yml` runs on every pull request and every push to `main`; its `verify` job passes only when every other job passed, so it's the one check to require before merging.

| Job (`test.yml`) | Runs | Starts after |
|---|---|---|
| Workflows (Linux) | actionlint and shellcheck over every workflow file | |
| Lint (Linux) | Ruff, the file-length rule, and no live credential in any tracked file | |
| Checklist evidence (Linux) | No ticked checklist box without `Evidence:` | |
| Web (Linux) | Vitest and the production build | |
| Cloud / PostgreSQL (Linux, 3 shards) | Cloud tests on SQLite and PostgreSQL with branch coverage; `verify` combines the shards and runs the coverage gate | Lint |
| Python shards (Windows) | Every test on SQLite, 70% repository coverage | Lint |
| Edge E2E and Flags (Windows) | Playwright on Edge, and the flag reflow sweep | Lint, Web |
| Cloud E2E (Linux) | Every cloud browser test, on Edge, against the one cloud test server (`pnpm e2e:cloud`) | Lint, Web |

| Workflow | When | Runs |
|---|---|---|
| `nightly.yml` | Every night; Sundays; by hand | `pip-audit` and `pnpm audit` nightly; the cloud tests with Hypothesis at 5,000 examples on PostgreSQL, and the scrambled Stripe replay at 250,000 deliveries (`SELECTA_BILLING_REPLAY_DELIVERIES`), on Sundays |
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
