# LF source map and replacement ownership

**Baseline:** `main` `bfb2bd27938ac8b67e7d3e17125779cb092a8a3d`, source inspected 2026-11-13. This is a design inventory, not proof of runtime behavior. No code in this PR changes.

| Existing owner | Existing behavior or assumption | Future owner / disposition | Cross-check |
|---|---|---|---|
| `src/selecta/api.py`, `api_common.py` | Standalone local API, folder watch, analysis, playback | Keep as local engine core | 0455,0456,0461 |
| `src/selecta/api_cloud.py` | Cloud identities, routes, uploads, billing | Keep control plane, remove hosted media routes | 0455,0457,0469 |
| `src/selecta/modes/core.py` | local/cloud process selector | Retain startup selector; add capability+connectivity+workspace axes | 0456 |
| `src/selecta/storage/api.py` | Multipart audio R2 upload and quota reservations | Sunset after data/compatibility gates; new local source registration | 0457,0480 |
| `src/selecta/storage/uploads.py`, `parts.py` | Multipart plan, transfer, reserve, accept | Retire hosted audio entry; never used to push music to server | 0481 |
| `src/selecta/storage/playback_api.py` | Signed original/derived playback URLs | Retire; player uses local media binding | 0462,0481 |
| `src/selecta/routes/cloud_proxy.py` | Cloud `play.proxy` prepare/status | Replace with device-local preparation/ready state | 0464,0481 |
| `src/selecta/workers/audio_handlers.py` | FFmpeg cloud proxy | DSP code reusable locally; remote job entry retired | 0463,0464 |
| `src/selecta/workers/engine_handlers.py` | Cloud analysis, `seam.render`, `export.render` | Keep DSP algorithms, run local; no cloud scratch/download/publish | 0463,0464 |
| `src/selecta/work/`, `scheduling/` | Leases, lanes, worker claims, provenance | Keep local durable work/provenance; retire hosted fair share and worker gateway | 0463 |
| `src/selecta/work/gateway_api.py`, `workers/cloud.py` | Hosted worker protocol | Retire after local capability proven | 0481 |
| `src/selecta/work/autoscale*.py` | Modal CPU/GPU autoscaling | Retire hosted DSP autoscaler | 0481 |
| `src/selecta/cloud_mixes.py`, `mix_contract.py` | Protected virtual revision artifacts referring to uploaded cloud assets | Preserve immutable recipe work; canonical recording refs and local bindings | 0458-0460 |
| `src/selecta/routes/cloud_mixes.py` | Make/edit/read cloud mix | Retain cloud recipe API as metadata only | 0459,0460 |
| `src/selecta/routes/cloud_export.py` | Cloud ZIP copies original uploaded audio | Replace with metadata-only account export, separate local file export | 0465,0480 |
| `src/selecta/playback/` | Device registration, 20s owner lease and commands | Keep authority model; add preflight and partition-safe takeover | 0466,0469 |
| `src/selecta/rooms/`, `requests.py` | Guest request intake and planning | Keep, require local zone media/policy ACK | 0473 |
| `src/selecta/autopilot/`, `business/` | Schedules, zones, content, rights, offline | Keep intelligence; execute offline on venue local engine | 0467,0468,0474 |
| `src/selecta/billing/plans.py` | Storage/CPU/stems/renders/exports/AI quotas | Version plans, remove hosted music/DSP quotas; keep paid services | 0470,0471 |
| `src/selecta/usage/` | GB, CPU, AI ledgers | Retire music usage meters, preserve hosted AI/billing metrics | 0470 |
| `src/selecta/ai/`, `lucy/` | Hosted planning and tools | Keep AI planning on permitted metadata; audio tools local | 0472 |
| `web/src/cloud/CloudApp.tsx` | '10 GB of private music storage', upload nav | Rebuild device-aware onboarding, nav/copy, plan cards | 0476 |
| `web/src/cloud/Uploads.tsx`, `uploadParts.ts` | Multipart uploader and resume | Replace with local source linking and scan feedback | 0476 |
| `web/src/cloud/Library.tsx`, `Meters.tsx`, `Billing.tsx` | Hosted assets, GB meter, plan descriptions | Local library availability, device resources, updated plan entitlements | 0476,0477 |
| `web/src/cloud/useCloudPlayer.ts` | Remote proxy polling and signed URL refresh | Local speaker controls and per-device readiness | 0466,0476 |
| `web/src/cloud/CloudTransportDock.tsx` | Shared player/media focus | Preserve single audio focus, add remote-vs-local control distinction | 0466 |
| `web/src/cloud/MakeCloudMix.tsx` | Cloud mix from hosted asset IDs | Portable recipe + missing-media repair | 0459,0477 |
| `web/src/kiosk/audio.ts` | `stubAudio()` unlock test; `savedHoursAhead() = 0` | Replace with real supervised local zone engine and truthful output state | 0467,0478 |
| `web/src/business/library/OrgLibrary.tsx` | Organisation's remotely available songs | Catalogue metadata and per-venue inventory/readiness | 0474,0478 |
| `web/src/business/console/`, `staff/` | HQ and staff remote views | Keep and add hardware/source readiness/recovery | 0478,0479 |
| `infra/modal/selecta_workers.py` | Hosted CPU/GPU and export functions | Retire after cutover | 0481 |
| `infra/workers/pools.json`, `services/worker/` | Hosted compute capacity/images | Retire hosted deployment; local runtime packaging independent | 0481 |
| `infra/render/render.yaml` | API, gateway, maintenance | Keep API/metadata maintenance; remove audio gateway and creds | 0481 |
| `infra/r2/lifecycle.tf.json` | Originals/derived/export/staging lifecycle | Retire audio buckets, retain only justified non-audio object storage | 0480,0481 |
| `infra/backup/copy_originals.sh` | Offsite user audio replication | Sunset only after legacy retention/data migration | 0480,0481 |
| `.github/workflows/*`, `docs/flags.md` | CI, deployments, route flag catalogs | Replace obsolete jobs with full parity/local-agent/fleet tests; regenerate after code | 0482,0483 |

## Ownership boundaries

- **Cloud:** account, workspace and subscription, immutable recipe documents, permitted metadata, command/outbox, venue/zone configuration, guest requests, AI cost, audit and privacy-safe diagnostics.
- **Local:** media paths, full hashes and fingerprints, waveform/PCM, audio features, analysis, playback, source permissions, local work queue, cache, stems, exports and offline play journal.
- **Derived remote summaries:** minimal opt-in catalogue fields, availability status with freshness, engine capabilities, zone/audio health, relevant play-log events.

## Audit tasks

Missing source files, live route inventories and third-party services must be verified during LF-0455-01 before implementation. Do not assume this table is a complete automated call graph. [Parity](selecta-local-first-overlap-and-parity.md) · [Service retirements](selecta-local-first-service-retirement.md).
