# Selecta Cloud implementation checklist (ADR-0391 to ADR-0416)

**Status:** 130 tasks across 26 ADRs, all accepted by the owner on 2026-11-09. 2 Implemented, 21 In progress, 107 Not started, 0 independently Verified. Proposal: [docs/saas](../saas/README.md).

**How to tick a box.** Tick `[x]` only when the task's acceptance is met and its required verification has run. The ticked line must end with `Evidence:` naming the files, tests or run that prove it; `python src/selecta/audit/checklist_evidence.py` (a CI job) rejects a tick without evidence. Ticking means *Implemented*; *Independently verified* stays `No` until someone other than the implementer checks it. Keep each ADR's own checklist line in step with this file.

**In progress** is written in the line as `Implementation: In progress` with the box left unticked.


## [ADR-0391 - Selecta Cloud becomes a goal; local-only guarantees are scoped to local mode](adr-0391-selecta-cloud-goal-and-local-guarantees.md)

- [ ] **SC-0391-01 - Programme entry.** Acceptance: `docs/adr/README.md` lists the Selecta Cloud programme and states local guarantees are unchanged. Required verification: Doc review. Implementation: Not started; Independently verified: No.
- [ ] **SC-0391-02 - Guarantee list per mode.** Acceptance: A table of local-mode and cloud-mode guarantees exists and is linked from both READMEs. Required verification: Doc review. Implementation: Not started; Independently verified: No.
- [ ] **SC-0391-03 - Local copy unchanged.** Acceptance: Local-mode user-facing text about privacy is unchanged by cloud work. Required verification: Playwright local-mode suite passes unchanged. Implementation: Not started; Independently verified: No.
- [ ] **SC-0391-04 - Mode-aware privacy test.** Acceptance: `web/e2e/pages.e2e.ts` keeps 'only talks to this computer' in local mode and checks an origin allowlist in cloud mode. Required verification: Both e2e modes in CI. Implementation: Not started; Independently verified: No.

## [ADR-0392 - Two runtime modes, one codebase](adr-0392-two-runtime-modes.md)

- [x] **SC-0392-01 - Mode switch.** Acceptance: App factory selects adapters from `SELECTA_MODE`; default `local`. Required verification: Unit tests for both modes. Implementation: Implemented; `serve()` defaults to local and selects the Cloud factory when configured. Evidence: `tests/test_cloud_api.py::test_serve_defaults_to_local_and_cloud_does_not_start_local_workers`. Independently verified: No.
- [ ] **SC-0392-02 - No local side effects in cloud.** Acceptance: Cloud mode starts no watcher, warm-up or worker threads and never calls `forget_unfinished()`. Required verification: Integration test asserts no threads/subprocesses at start. Implementation: In progress; Cloud factory and mode-selection test avoid local startup hooks; complete mode parity remains. Independently verified: No.
- [ ] **SC-0392-03 - Local parity.** Acceptance: All existing Python and Playwright tests pass in local mode. Required verification: CI. Implementation: Not started; Independently verified: No.
- [ ] **SC-0392-04 - Copy layer.** Acceptance: User-facing strings that mention 'this PC' come from a mode-keyed copy layer. Required verification: Vitest snapshot per mode. Implementation: Not started; Independently verified: No.
- [ ] **SC-0392-05 - Linux CI for cloud mode.** Acceptance: A Linux job runs the cloud-mode test set. Required verification: CI. Implementation: Not started; Independently verified: No.

## [ADR-0393 - PostgreSQL system of record, Alembic migrations and workspace tenancy](adr-0393-postgres-alembic-and-tenancy.md)

- [ ] **SC-0393-01 - Alembic baseline.** Acceptance: Baseline migration reproduces today's schema on SQLite and Postgres. Required verification: Migration up/down test on both. Implementation: In progress; 50 shared tables and four revisions are checked in, with SQLite upgrade/compare/rollback coverage; PostgreSQL execution remains. Independently verified: No.
- [ ] **SC-0393-02 - workspace_id everywhere.** Acceptance: All tenant tables carry `workspace_id`; queries go through repositories that require it. Required verification: Static check plus cross-tenant suite. Implementation: Not started; Independently verified: No.
- [ ] **SC-0393-03 - RLS policies.** Acceptance: Postgres policies deny rows from other workspaces even if a query forgets the filter. Required verification: Integration test with a deliberately unscoped query. Implementation: Not started; Independently verified: No.
- [ ] **SC-0393-04 - Local upgrade with backup.** Acceptance: First start after upgrade backs up the SQLite file, then migrates. Required verification: Upgrade test from a copy of a real local database. Implementation: Not started; Independently verified: No.
- [ ] **SC-0393-05 - Lazy tables removed.** Acceptance: No module creates tables at runtime. Required verification: Grep check in CI. Implementation: Not started; Independently verified: No.

