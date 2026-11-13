# Local-first cloud refactor (LF) - accepted architecture and roadmap

**Decision:** Owner accepted ADR-0455 through ADR-0484 on 2026-11-13. **Implementation:** All new LF tasks Not started. **Baseline:** `main` at `bfb2bd27938ac8b67e7d3e17125779cb092a8a3d` (PR #56 merged). **Change scope of this PR:** Markdown documentation only; zero application, test, configuration, deployment or data changes.

## Purpose and hard boundary

Keep the complete intelligent DJ experience while moving every user-audio action to a user-controlled, authorised local engine. The cloud becomes identity, subscription, recipe, schedule, catalogue-metadata, room, AI-planning and device-control infrastructure. This reduces Selecta's direct audio custody; it does not alone establish the legality of source copies, public performances, stems or exports. A UK music/IP review and software/model distribution review remain required before commercial use.

- **Preserve:** analysis, library, lyric discovery subject to rights, advanced transitions, seam repair, stem studio, timeline, drafts, render line, freeze/version/export, requests/bridges, Lucy, remote devices, rooms, venue autopilot, HQ/zone/staff flows, role isolation, accessibility and offline standalone mode.
- **Change ownership:** audio originals, decoding, rendered transitions, waveform samples, stems, cache and exports are local; cloud stores neither user music nor a playable audio proxy.
- **Device truth:** saved recipe is not playable until a target local device validates exact recording, source access, policy, engine and audio output. Remote phone may control another device without receiving audio.
- **Cloud ACK not playback success:** command states explicitly distinguish queued/delivered/applied; offline partition cannot be claimed safe merely because a database lease expired.
- **Separate:** hard content/licence rules, plan entitlements, user/role permissions, feature flags, hardware capability and per-device media availability.

## Phases and dependency gates

| Phase | Output | Cannot start irreversible next phase until |
|---|---|---|
| LF0 inventory/legal | Original route->UI->job->storage inventory; feature parity; media egress inventory; licensing questions | Every currently visible feature mapped, owners assigned, data/rights risk reviewed |
| LF1 local engine | Installable supervised Windows/Linux, macOS target; discovery, paired credentials, signed updater, local diagnostics | Standalone mode unaffected; real audio playback, restart and safe output tests |
| LF2 canonical catalogue | Stable workspace recording IDs; verified per-device bindings; portable immutable recipe revisions; matching and missing media UI | Two-device 5/8 case does not overwrite original and never falsely marks Ready |
| LF3 local workloads | Durable local scheduler, native DSP analysis/seams/stems/exports, provenance and disk cleanup | Local audio parity, isolation, atomics, resource pressure and no cloud audio egress tests pass |
| LF4 control sync | Outbound authenticated device channel, scoped commands, ACK, idempotency, offline journal and safety fencing | Partition/takeover crash matrix green; existing speaker is not cut off on failed preflight |
| LF5 personal UI/billing | Device-first onboarding, library/editor/player/recipe repair, plan v2, old plan translation | Full route parity and accessible state/plan testing |
| LF6 venue | Local zone audio process, hours/dayparts, real output status, HQ per-venue readiness, staff/guest UIs | Physical speaker and six-hour offline soak; rights and content policies verified |
| LF7 hosted-audio sunset | Customer retrieval, migrations, blocked legacy upload paths, retire gateway/Modal/R2 audio and backups | Signed data migration + legacy rights and retention decisions + rollback |
| LF8 release | Independent verification, threat model, licences, cost model, pilot then commercial gate | Evidence and go/no-go under ADR-0484 |

## Workstream ownership

| Workstream | Main ADRs | Current source evidence | New acceptance |
|---|---|---|---|
| Data egress and legal | 0455,0457,0475 | `storage/api.py`, `storage/playback_api.py`, `workers/engine_handlers.py` | Zero user audio in cloud API, objects, AI/logs |
| Local runtime | 0456,0461,0462 | `api.py`, `modes/core.py`, `dev.cmd` | Safe installation, pairing, upgrade, standalone parity |
| Media/recipe | 0458-0460,0477 | `cloud_mixes.py`, `mix_contract.py`, `MakeCloudMix.tsx` | Immutable recipes, missing media resolution, invalidated cues |
| DSP/local work | 0463-0465 | `work/`, `workers/`, `seams.py`, `stems.py` | Local-first renders, playback priority, export parity |
| Device/playback | 0466-0469 | `playback/`, `CloudTransportDock.tsx`, `useCloudPlayer.ts` | Owner fencing, command ACK, offline continuity |
| Plans/rooms/AI | 0470-0473 | `billing/plans.py`, `usage/`, `rooms/`, `ai/` | No artificial local-DSP quotas, guarded cloud cost |
| Business | 0467,0468,0471,0474,0478 | `business/`, `kiosk/audio.ts`, `OrgLibrary.tsx` | Venue library/source truth, real player health |
| Sunset/release | 0479-0484 | `infra/modal/`, `infra/r2/`, `infra/render/` | Services/secrets removed without data loss |

## Execution contract

1. Build successor path and synthetic end-to-end proof before retiring any old route.
2. Old and new metadata contracts may coexist temporarily; no silent resurrection of user-audio upload on production.
3. Every task uses stable `LF-xxxx-xx` ID, names actual tests, has independent verification, and is not ticked without evidence.
4. Keep old ADR statuses, signed user histories and current code intact until individually verified implementation work.
5. Baselines and estimated capacity are hypotheses, not evidence. Real devices, lawyers and target venues decide go/no-go.

**Navigation:** [ADR list](selecta-local-first-overlap-and-parity.md) · [Checklist](selecta-local-first-implementation-checklist.md) · [Source map](selecta-local-first-source-map.md) · [API contract](selecta-local-first-api-contracts.md) · [UX matrix](selecta-local-first-ui-state-matrix.md) · [Edges](selecta-local-first-edge-case-catalog.md) · [Release gates](selecta-local-first-release-gates.md).
