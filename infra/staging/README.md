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
| `room-fanout` | SC-0407-04, SC-0416-06 | `tests/load/room_fanout.py run`: opens one room per host, holds 100 `/api/events` listeners on each of 500 rooms, locks and unlocks the rooms at a set rate and fails unless fan-out p99 is within 1 s (ADR-0407) and no event is dropped; writes `room-fanout.json` | `STAGING_BASE_URL`, `HOST_TOKENS_TXT` (one Premium host token per line, one per room) | `ROOMS` (default 500), `LISTENERS` (default 100), `ACTIONS` (changes per room, default 10), `RATE` (changes a second in all, default 50) |
| `room-fanout-k6` | SC-0407-04, SC-0416-06 | `tests/load/k6/room_fanout.js` with k6 built with xk6-sse: the same 500 rooms by 100 `/api/events` listeners, hosts locking and unlocking on a fixed timetable; fails unless fan-out p99 is within 1 s (ADR-0407), no event is dropped or out of order and every host change and stream is accepted; writes `room-fanout-k6.json` | `STAGING_BASE_URL`, `HOST_TOKENS_TXT` (one Premium host token per line, one per room) | `K6_SSE` (the xk6-sse k6 binary, default `./k6`), `ROOMS` (default 500), `LISTENERS` (default 100), `ACTIONS` (changes per room, default 20), `INTERVAL_S` (seconds between a room's changes, default 5), `CONNECT_S` (seconds for every stream to open first, default 90) |
| `restore-drill` | SC-0409-04, SC-0412-03 | `infra/backup/restore_drill.sh`: restores last night's dump into an empty drill database, upgrades it, then `python -m selecta.ops.restore_drill` replays the deletions ledger, reconciles storage and Stripe, expires leases and checks every deleted song stays hidden, timed against 60 minutes | `DRILL_DATABASE_URL`, `BACKUP_S3_ENDPOINT`, `BACKUP_BUCKET`, `SELECTA_R2_BUCKET_DELETION_LEDGER`, plus read-only `AWS_*` keys for the dump bucket and `SELECTA_R2_*` for the ledger | `REPORT_DIR` (the drill writes `restore-<date>.md` there; default `docs/operations/drills`), `SELECTA_STRIPE_SECRET_KEY` (test mode) to include Stripe reconciliation |
| `lucy-eval` | SC-0404-06 | `python -m selecta.ops.lucy_eval eval`: the fixed Lucy evaluation set against every tier's first-choice deployment with its real provider; records the pass only when every case passes | `SELECTA_DATABASE_URL`, `ANTHROPIC_API_KEY` (or whichever variable each deployment's secret reference names) | `DEPLOYMENT` (one deployment id instead of every tier) |
| `lucy-rollout` | SC-0404-06 | `python -m selecta.ops.lucy_eval rollout`: compares the candidate's real turns since `SINCE` with the previous deployment's, then takes it to 5%, 25% or 100%, holds it, or rolls it back to 0% | `SELECTA_DATABASE_URL`, `CANDIDATE`, `PREVIOUS`, `SINCE` (epoch seconds of the last stage change) | `DRY_RUN` (set it to 1) |
| `business_peak` | BZ-0454-07 | ST1: every seeded zone's kiosk (500 venues x 3 zones) pairs, heartbeats, holds its lease and downloads horizons through the real kiosk routes, judged by B1 to B9 and heartbeat p95 under 300 ms; writes `business_peak.json` | `STAGING_BASE_URL`, `BUSINESS_SEED` (the seed file from `tests/load/business_scenarios.py seed`), `BUSINESS_OWNER_TOKEN` (the pilot owner's bearer token) | `MINUTES` (default 60) |
| `business_reconnect` | BZ-0454-08 | ST2: the fleet runs while a person takes the API away for 30 minutes and brings it back; kiosks resync and upload their logs once; writes `business_reconnect.json` | `STAGING_BASE_URL`, `BUSINESS_SEED` (the seed file from `tests/load/business_scenarios.py seed`), `BUSINESS_OWNER_TOKEN` (the pilot owner's bearer token) | `MINUTES` (default 60) |
| `business_bulk_schedule` | BZ-0454-09 | ST3: the fleet runs while an HQ admin applies one daypart to 200 venues and a second admin edits 5 of them; writes `business_bulk_schedule.json` | `STAGING_BASE_URL`, `BUSINESS_SEED` (the seed file from `tests/load/business_scenarios.py seed`), `BUSINESS_OWNER_TOKEN` (the pilot owner's bearer token) | `MINUTES` (default 60) |
| `business_grace_close` | BZ-0454-10 | ST4: the fleet runs while Stripe test-mode payments fail and grace ends around closing times (late and duplicate webhooks replayed); writes `business_grace_close.json` | `STAGING_BASE_URL`, `BUSINESS_SEED` (the seed file from `tests/load/business_scenarios.py seed`), `BUSINESS_OWNER_TOKEN` (the pilot owner's bearer token) | `MINUTES` (default 60) |
| `business_request_flood` | BZ-0454-11 | ST5: the fleet runs while `tests/load/k6/rooms.js` floods 500 zones with 50 guests each; writes `business_request_flood.json` | `STAGING_BASE_URL`, `BUSINESS_SEED` (the seed file from `tests/load/business_scenarios.py seed`), `BUSINESS_OWNER_TOKEN` (the pilot owner's bearer token) | `MINUTES` (default 60) |
| `business_sso_outage` | BZ-0454-11 | ST6: the fleet runs while the WorkOS test identity provider is switched off at shift change; staff tablets and break-glass are checked by a person; writes `business_sso_outage.json` | `STAGING_BASE_URL`, `BUSINESS_SEED` (the seed file from `tests/load/business_scenarios.py seed`), `BUSINESS_OWNER_TOKEN` (the pilot owner's bearer token) | `MINUTES` (default 60) |
| `business_mass_offboard` | BZ-0454-11 | ST7: the fleet runs while Directory Sync deactivates 2,000 people; a person checks no session works after 30 s; writes `business_mass_offboard.json` | `STAGING_BASE_URL`, `BUSINESS_SEED` (the seed file from `tests/load/business_scenarios.py seed`), `BUSINESS_OWNER_TOKEN` (the pilot owner's bearer token) | `MINUTES` (default 60) |
| `business_playlog_export` | BZ-0454-11 | ST8: the fleet runs while a person streams a month's export with `format=csv` and watches API memory; writes `business_playlog_export.json` | `STAGING_BASE_URL`, `BUSINESS_SEED` (the seed file from `tests/load/business_scenarios.py seed`), `BUSINESS_OWNER_TOKEN` (the pilot owner's bearer token) | `MINUTES` (default 60) |
| `business_rule_change` | BZ-0454-11 | ST9: the fleet runs while a person tightens an organisation's rules at peak; writes `business_rule_change.json` | `STAGING_BASE_URL`, `BUSINESS_SEED` (the seed file from `tests/load/business_scenarios.py seed`), `BUSINESS_OWNER_TOKEN` (the pilot owner's bearer token) | `MINUTES` (default 60) |
| `business_soak` | BZ-0454-11 | ST10: the fleet runs for 72 hours (`MINUTES=4320`) while a person flaps the network on 10% of kiosks; writes `business_soak.json` | `STAGING_BASE_URL`, `BUSINESS_SEED` (the seed file from `tests/load/business_scenarios.py seed`), `BUSINESS_OWNER_TOKEN` (the pilot owner's bearer token) | `MINUTES` (default 60) |

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
fan-out run is `room-fanout`: it needs about 50,000 open sockets, so raise the load machine's file-descriptor limit (or split the hosts
across machines, each with its own `HOST_TOKENS_TXT` and `ROOMS`). `python tests/load/room_fanout.py smoke --port 9401` runs it locally at 5 rooms by 3
listeners against `tests/e2e_cloud_server.py`.

**Business scenarios (`business_*`).** Seed staging first:
`python tests/load/business_scenarios.py seed --base-url $STAGING_BASE_URL --staff-token <staff token>
--owner-user-id <pilot owner id> --venues 500 --zones 3 --out business-seed.json` (needs
`business.pilots` and the staff admin session), then fill in the owner's token as
`BUSINESS_OWNER_TOKEN`. Each task runs the kiosk simulator (`tests/load/business_kiosk_sim.py`)
in real time against staging and judges B1 to B9 from what the kiosks observed; the scenario's
event (outage, bulk edit, failed payments, flood, IdP outage, offboarding, export, rule change,
flaps) is injected by a person, as for `l6`. The scaled-down local versions run in CI from
`tests/test_business_stress.py`; a local pass never stands in for these runs, and no gate in
docs/verification/bz-gate-register.md is passed by either: the owner records it.
