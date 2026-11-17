# ADR-0456 - Hosted media mode: preservation and per-account flag gating

- **Decision:** Accepted (owner, 2026-11-17).
- **Implementation:** 0/8 Not started.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Browser-first Cloud (BF); 2026-11-17; `main` at `7d7f7932`.
- **Priority / phase:** P1 / Phase BF0. **Owner:** Unassigned. **Implementing PR/SHA:** None yet.
- **Existing ADR owners:** ADR-0396 (worker gateway and pools), ADR-0397 (object storage layout), ADR-0398 (upload protocol and quota reservations), ADR-0399 (cloud playback proxies), ADR-0409 (hosting topology): content unchanged, scope narrowed to accounts holding `cloud.hosted_media`. ADR-0390 (flags), ADR-0414 (targeting), ADR-0402 (plans): unchanged and relied on. Sibling BF ADRs: ADR-0455, ADR-0464, ADR-0465.
- **Source touchpoints:** `src/selecta/flags/cloud.json` (new `cloud.hosted_media`; `cloud.uploads` gains `requires`); `src/selecta/api_cloud.py` (account middleware, ~lines 313-349); `src/selecta/storage/` (api, uploads, parts, sandbox); `src/selecta/routes/cloud_assets.py`; `src/selecta/storage/playback_api.py`; `src/selecta/routes/cloud_proxy.py`; `src/selecta/work/catalogue.py`; `src/selecta/work/flag_gates.py`; `src/selecta/routes/cloud_export.py`; `src/selecta/usage/quota.py`; `infra/modal/selecta_workers.py`.
- **Proposal chapter:** [docs/saas/05-storage-uploads-playback.md](../saas/05-storage-uploads-playback.md) and [docs/saas/11b-feature-flags.md](../saas/11b-feature-flags.md).

## Context and evidence boundary

The hosted media plane on `main` is complete and tested: multipart uploads the server completes (`storage/uploads.py`), R2 key layouts (`storage/keys.py`), sandboxed validation, lazy playback proxies (`routes/cloud_proxy.py`, `work/proxies.py`), Modal worker pools idling at zero (`infra/workers/pools.json`), and quota accounting. All of its 13 upload, asset and playback routes are already owned by one release flag, `cloud.uploads`, which every plan currently includes (`EVERY_PLAN` in `src/selecta/billing/plans.py`). The per-account enforcement layer exists too: the `api_cloud.py` account middleware applies `cloud_gate.require` to every non-core route, and ADR-0414 targeting supports user and workspace id-list rules, admin "Preview on my account" and kill switches. `tests/test_cloud_flag_gate.py` already proves a USERS rule can refuse `cloud.uploads` for exactly one account with 403 `flag_off`.

What does not exist is a distinction between an account that may use hosted media and one that may not: today the plan layer grants it to everyone. The owner's decisions on 2026-11-17: hosted mode is kept, it is admin-granted only (never a plan line or paid add-on), the gate blocks new uploads and hosted processing only, and media already uploaded stays playable and exportable so nobody's library goes dark.

Nothing in this ADR is implemented. Job re-pointing (BF-0456-03) touches core-flag mappings and must be approached as carefully as the evidence demands.

## Decision