## [ADR-0394 - Durable jobs with leases and fencing](adr-0394-durable-jobs-leases-and-fencing.md)

- [ ] **SC-0394-01 - Job tables and state module.** Acceptance: All transitions go through one module; illegal transitions raise. Required verification: Hypothesis state-machine tests. Implementation: In progress; shared job/attempt/artifact tables, one transition module and durable store exist; a Hypothesis state-machine suite remains. Independently verified: No.
- [ ] **SC-0394-02 - Leases and fencing.** Acceptance: A completion with a stale fencing token is refused; the zombie-worker scenario publishes once. Required verification: Integration race test. Implementation: In progress; claims issue fencing tokens and completion is idempotent while rejecting stale holders; PostgreSQL race verification remains. Independently verified: No.
- [ ] **SC-0394-03 - Reaper.** Acceptance: Expired attempts return to queued or fail when attempts are exhausted, within lease + interval. Required verification: Kill-loop chaos test. Implementation: In progress; expired-lease reaping and a term-fenced maintenance loop exist; kill-loop chaos verification remains. Independently verified: No.
- [ ] **SC-0394-04 - Local runner.** Acceptance: Seam worker pipe, analysis subprocess and export JSON jobs are replaced in local mode; transitions sound the same. Required verification: Existing tests plus the owner's listening check. Implementation: In progress; the cooperative durable worker runner now supports injected handlers, but local audio jobs still use the existing workers and have not been migrated. Independently verified: No.
- [ ] **SC-0394-05 - Error classes and quarantine.** Acceptance: Each error class follows its retry policy; a job that crashes three workers is quarantined. Required verification: Unit and chaos tests. Implementation: In progress; retry policies, resource escalation and poison quarantine are implemented; the required class/chaos coverage remains. Independently verified: No.
- [ ] **SC-0394-06 - Outbox.** Acceptance: Every transition writes an outbox event in the same transaction. Required verification: Integration test. Implementation: In progress; lifecycle state changes write durable outbox rows and PostgreSQL notifications in the transaction; integration verification remains. Independently verified: No.

## [ADR-0395 - Fair scheduling: lanes and per-account weights by tier](adr-0395-fair-scheduling-policy.md)

- [ ] **SC-0395-01 - Policy module.** Acceptance: `choose(pool, worker_caps, now)` implements the hierarchy; shared by the claim and the simulator. Required verification: Unit tests. Implementation: Not started; Independently verified: No.
- [ ] **SC-0395-02 - Simulator.** Acceptance: Deterministic simulator with virtual clock, invariants after every event, per-tier wait percentiles and share error. Required verification: Runs on every PR. Implementation: Not started; Independently verified: No.
- [ ] **SC-0395-03 - Fairness threshold.** Acceptance: Under saturation, measured share per backlogged account is within ±15% of weight ratio over 10-minute windows. Required verification: Simulator scenarios. Implementation: Not started; Independently verified: No.
- [ ] **SC-0395-04 - No starvation.** Acceptance: No backlogged account waits beyond the policy bound in any scenario, including 72 h of Premium demand. Required verification: Simulator scenarios. Implementation: Not started; Independently verified: No.
- [ ] **SC-0395-05 - Admission control.** Acceptance: 10M-job submission keeps the API responsive and materialises work lazily. Required verification: Load test L4. Implementation: Not started; Independently verified: No.
- [ ] **SC-0395-06 - Rank mapping.** Acceptance: Today's six ranks map to lanes and urgency as specified; local mode uses the same policy. Required verification: Unit tests plus local listening check. Implementation: Not started; Independently verified: No.

## [ADR-0396 - Worker gateway and worker pools](adr-0396-worker-gateway-and-pools.md)

