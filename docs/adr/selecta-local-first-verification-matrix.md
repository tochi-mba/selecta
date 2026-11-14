# LF browser/DSP and physical-device verification matrix

**ADR-0485 runtime override:** Cloud is browser-native with **iPad and Android tablet venue playback**; native installer tests belong to separate standalone product, not Cloud acceptance. [Research](selecta-browser-device-capability-matrix.md).

**Status:** Plan accepted, **zero LF test outcomes verified**. All tests described here are requirements, not existing passing tests. Historical Selecta test claims remain intact in their original ADRs.

| Gate | Source/proposal | Required automated evidence | Required human/real device evidence |
|---|---|---|---|
| LF-V01 Cloud no-audio boundary | 0455,0457,0481 | No upload/proxy/remote-DSP routes; fuzz audio disguised as JSON and log attachments; infra/secrets inventory | Privacy/security review of actual staging egress |
| LF-V02 Standalone parity | 0456,0461 | Existing local unit/E2E, playback/exports/discovery, source stability | A/B musical listening against previous stable release |
| LF-V03 Browser player | 0461,0462,0485 | AudioWorklet/WASM, no native service, authenticated browser session, file permission and audio output checks | Clean Android/iPad tablet setup without another computer |
| LF-V04 Track identity | 0458 | Exact match, candidate/remaster/clean distinction, moved drive, duplicate occurrence | Manual alternate-master acceptance UX |
| LF-V05 Portable recipes | 0459,0460 | Two agents with divergent libraries; 5/8 available; immutable history; cache invalidation | User can open/edit mix without source; successful relink |
| LF-V06 Browser DSP work | 0463,0464,0465,0485 | JS/WASM ports of analysis/seams/stems/export with numerical and audible parity; no mandatory models | Desktop/Android/iPad CPU, thermal, RAM and output stress |
| LF-V07 Device takeover | 0466,0469 | Concurrent transfer, failed preflight, lost ack, network partition, fencing generation | Two actual speakers, audible double-playback assessment |
| LF-V08 Active tablet venue | 0467,0468,0485 | Browser offline while executing, DST, source/output state, Doze and app termination | Six-hour powered/awake actual iPad/Android sound; reboot requires safe user reactivation |
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
- Add a **browser AudioWorklet/DSP compatibility harness** and paired browser controllers; all test audio synthetic and internally created; keep native standalone harness independently.
- Inject network delay/drop, stale device heartbeat, clock changes, disk-full, corrupt media, failed child decoder, CPU saturation and power-restored checkpoints.
- Verify both route-level and process-level no-media egress. Do not accept only an assertion that a request has `content-type: application/json`.
- Capture actual audible-output evidence for supported venue hardware; active process/heartbeat is insufficient.
- Confirm every old route/feature has a successor E2E or an approved retirement record; no masking CI through `skip` or threshold relaxation.

## Required data per verification result

`task_id`, ADR, source commit, test name, environment, date, expected/actual result, evidence link, reviewer (different from implementer), residual risks, migration stage, next decision.

**No-go severity:** Any media egress bypass, wrong/unapproved master, false speaker readiness, split-brain audio, lost recipe, content-policy violation, silent source deletion or unreviewed customer R2 purge.

## Browser device qualification results required before release

| Test | Desktop browsers | iPadOS Safari/PWA | Android Chrome | Samsung Internet | Firefox Android | Budget Android/older iPad |
|---|---|---|---|---|---|---|
| File select/folder import/reauthorise | Required | Required | Required | Required | Required | Required |
| MP3/AAC/FLAC/WAV decode | Required | Required | Required | Required | Required | Required by declared capability |
| WebAudio worklet + audible transitions | Required | Required | Required | Required if supported | Required if supported | Required if advertised |
| Beat/key/time stretch/seam quality | Required by feature | Required by feature | Required by feature | Required by feature | Required by feature | Explicitly degraded or supported |
| Neural stems/word alignment | Benchmark, not blanket yes | Explicit capability gate | Explicit capability gate | Explicit capability gate | Explicit capability gate | Default unsupported until proven |
| Output and app interruption | Required | Silent-output/lock/AirPlay/BT | Doze/audio focus/BT/USB | Samsung OEM and BT/USB | Android Firefox focus | Thermal/eviction |
| Venue six-hour real sound | Where sold | **Mandatory** | **Mandatory** | Before qualifying for venue | Before qualifying for venue | Before qualifying for venue |

No row is passing without recorded actual browser version, device model, OS, RAM/output, test fixture, result and independent reviewer.