- **New umbrella flag `cloud.hosted_media`** (cloud mode, `kind: release`, owner `playback`). The build ships it on, because ADR-0414's layer order never lets rules grant what the build denies: a build-off default would make per-account grants impossible. The effective per-account default off is the rules' job, created at cutover as the USERS and WORKSPACES allowlist followed by a mandatory catch-all off rule; until those rules exist behaviour is exactly today's. It is the single grant for hosted media. Enablement is per account or workspace through ADR-0414 rules (USERS and WORKSPACES id lists), admin "Preview on my account" for staff QA, and nothing else. It is never attached to a plan: flags must not become entitlements (docs/saas/11b-feature-flags.md, key rule), and hosted mode is not sold.
- **Gate scope: writes and processing, not reads.** `cloud.uploads` gains `requires: ["cloud.hosted_media"]`, so with the grant absent every upload route answers 403 `flag_off` and upload surfaces reflow away (ADR-0390 `when_off`). Asset listing, playback URLs, playback proxies for already-stored assets, deletion and account export stay reachable for any account that has assets, so existing libraries keep playing. An account with no assets and no grant simply never sees a hosted surface.
- **Hosted jobs move off core flags.** `work/catalogue.py` currently maps `analyse.song`, `seam.render` and `export.render` to core flags, which cannot be targeted per account. Hosted-media job admission is re-pointed to `cloud.hosted_media` for new work, with `work/flag_gates.py` drain and stop semantics applying on revocation. `play.proxy` stays admissible for assets that already exist, because playback of stored media is not gated.
- **No retirement.** This programme contains no task that deletes media, empties R2, shuts worker pools or removes hosted code. Worker pools already scale to zero when idle; keeping the plane costs storage plus near-zero compute (ADR-0464 carries the economics). ADR-0396 to ADR-0399 and ADR-0409 remain the authority on how the plane works; from this ADR on they describe the hosted-flag mode.
- **Grandfathering** is one targeting rule granting `cloud.hosted_media` to every account that has ever completed an upload, created before the local-first default flips (ADR-0465, ADR-0467).

## User outcome and acceptance contract

An account the owner has granted hosted mode notices nothing: uploads, analysis, mixes and playback behave exactly as before. An account without the grant sees a Cloud with no upload surface anywhere, and if it has stored media from the past, that media still lists, plays and exports. Revoking the grant stops new uploads and new hosted processing at once, drains queued hosted jobs per flag-gate semantics, and leaves stored media playable.

## Edge cases

- **Revocation mid-upload.** A multipart upload in flight when the grant goes: the next part or the completion call answers 403 `flag_off`; the quota reservation is released by the existing abandoned-upload cleanup; no partial asset becomes playable.
- **Revocation with queued jobs.** Queued `analyse.song` or `export.render` jobs for the account drain or stop per `work/flag_gates.py`; finished artifacts remain; no job silently runs after revocation.
- **Over-quota flag-off account.** `over_quota_read_only` still applies: the account can play, export and delete but not add, which is already the gate's behaviour; the two states must compose without contradictory messages.
- **A Room hosted by a flag-off account with stored media.** Guests keep requesting from the already-stored catalogue; nothing in the guest flow consults the grant.
- **Kill switch.** An `cloud.hosted_media` kill switch stops uploads and hosted processing for everyone, including grandfathered accounts, and wins over every other rule (ADR-0414 semantics); playback of stored assets is untouched because it is not under the flag.
- **Admin preview expiry.** A staff preview of the grant expiring mid-session behaves like revocation: the SSE `flags.changed` event reflows the surfaces.
- **Account export with no originals.** `routes/cloud_export.py` sits under the core flag `account.data_export` and cannot be gated; it gains a branch that produces a metadata-and-recipes archive when the account has no stored originals.

## Rejected alternatives

- **Renaming `cloud.uploads` to `cloud.hosted_media`.** A rename breaks the 13 route registrations, the `flags.cloud.ts` Playwright surface sweep and 24 test files asserting the flag id, for no behavioural gain. The `requires` edge expresses the same thing additively.
- **Gating playback of stored media too.** Rejected by the owner: it would dark existing libraries on flag day and make revocation punitive. Storage cost continues either way; playback adds near-zero cost (lazy proxies are cached derived artifacts).
- **Selling hosted mode as a plan or add-on.** Rejected by the owner for now; revisit only as a new ADR. Keeping it a grant keeps flags out of entitlements and the plan catalogue untouched (ADR-0464).
- **A separate hosted deployment.** Splitting hosted accounts onto their own stack doubles operations for a shrinking population and breaks shared Rooms and billing. Per-account flags on one deployment are already enforced by middleware.