- [x] **SC-0396-01 - Gateway endpoints.** Acceptance: All six endpoints exist with token auth and idempotency. Required verification: Integration tests. Implementation: Implemented; standalone gateway app, CLI service command, scoped enrollment/worker tokens, fenced job lifecycle routes, signed R2 URLs and readiness endpoint. Evidence: `tests/test_worker_gateway_api.py`; `src/selecta/gateway_cloud.py`; `src/selecta/work/gateway_api.py`. Independently verified: No.
- [ ] **SC-0396-02 - Worker image.** Acceptance: Linux image with ffmpeg, torch CPU and pinned models runs analysis and renders end to end. Required verification: Staging smoke test. Implementation: In progress; remote client and cooperative worker runner can claim fenced jobs and transfer signed objects, but no pinned Linux image or real Cloud audio handlers exist yet. Independently verified: No.
- [ ] **SC-0396-03 - GPU pool.** Acceptance: Demucs windows run on Modal with CPU fallback when GPU capacity is absent. Required verification: Staging test; timing recorded. Implementation: Not started; Independently verified: No.
- [ ] **SC-0396-04 - Scale-out.** Acceptance: Throughput rises monotonically with worker count to a documented bottleneck. Required verification: Worker scaling benchmark 1→32. Implementation: Not started; Independently verified: No.
- [ ] **SC-0396-05 - Spend ceilings.** Acceptance: A pool stops scaling at its ceiling and alerts. Required verification: Staging test with a low ceiling. Implementation: Not started; Independently verified: No.
- [ ] **SC-0396-06 - Gateway isolation.** Acceptance: A worker storm on the gateway leaves customer API p95 unchanged. Required verification: Load test. Implementation: In progress; gateway has a separate app factory and `selecta gateway` deployment entry point, but production separation and comparative API p95 load measurements remain. Independently verified: No.
- [ ] **SC-0396-07 - Egress measured.** Acceptance: Bytes uploaded per job type are recorded and match the cost model. Required verification: Phase 0 benchmark and staging metrics. Implementation: Not started; Independently verified: No.

## [ADR-0397 - Object storage layout and artifact provenance on R2](adr-0397-object-storage-layout.md)

- [ ] **SC-0397-01 - ArtifactStore interface.** Acceptance: Local and R2 implementations behind one interface used by workers. Required verification: Unit and integration tests. Implementation: Not started; Independently verified: No.
- [ ] **SC-0397-02 - Content-addressed keys.** Acceptance: Seam and stem keys derive from content hashes scoped to the workspace. Required verification: Unit tests. Implementation: Not started; Independently verified: No.
- [ ] **SC-0397-03 - Provenance.** Acceptance: Every artifact row records inputs, versions and checksum. Required verification: Schema test. Implementation: Not started; Independently verified: No.
- [ ] **SC-0397-04 - Eviction with protection.** Acceptance: Budgets evict least-recent unprotected artifacts only. Required verification: Integration test. Implementation: Not started; Independently verified: No.
- [ ] **SC-0397-05 - Bucket lifecycle.** Acceptance: Staging multipart aborts after 1 day; exports expire per plan. Required verification: IaC review plus staging check. Implementation: Not started; Independently verified: No.

## [ADR-0398 - Upload protocol with server-side completion and quota reservations](adr-0398-upload-protocol-and-quota-reservations.md)

- [ ] **SC-0398-01 - Session planning.** Acceptance: Batch planning of up to 500 files with reservations and duplicate flags. Required verification: Integration test. Implementation: In progress; Cloud routes plan workspace-scoped batches, reserve quota, flag duplicates and support cancellation; the Cloud UI submits file hashes and asks before keeping duplicates. R2 production verification and full batch browser workflow remain. Independently verified: No.
- [ ] **SC-0398-02 - Server completion.** Acceptance: Oversize or mismatched uploads are aborted and reservations released. Required verification: Integration test with a lying client. Implementation: In progress; server lists parts, checks declared size, probes actual metadata and verifies the stored original's size/hash before committing quota; hostile-file sandbox and live R2 integration remain. Independently verified: No.
- [ ] **SC-0398-03 - Quota race.** Acceptance: 1,000 concurrent uploads for the last 1 GB never exceed the limit. Required verification: Concurrency test. Implementation: Not started; Independently verified: No.
- [ ] **SC-0398-04 - Validation sandbox.** Acceptance: Decode bombs, fake extensions and truncated files are rejected safely within limits. Required verification: Hostile-file test set. Implementation: Not started; Independently verified: No.
- [ ] **SC-0398-05 - Resume.** Acceptance: A refreshed browser resumes from uploaded parts. Required verification: Playwright test. Implementation: In progress; the API lists completed parts and the Cloud UI hashes reselected files to find and resume their prior session; browser refresh verification remains. Independently verified: No.

