# LF verification matrix and source-to-test contract

**Status:** Plan accepted, **zero LF test outcomes verified**. All tests described here are requirements, not existing passing tests. Historical Selecta test claims remain intact in their original ADRs.

| Gate | Source/proposal | Required automated evidence | Required human/real device evidence |
|---|---|---|---|
| LF-V01 Cloud no-audio boundary | 0455,0457,0481 | No upload/proxy/remote-DSP routes; fuzz audio disguised as JSON and log attachments; infra/secrets inventory | Privacy/security review of actual staging egress |
| LF-V02 Standalone parity | 0456,0461 | Existing local unit/E2E, playback/exports/discovery, source stability | A/B musical listening against previous stable release |
| LF-V03 Local engine installer | 0461,0462 | Pairing, origin/host, install/update/rollback/revocation | Windows and Linux mini-PC reboot/OS permissions |
| LF-V04 Track identity | 0458 | Exact match, candidate/remaster/clean distinction, moved drive, duplicate occurrence | Manual alternate-master acceptance UX |
| LF-V05 Portable recipes | 0459,0460 | Two agents with divergent libraries; 5/8 available; immutable history; cache invalidation | User can open/edit mix without source; successful relink |
| LF-V06 Local work | 0463,0464,0465 | Analysis/seams/stems/export and atomic cache under CPU/GPU/disk faults | Long local render with concurrent audio output |
| LF-V07 Device takeover | 0466,0469 | Concurrent transfer, failed preflight, lost ack, network partition, fencing generation | Two actual speakers, audible double-playback assessment |
| LF-V08 Offline venue | 0467,0468 | DST/overnight, offline commands, play-log dedupe, local output readiness | Six-hour offline audio continuity, power-cycle recovery |
| LF-V09 Plans | 0470,0471 | No local DSP quotas; historic plan version; Stripe reconciliation; AI cost guards | Billing and rights/benefit copy approval |
| LF-V10 Lucy | 0472 | No audio/path/lyrics payload; prompt-injection defence; local tool authorization | Model quality and user comprehension |
| LF-V11 Rooms | 0473 | Local eligible catalogue, moderation, cloud accepted vs applied, request flood | Guest phone QR workflow and staff usability |
| LF-V12 Business | 0474,0478 | Twenty-venue mixed inventory, policy, seats, venue catalogue, roles | Venue onboarding, HQ readiness and staff action drills |
| LF-V13 Legal | 0475 | Licence register, model allowlist, distribution audit | UK music/IP and model/software counsel review |
| LF-V14 Migration | 0480 | Historical virtual revisions, idempotent backfill, customer archive, restore/no resurrected upload | Legacy customer rights and retrieval approval |
| LF-V15 Service sunset | 0481 | Removed route/service/secret/worker manifests and negative storage tests | Staging/prod infra inventory and spend reconciliation |
| LF-V16 UX | 0476-0478 | All states at 320/375/768/1280 px, keyboard, 400% zoom, screen-reader and reduced-motion | Nontechnical first-run and venue-operator usability |
| LF-V17 Flags and rollback | 0483,0484 | Feature owner/route audit, flag off, partial rollout, compatibility, rollback | Independent go/no-go sign-off |

## Tools and fixtures

- Preserve existing Python, PostgreSQL/RLS, CodeQL, Vitest, Playwright and feature-sweep jobs.
- Add a local-engine harness with isolated filesystems and paired control devices; all test audio synthetic and internally created.
- Inject network delay/drop, stale device heartbeat, clock changes, disk-full, corrupt media, failed child decoder, CPU saturation and power-restored checkpoints.
- Verify both route-level and process-level no-media egress. Do not accept only an assertion that a request has `content-type: application/json`.
- Capture actual audible-output evidence for supported venue hardware; active process/heartbeat is insufficient.
- Confirm every old route/feature has a successor E2E or an approved retirement record; no masking CI through `skip` or threshold relaxation.

## Required data per verification result

`task_id`, ADR, source commit, test name, environment, date, expected/actual result, evidence link, reviewer (different from implementer), residual risks, migration stage, next decision.

**No-go severity:** Any media egress bypass, wrong/unapproved master, false speaker readiness, split-brain audio, lost recipe, content-policy violation, silent source deletion or unreviewed customer R2 purge.