## Implementation checklist - 0/8 Not started; 0/8 independently Verified

1. **BF-0456-01 - Register the grant.** **Acceptance:** `cloud.hosted_media` registered in `src/selecta/flags/cloud.json` (cloud mode, release, default off); `cloud.uploads` gains `requires: ["cloud.hosted_media"]`; `docs/flags.md` regenerated; registry validation passes. **Required verification:** `tests/test_flags.py`, `tests/test_cloud_targeting_registry.py`. **Implementation:** Not started. **Independently Verified:** No.
2. **BF-0456-02 - Route audit: writes gated, reads open.** **Acceptance:** With the grant absent, every upload route (`/api/uploads*`) answers 403 `flag_off`; asset listing, playback-url, playback-proxy, delete and export routes keep working for stored assets; a table in the test enumerates all 13 routes with their expected behaviour. **Required verification:** Extensions to `tests/test_cloud_flag_gate.py`, `tests/test_cloud_upload_api.py`, `tests/test_cloud_storage_playback.py`. **Implementation:** Not started. **Independently Verified:** No.
3. **BF-0456-03 - Job catalogue re-pointing.** **Acceptance:** New `analyse.song`, `seam.render` and `export.render` admission for hosted media requires the grant; `play.proxy` for stored assets does not; `work/flag_gates.py` drains queued hosted jobs on revocation; local-first accounts enqueue no hosted job types at all. **Required verification:** `tests/test_cloud_jobs_flag_gates.py`, `tests/test_cloud_jobs_claim.py`. **Implementation:** Not started. **Independently Verified:** No.
4. **BF-0456-04 - Targeting playbook.** **Acceptance:** A documented, tested recipe: grant one account (USERS rule), grant one workspace, staff preview with expiry, kill switch; each verified through the admin explain endpoint; recorded in the admin runbook. **Required verification:** `tests/test_cloud_flag_rules*.py` additions plus a doc review. **Implementation:** Not started. **Independently Verified:** No.
5. **BF-0456-05 - Reflow sweep.** **Acceptance:** With the grant absent no hosted surface, menu entry, hero or wording renders anywhere in Cloud (home, library, settings); `web/e2e-cloud/flags.cloud.ts` gains the new flag in its surface sweep; 320 px and both themes covered. **Required verification:** Playwright cloud sweep. **Implementation:** Not started. **Independently Verified:** No.
6. **BF-0456-06 - Meters without hosted storage.** **Acceptance:** Storage meters and over-quota UI show a truthful "no hosted storage" state for accounts without the grant and without assets, and the normal meters for accounts with stored media; no meter invents a zero-byte quota warning. **Required verification:** Vitest on `web/src/cloud` meters, `tests/test_cloud_account_meters.py`. **Implementation:** Not started. **Independently Verified:** No.
7. **BF-0456-07 - Export without originals.** **Acceptance:** `GET /api/account/export` produces a complete metadata, settings and recipes archive for accounts with no stored originals, and the full archive with originals where they exist; the archive documents which form it took. **Required verification:** `tests/test_cloud_account_export.py`. **Implementation:** Not started. **Independently Verified:** No.
8. **BF-0456-08 - Revocation drill.** **Acceptance:** A scripted drill grants, uses, then revokes the flag on a seeded account: in-flight upload refused, queued jobs drained, stored media still playing, SSE reflow observed; the drill is repeatable in CI against the e2e cloud server. **Required verification:** An integration test over `tests/e2e_cloud_server.py`. **Implementation:** Not started. **Independently Verified:** No.

## Governance

Accepted by the owner on 2026-11-17: hosted mode preserved, admin-granted only, gate on writes and processing only. Any future retirement, sale or plan attachment of hosted mode needs a new ADR; nothing here authorises data deletion, R2 purges, worker shutdown or price changes.