## [ADR-0399 - Cloud playback with lossless playback proxies](adr-0399-cloud-playback-proxies.md)

- [ ] **SC-0399-01 - Lazy proxy job.** Acceptance: Playback files are made only for songs entering a mix, preview or request, inherit that work's urgency, and are evicted under the derived budget. Required verification: Integration test. Implementation: Not started; Independently verified: No.
- [ ] **SC-0399-02 - Alignment.** Acceptance: Seam boundaries line up within one sample with the proxy on Chrome, Edge, Firefox and Safari. Required verification: Automated alignment check plus listening check. Implementation: Not started; Independently verified: No.
- [ ] **SC-0399-03 - Signed URL refresh.** Acceptance: An expired URL mid-session refreshes once without changing the mix. Required verification: Playwright test. Implementation: In progress; Cloud can mint short-lived owner-checked original and workspace-checked derived playback URLs, but the audio client’s one-time expiry refresh is not implemented. Independently verified: No.
- [ ] **SC-0399-04 - Prefetch.** Acceptance: The next song and its transitions are buffered before they're needed. Required verification: Playwright timing test. Implementation: Not started; Independently verified: No.

## [ADR-0400 - Identity with WorkOS AuthKit](adr-0400-identity-with-workos-authkit.md)

- [ ] **SC-0400-01 - Sign-up and sign-in.** Acceptance: Flows work with verification and the age statement. Required verification: Playwright test against AuthKit test environment. Implementation: Not started; Independently verified: No.
- [ ] **SC-0400-02 - JWT verification.** Acceptance: Expired, wrong-audience and tampered tokens are refused. Required verification: Unit tests. Implementation: Not started; Independently verified: No.
- [ ] **SC-0400-03 - Session revocation.** Acceptance: Revoking sessions signs out every device within the access-token lifetime. Required verification: Integration test. Implementation: Not started; Independently verified: No.
- [ ] **SC-0400-04 - Account deletion.** Acceptance: Deletion cancels the subscription and starts the deletion workflow. Required verification: Integration test. Implementation: Not started; Independently verified: No.

## [ADR-0401 - Authorization: staff roles, scopes and the audit log](adr-0401-authorization-rbac-and-audit.md)

- [ ] **SC-0401-01 - Permission registry and checks.** Acceptance: Every admin route declares its permission; unknown permissions fail CI. Required verification: Unit tests. Implementation: Not started; Independently verified: No.
- [ ] **SC-0401-02 - Scoped assignments.** Acceptance: Assignments respect scope and expiry; revocation takes effect immediately. Required verification: Integration tests. Implementation: Not started; Independently verified: No.
- [ ] **SC-0401-03 - Delayed dangerous actions.** Acceptance: Listed actions wait 15 minutes, notify, can be cancelled and re-check authority. Required verification: Integration test. Implementation: Not started; Independently verified: No.
- [ ] **SC-0401-04 - Audit log.** Acceptance: Sensitive allows and all admin denies are recorded; the app role cannot update or delete audit rows. Required verification: Database permission test. Implementation: Not started; Independently verified: No.
- [ ] **SC-0401-05 - Compromised-admin drill.** Acceptance: Escalation, content access and audit tampering attempts are blocked and alerted. Required verification: Security test. Implementation: Not started; Independently verified: No.

## [ADR-0402 - Plans, entitlements, quotas and allowances](adr-0402-plans-entitlements-and-quotas.md)

- [ ] **SC-0402-01 - Plan catalogue.** Acceptance: Plans validate against the flag registry; changes are versioned. Required verification: Unit test plus CI check. Implementation: Not started; Independently verified: No.
- [ ] **SC-0402-02 - Usage ledger.** Acceptance: Ledger totals match rollups and storage inventory. Required verification: Reconciliation test. Implementation: Not started; Independently verified: No.
- [ ] **SC-0402-03 - Over-quota state.** Acceptance: Uploads and exports are blocked, playback and downloads work, nothing is deleted. Required verification: Integration and Playwright tests. Implementation: Not started; Independently verified: No.
- [ ] **SC-0402-04 - Meters.** Acceptance: Plan & billing shows storage, analysis today, Lucy turns and exports. Required verification: Playwright test. Implementation: Not started; Independently verified: No.

## [ADR-0403 - Stripe billing, reconciliation and UK VAT](adr-0403-stripe-billing-and-uk-vat.md)

