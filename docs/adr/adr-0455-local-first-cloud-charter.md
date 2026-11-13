# ADR-0455 - Local-first cloud charter and preservation boundary

- **Decision:** Accepted by owner (2026-11-13); implementation is not started.
- **Implementation:** 0/4 Implemented; 4/4 Not started.
- **Independent verification:** 0/4 Verified.
- **Programme/date/baseline:** Local-first cloud refactor (LF); 2026-11-13; `main` at `bfb2bd27938ac8b67e7d3e17125779cb092a8a3d`.
- **Existing ADR owners:** ADR-0025, ADR-0072, ADR-0391 through ADR-0454 remain historical; this decision supersedes their hosted-user-audio assumptions only.
- **Primary source touchpoints:** `src/selecta/api.py`, `src/selecta/api_cloud.py`, `src/selecta/storage/`, `src/selecta/workers/`, `web/src/cloud/`, `docs/saas/`.
- **Programme:** [Local-first roadmap](selecta-local-first-roadmap.md) and [checklist](selecta-local-first-implementation-checklist.md).

## Context and scope

The previously accepted cloud plan assumes R2 originals, derived media, signed playback URLs, hosted DSP workers and tier-weighted audio processing. The standalone local engine already supports analysis, mixing, seams, exports, stem editing and many other capabilities that must not be lost. Local execution reduces Selecta's direct handling of protected recordings; it does not make all copying, processing or public playback automatically lawful.

## Decision

1. Cloud infrastructure shall not accept, store, transmit, relay, decode, render, transcode, stem-separate, stream or distribute user audio unless an independently approved, explicitly licensed future media product is designed and separately gated. No covert audio path through AI, logs, backups or diagnostics.
2. Original music, stems, transition clips, exports, PCM, waveform reconstruction data and media caches remain under the authorised local engine's control.
3. Cloud owns identity, subscriptions, workspace-scoped catalogue metadata, versioned mix instructions, device and zone coordination, schedules, moderated requests, permitted AI planning, audit and operational status.
4. Preserve all current user-facing musical and UI capabilities unless an explicit parity record identifies a replacement, migration path, tests, and an approved retirement decision. An obsolete endpoint is not proof that its feature is obsolete.
5. Standalone local mode continues to operate without sign-in, cloud connectivity or telemetry.
6. No application or infrastructure change is authorised by this documentation-only PR. All implementation tasks begin Not started. Existing acceptance evidence and historical ADR statuses remain intact.

## Non-negotiable invariants

- Recipes sync; recordings do not. A portable recipe is not automatically playable on a different device.
- Playback readiness is device-local, versioned, policy-scoped and time-sensitive; an unreachable or stale device is never reported Ready.
- Offline venue playback does not depend on the control-plane API, and cloud authority is not falsely treated as physical audio-output authority during a partition.
- Local safety budgets protect CPU, GPU, RAM, disk and audio deadlines; cloud plans do not meter user-funded local analyses, seams, stems or exports.
- No unapproved substitutions, content-rule relaxation, deletion of source files, or destructive account-migration behavior.

## Acceptance and migration

First produce the cross-referenced feature inventory and cloud egress map. Then prove a synthetic two-device workflow: create a cloud recipe, identify media missing from one device, safely resolve a match and locally render/play with zero audio transfer. Refuse cutover if feature parity, privacy or legal release gates fail.

## Edge cases

- A cloud account is deleted while a standalone local library exists: cloud metadata and credentials follow the account-deletion policy; local originals are not deleted.
- A cloud outage during an open venue: local playback continues from authorised sources and cached programme rules.
- A media asset exists only on another computer: the remote device may control that speaker, but cannot silently start local audio.
- A paid plan is changed mid-render: the device-local render is not counted or stopped due to cloud compute quotas.

## Rejected alternatives

- Continue the music-locker architecture with a user-rights checkbox as the primary compliance control.
- Replace the mature local DSP engine with reduced-functionality browser-only playback before parity testing.
- Delete entire cloud subsystems before replacement, data migration and rollback gates pass.

## Implementation checklist - 0/4 Implemented; 0/4 independently Verified

1. **LF-0455-01 - Source and route inventory.** **Acceptance:** trace every existing capability and cloud media path to owning code and tests. **Required verification:** reviewed source map. **Implementation:** Not started. **Independently Verified:** No.
2. **LF-0455-02 - Boundary-enforced contracts.** **Acceptance:** no production cloud upload, stream or media-render path remains; negative tests cover alternate encoding, logs and AI tools. **Required verification:** unit, integration and network egress tests. **Implementation:** Not started. **Independently Verified:** No.
3. **LF-0455-03 - Preservation ledger.** **Acceptance:** each existing user-facing capability is kept or has an approved equivalent, migration and evidence. **Required verification:** complete parity matrix. **Implementation:** Not started. **Independently Verified:** No.
4. **LF-0455-04 - Independent gate.** **Acceptance:** legal and product review, two-device proof, local regression suite and rollback drill signed off before cloud audio retirement. **Required verification:** release-gate evidence. **Implementation:** Not started. **Independently Verified:** No.

## Governance

This ADR governs the new product direction; ADR-0391 and other older accepted cloud design records remain historically accurate for the system they originally specified. The supersession table is [here](selecta-local-first-overlap-and-parity.md).
