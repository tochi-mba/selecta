# Staging runs

Every Cloud checklist task that can only be proved on staging has one command here:

    python infra/staging/run.py <task>             # run it
    python infra/staging/run.py <task> --dry-run   # print the commands only
    python infra/staging/run.py --list             # every task and its inputs

Inputs are environment variables. The runner refuses to start while one is missing, and
refuses any URL input that does not contain `staging` (or is not a local host), so it can't be
pointed at production by mistake. Reports go to `REPORT_DIR` (default `reports/staging`); file
each one as the task's evidence. Use synthetic accounts only: Stripe in test mode, capped AI
keys, the WorkOS test environment.

Tools: Python with this repo installed (`pip install -e .`), [k6](https://k6.io) for the load
tasks, and for `sse` a k6 built with xk6-sse
(`xk6 build --with github.com/phymbert/xk6-sse --output ./k6`, pin the versions you verify).
`restore-drill` needs bash, `pg_restore` 17 and the aws CLI.

| Task | Checklist | What it does | Inputs (required) | Optional |
|---|---|---|---|---|
| `smoke` | SC-0409-01 | `infra/deploy/smoke.py`: both services ready on the latest schema, anonymous and unenrolled callers refused, a synthetic user reads their account and songs | `STAGING_API`, `STAGING_GATEWAY` | `SYNTHETIC_TOKEN` (a synthetic user's session token) |
| `sse` | SC-0407-04 | `tests/load/sse_connections.js`: ramps to 10,000 `/api/events` streams with routine reads alongside | `STAGING_API`, `TOKENS_JSON` (a JSON list of `{"token", "workspace"}`) | `K6_SSE` (path to the xk6-sse k6, default `./k6`), `STREAMS`, `HOLD_S` |
| `ladder` | SC-0411-04 | `tests/load/k6/ladder.js` for one rung, then `tests/load/ladder.py check` judges the k6 summary against the section 15.6 thresholds | `LEVEL` (`L1` to `L4`), `STAGING_BASE_URL`, `TOKENS_TXT` (one bearer token per line) | `K6` (k6 binary, default `k6`) |
| `l6` | SC-0411-05 | L3 load through the ladder script while people inject the L6 faults (below), then `python -m selecta.ops.reconcile_check` (invariants and storage reconciliation) | `STAGING_BASE_URL`, `TOKENS_TXT`, `SELECTA_DATABASE_URL` (staging database, read access is enough) | `K6` |
| `rooms` | SC-0416-06 | `tests/load/k6/rooms.js`: 1,000 joins within 10 s, 10,000 votes a minute, random-code guessing | `STAGING_BASE_URL`, `ROOM_CODE` (an open room, guest cap raised to 1,000), `REQUEST_ID` (a pending request in it) | `K6` |
| `restore-drill` | SC-0409-04, SC-0412-03 | `infra/backup/restore_drill.sh`: restores last night's dump into an empty drill database, upgrades it, then `python -m selecta.ops.restore_drill` replays the deletions ledger, reconciles storage and Stripe, expires leases and checks every deleted song stays hidden, timed against 60 minutes | `DRILL_DATABASE_URL`, `BACKUP_S3_ENDPOINT`, `BACKUP_BUCKET`, `SELECTA_R2_BUCKET_DELETION_LEDGER`, plus read-only `AWS_*` keys for the dump bucket and `SELECTA_R2_*` for the ledger | `REPORT_DIR` (the drill writes `restore-<date>.md` there; default `docs/operations/drills`), `SELECTA_STRIPE_SECRET_KEY` (test mode) to include Stripe reconciliation |
| `lucy-eval` | SC-0404-06 | `python -m selecta.ops.lucy_eval eval`: the fixed Lucy evaluation set against every tier's first-choice deployment with its real provider; records the pass only when every case passes | `SELECTA_DATABASE_URL`, `ANTHROPIC_API_KEY` (or whichever variable each deployment's secret reference names) | `DEPLOYMENT` (one deployment id instead of every tier) |
| `lucy-rollout` | SC-0404-06 | `python -m selecta.ops.lucy_eval rollout`: compares the candidate's real turns since `SINCE` with the previous deployment's, then takes it to 5%, 25% or 100%, holds it, or rolls it back to 0% | `SELECTA_DATABASE_URL`, `CANDIDATE`, `PREVIOUS`, `SINCE` (epoch seconds of the last stage change) | `DRY_RUN` (set it to 1) |

## Notes per task

**Rollout order.** Register the candidate with `rollout_percent` 0, run `lucy-eval` with
`DEPLOYMENT=<candidate>`, list it before the previous deployment in a new routing version, then
run `lucy-rollout` once to start at 5%. Wait for at least 50 turns on it (a day on staging with
synthetic traffic, or the beta), run `lucy-rollout` again for 25%, and again for 100%. A
regression (failure rate more than 2 points worse, p95 or cost per turn more than 25% worse)
rolls it back to 0% and the command exits 1.

**L6 faults (`l6`).** While the L3 load runs, two people work from `docs/operations/game-day.md`:
kill every Modal worker mid-attempt twice; engage the worker drain from two admin sessions at
once and release it; make R2 refuse deletes (revoke the purge key for 5 minutes); hold Stripe
test-mode webhooks and replay them late and twice; switch the Lucy deployment off and on again
while the AI key is revoked (the AI-provider outage); and at the same time run a signup, upload,
upgrade and mix-request burst from the synthetic accounts (the launch-day stampede). The
reconciliation audit at the end must report CLEAN. The local, scaled-down versions of every one
of these are `tests/test_cloud_catastrophe.py`.

**Rooms.** Run `rooms` behind the same Cloudflare rule as production and from many source
addresses, or the per-IP join limit rightly refuses most joins. The 500-room, 100-guest SSE
fan-out run is still to be scripted.