- [ ] **SC-0403-01 - Webhook store and processing.** Acceptance: Signature verified; duplicates ignored; events processed by re-fetching. Required verification: Integration tests with Stripe test mode. Implementation: In progress; signed endpoint, idempotent event store, current-state re-fetch, entitlement and quota updates are wired, with a bounded retry-drain helper; scheduled execution and Stripe test-mode runs remain. Independently verified: No.
- [ ] **SC-0403-02 - Scrambled-event replay.** Acceptance: Hundreds of thousands of shuffled, duplicated and delayed events produce the correct final entitlements. Required verification: Replay test. Implementation: Not started; Independently verified: No.
- [ ] **SC-0403-03 - Nightly reconciliation.** Acceptance: Drift is detected and corrected with an audit entry. Required verification: Integration test. Implementation: In progress; full Stripe subscription reconciliation and quota-limit synchronization helpers exist, but scheduled execution, audit entries and drift alerting remain unwired. Independently verified: No.
- [ ] **SC-0403-04 - UK checkout consent.** Acceptance: Consent text is captured and stored with the subscription. Required verification: Playwright test. Implementation: In progress; checkout requires a server-versioned consent plus explicit immediate-access and cancellation-right acknowledgements and stores the accepted version; consent copy, UI and Playwright coverage remain. Independently verified: No.
- [ ] **SC-0403-05 - Tax setup.** Acceptance: Stripe Tax configured for UK; EU sales blocked until OSS or merchant of record is decided. Required verification: Configuration review. Implementation: Not started; Independently verified: No.

## [ADR-0404 - Lucy AI gateway with server-owned model routing](adr-0404-lucy-ai-gateway.md)

- [ ] **SC-0404-01 - Registry and routing.** Acceptance: Tier requests resolve to the configured deployment; changes apply to new runs only. Required verification: Unit and integration tests. Implementation: Not started; Independently verified: No.
- [ ] **SC-0404-02 - Allowance ledger.** Acceptance: Turns are metered; limits enforced mid-conversation gracefully. Required verification: Integration test. Implementation: Not started; Independently verified: No.
- [ ] **SC-0404-03 - Spend guards.** Acceptance: No admission past per-account or platform ceilings, proven with a fake provider. Required verification: Load test with fake provider. Implementation: Not started; Independently verified: No.
- [ ] **SC-0404-04 - Fallback chain.** Acceptance: Provider outage degrades to the next model or the built-in planner; the rest of the app is unaffected. Required verification: Chaos test. Implementation: Not started; Independently verified: No.
- [ ] **SC-0404-05 - Settings split.** Acceptance: Cloud Lucy settings show only user-owned choices and a usage meter. Required verification: Playwright test per mode. Implementation: Not started; Independently verified: No.
- [ ] **SC-0404-06 - Evaluation gate.** Acceptance: The Lucy evaluation set passes for each tier's deployment. Required verification: Eval run report. Implementation: Not started; Independently verified: No.

## [ADR-0405 - Licence register and replacing S-KEY for commercial use](adr-0405-licence-register-and-s-key-replacement.md)

- [ ] **SC-0405-01 - Register complete.** Acceptance: Every model and dependency in the worker images has a row. Required verification: Doc review against image contents. Implementation: Not started; Independently verified: No.
- [ ] **SC-0405-02 - S-KEY replacement.** Acceptance: Chosen replacement meets the agreed accuracy threshold against S-KEY. Required verification: Benchmark report plus listening check. Implementation: Not started; Independently verified: No.
- [ ] **SC-0405-03 - Model allowlist.** Acceptance: Cloud mode refuses to load an unlisted model. Required verification: Unit test. Implementation: Not started; Independently verified: No.
- [ ] **SC-0405-04 - Legal review.** Acceptance: Rows marked Review are resolved by a lawyer before paid launch. Required verification: Written advice on file. Implementation: Not started; Independently verified: No.

## [ADR-0406 - Lyrics in cloud mode](adr-0406-lyrics-in-cloud-mode.md)

- [ ] **SC-0406-01 - Operator contact.** Acceptance: LRCLIB's operators have confirmed or refused the intended use in writing. Required verification: Correspondence on file. Implementation: Not started; Independently verified: No.
- [ ] **SC-0406-02 - Global rate limit.** Acceptance: Cloud lookups never exceed the agreed rate across all users. Required verification: Load test. Implementation: Not started; Independently verified: No.
- [ ] **SC-0406-03 - Display gating.** Acceptance: Lyric display flags default off in cloud mode; pages reflow. Required verification: Flag sweep in cloud mode. Implementation: Not started; Independently verified: No.
- [ ] **SC-0406-04 - Legal decision recorded.** Acceptance: Internal-use and display questions answered and this ADR updated. Required verification: ADR update. Implementation: Not started; Independently verified: No.

## [ADR-0407 - Real-time updates over server-sent events](adr-0407-realtime-updates-sse.md)

- [ ] **SC-0407-01 - Event stream.** Acceptance: Events arrive in order with ids; reconnect resumes without gaps. Required verification: Integration test. Implementation: In progress; `/api/events` streams ordered, workspace-filtered durable job outbox records and resumes from `Last-Event-ID`; upload, entitlement, flag, playback and Lucy fan-out plus stream integration verification remain. Independently verified: No.
- [ ] **SC-0407-02 - Fan-out.** Acceptance: An event raised on one instance reaches clients on every instance. Required verification: Multi-instance test. Implementation: Not started; Independently verified: No.
- [ ] **SC-0407-03 - Fallback.** Acceptance: With the stream blocked, polling keeps pages correct. Required verification: Playwright test. Implementation: Not started; Independently verified: No.
- [ ] **SC-0407-04 - Load.** Acceptance: SSE connection counts meet the L3 targets. Required verification: k6 test. Implementation: Not started; Independently verified: No.

## [ADR-0408 - Admin console v1](adr-0408-admin-console-v1.md)

- [ ] **SC-0408-01 - Six pages.** Acceptance: Each page meets its content list in the proposal. Required verification: Playwright walkthrough. Implementation: Not started; Independently verified: No.
- [ ] **SC-0408-02 - Commands not edits.** Acceptance: Retry, cancel, quarantine, drain and overrides go through audited commands. Required verification: Integration tests. Implementation: Not started; Independently verified: No.
- [ ] **SC-0408-03 - Read path isolation.** Acceptance: Twenty admin viewers don't change customer API latency. Required verification: Load test. Implementation: Not started; Independently verified: No.
- [ ] **SC-0408-04 - Freshness.** Acceptance: Stale metrics show their age and an unknown state. Required verification: Unit test. Implementation: Not started; Independently verified: No.

## [ADR-0409 - Hosting topology, regions and environments](adr-0409-hosting-topology-and-environments.md)

- [ ] **SC-0409-01 - Staging environment.** Acceptance: Full stack runs end to end with synthetic users. Required verification: Staging smoke test. Implementation: Not started; Independently verified: No.
- [ ] **SC-0409-02 - IaC.** Acceptance: Staging and production are reproducible from the repo. Required verification: Recreate staging from scratch. Implementation: Not started; Independently verified: No.
- [ ] **SC-0409-03 - Deploy pipeline.** Acceptance: Main deploys to staging; production needs approval; OIDC credentials only. Required verification: Pipeline run. Implementation: Not started; Independently verified: No.
- [ ] **SC-0409-04 - Backups and restore.** Acceptance: Restore drill completes in under 60 minutes. Required verification: Drill report. Implementation: Not started; Independently verified: No.

## [ADR-0410 - Observability, SLOs and emergency controls](adr-0410-observability-slos-and-emergency-controls.md)

- [ ] **SC-0410-01 - Tracing.** Acceptance: One trace follows a job from API to worker to storage. Required verification: Staging trace review. Implementation: Not started; Independently verified: No.
- [ ] **SC-0410-02 - SLO dashboards and alerts.** Acceptance: Each SLO has a dashboard and burn alert. Required verification: Alert test. Implementation: Not started; Independently verified: No.
- [ ] **SC-0410-03 - Runbooks.** Acceptance: Every alert links to a runbook. Required verification: Doc review. Implementation: Not started; Independently verified: No.
- [ ] **SC-0410-04 - Emergency controls.** Acceptance: Each control works and is audited; recovery restores normal state. Required verification: Game-day drill. Implementation: Not started; Independently verified: No.

## [ADR-0411 - Stress, chaos and release-gate testing](adr-0411-stress-chaos-and-release-gates.md)

- [ ] **SC-0411-01 - Invariant checker.** Acceptance: All ten invariants checked automatically after each test run. Required verification: CI. Implementation: Not started; Independently verified: No.
- [ ] **SC-0411-02 - Simulator in CI.** Acceptance: Scheduler simulator runs on every PR. Required verification: CI. Implementation: Not started; Independently verified: No.
- [ ] **SC-0411-03 - Linux integration job.** Acceptance: Postgres and MinIO integration tests run on Linux in CI. Required verification: CI. Implementation: Not started; Independently verified: No.
- [ ] **SC-0411-04 - Ladder to L4.** Acceptance: L1–L4 pass the thresholds on staging. Required verification: Load reports. Implementation: Not started; Independently verified: No.
- [ ] **SC-0411-05 - Catastrophe suite.** Acceptance: L6 combinations pass with clean reconciliation. Required verification: Chaos report. Implementation: Not started; Independently verified: No.

## [ADR-0412 - Privacy, retention and the deletion ledger](adr-0412-privacy-retention-and-deletion.md)

- [ ] **SC-0412-01 - Privacy notice and ICO.** Acceptance: Notice published; ICO fee paid. Required verification: Doc and receipt on file. Implementation: Not started; Independently verified: No.
- [ ] **SC-0412-02 - Deletion workflow.** Acceptance: Deletion removes objects and rows in batches and releases quota. Required verification: Integration test. Implementation: In progress; `DELETE /api/account` hides the account, revokes sessions and enqueues a leased, fenced, retryable workflow. Job, Stripe, membership, tombstone/quota and fail-closed row cleanup adapters exist; `selecta storage-maintenance` retries bounded R2 physical deletion after the 30-day recovery period. Scheduler deployment, backup expiry confirmation and privileged maintenance wiring remain. Independently verified: No.
- [ ] **SC-0412-03 - Restore safety.** Acceptance: After a restore, replaying the ledger removes data deleted since the backup. Required verification: Restore drill. Implementation: In progress; canonical off-database R2 ledger writer and restore replay helper code exist, including idempotent tombstone/quota replay and session revocation, but dedicated bucket wiring and replay-before-serving integration plus restore drill remain. R2 writes are not WORM. Independently verified: No.
- [ ] **SC-0412-04 - Data export.** Acceptance: Export includes originals, mixes and settings JSON. Required verification: Playwright test. Implementation: Not started; Independently verified: No.

## [ADR-0413 - Copyright terms, takedown and repeat infringers](adr-0413-copyright-takedown-and-repeat-infringers.md)

- [ ] **SC-0413-01 - Terms.** Acceptance: Terms cover rights, private use and public performance. Required verification: Legal review. Implementation: Not started; Independently verified: No.
- [ ] **SC-0413-02 - Takedown process.** Acceptance: Notices are logged, acted on and audited within the stated time. Required verification: Drill. Implementation: Not started; Independently verified: No.
- [ ] **SC-0413-03 - Repeat-infringer enforcement.** Acceptance: Accounts with repeated valid notices are restricted per policy. Required verification: Admin test. Implementation: Not started; Independently verified: No.
- [ ] **SC-0413-04 - DMCA agent.** Acceptance: Agent registered and renewal calendared. Required verification: Registration on file. Implementation: Not started; Independently verified: No.

## [ADR-0414 - Feature-flag targeting in cloud mode](adr-0414-feature-flag-targeting-in-cloud-mode.md)

- [ ] **SC-0414-01 - Layered resolver.** Acceptance: `decide(flag, ctx)` returns on/off with layer and reason for every flag and context. Required verification: Property tests (determinism, no grant beyond plan, core always on, cascade). Implementation: Not started; Independently verified: No.
- [ ] **SC-0414-02 - Rules storage and propagation.** Acceptance: Rule changes reach every API instance and the worker gateway within targets. Required verification: Multi-instance propagation test. Implementation: Not started; Independently verified: No.
- [ ] **SC-0414-03 - Guard and codes.** Acceptance: Rule/build off returns 403 `flag_off`; plan-locked returns 403 `plan_required` with the plan. Required verification: API tests. Implementation: Not started; Independently verified: No.
- [ ] **SC-0414-04 - Jobs and workers.** Acceptance: Jobs for a feature switched off while queued block or cancel per `when_off`; resume when switched back on. Required verification: Integration tests. Implementation: Not started; Independently verified: No.
- [ ] **SC-0414-05 - Site.** Acceptance: Decisions and locks arrive in status and SSE; reflow and teaser sweeps pass in cloud mode. Required verification: Playwright sweeps. Implementation: Not started; Independently verified: No.
- [ ] **SC-0414-06 - Admin Flags page.** Acceptance: Kill switch, tier, user, rollout and schedule actions with impact preview, trace, history and rollback; broad changes delayed per ADR-0401. Required verification: Playwright and audit tests. Implementation: Not started; Independently verified: No.
- [ ] **SC-0414-07 - Local mode unchanged.** Acceptance: Local behaviour and `docs/flags.md` generation are identical to ADR-0390. Required verification: Existing flag tests. Implementation: Not started; Independently verified: No.
- [ ] **SC-0414-08 - Staff flag permissions.** Acceptance: Roles hold exactly the flag permissions in §11B.9; AI Admin can change only `lucy.*`; Support overrides only inside its scope; kill switches are instant and alert Owners; broad rules become delayed actions; every change is audited. Required verification: Unit tests for roles and `may_change_flag`; integration tests for the admin flag service. Implementation: Not started; Independently verified: No.
- [ ] **SC-0414-09 - Labs opt-in.** Acceptance: Beta flags turn on for a user only when they opted in and every other layer allows it; a kill switch or rule always wins; the Labs list shows only betas the plan includes. Required verification: Property and integration tests; Playwright for the Labs setting. Implementation: In progress; preference persistence and account/Labs API routes exist with tests; the UI and real beta rollout remain. Independently verified: No.
- [ ] **SC-0414-10 - Every cloud feature flagged.** Acceptance: Each cloud feature has a registry flag; every cloud route and job type names its owning flag; the reflow sweep covers the cloud surfaces. Required verification: Registry test that no cloud route or job type lacks a flag; flag sweep in cloud mode. Implementation: Not started; Independently verified: No.

## [ADR-0415 - Playback devices and one session per account](adr-0415-playback-devices-and-sessions.md)

- [ ] **SC-0415-01 - Devices.** Acceptance: Registration, naming, list and sign-out work; the 11th device signs out the oldest. Required verification: Integration and Playwright tests. Implementation: Not started; Independently verified: No.
- [ ] **SC-0415-02 - Lease and remotes.** Acceptance: Commands from many remotes apply once and in order. Required verification: Concurrency test. Implementation: Not started; Independently verified: No.
- [ ] **SC-0415-03 - Transfer.** Acceptance: 'Play here' moves playback with no double audio. Required verification: Playwright multi-context test plus real devices. Implementation: Not started; Independently verified: No.
- [ ] **SC-0415-04 - Offline speaker.** Acceptance: A speaker that loses connection keeps playing; reconnect behaviour matches the rules. Required verification: Chaos test on real devices. Implementation: Not started; Independently verified: No.
- [ ] **SC-0415-05 - Device guidance.** Acceptance: iOS speaker warning and wake-lock request shown where relevant. Required verification: Manual device test. Implementation: Not started; Independently verified: No.

## [ADR-0416 - Rooms: Premium guest requests by QR code](adr-0416-rooms-guest-requests.md)

- [ ] **SC-0416-01 - Room lifecycle and codes.** Acceptance: Open, lock, rotate code, end, expiry and no-reuse rules work. Required verification: Integration tests. Implementation: Not started; Independently verified: No.
- [ ] **SC-0416-02 - Guest page.** Acceptance: Bundle under 100 KB of JavaScript; join, search, request, vote and status states pass on old phones and slow networks. Required verification: Playwright mobile emulation plus real phones. Implementation: Not started; Independently verified: No.
- [ ] **SC-0416-03 - Planner integration.** Acceptance: Room requests plan through the existing planner with round-robin across guests and the render cap. Required verification: Integration tests. Implementation: Not started; Independently verified: No.
- [ ] **SC-0416-04 - Moderation.** Acceptance: Approve, pass, remove, ban and lock behave as specified; banned guests' pending requests are withdrawn. Required verification: Integration tests. Implementation: Not started; Independently verified: No.
- [ ] **SC-0416-05 - Display pairing.** Acceptance: A paired display shows the QR, now playing and upcoming, and survives code rotation. Required verification: Playwright test. Implementation: Not started; Independently verified: No.
- [ ] **SC-0416-06 - Abuse and scale.** Acceptance: 1,000 joins in 10 s, request floods and code brute-forcing pass the Rooms stress scenarios. Required verification: Load and security tests. Implementation: Not started; Independently verified: No.
- [ ] **SC-0416-07 - Legal points.** Acceptance: Terms, guest privacy notice and Online Safety Act view recorded. Required verification: Legal review. Implementation: Not started; Independently verified: No.
