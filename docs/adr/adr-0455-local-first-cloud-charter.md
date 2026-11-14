# ADR-0455 - Local-first cloud charter and preservation boundary

> **Controlling browser-first update — 2026-11-14:** [ADR-0485](adr-0485-browser-first-cloud-and-ipad-venue-runtime.md) supersedes any mandatory Python/FFmpeg installer, native agent, separate venue computer, or guaranteed background/reboot browser playback in this historical decision. **Cloud runs DSP and plays locally in the supported browser** (including a venue's sole Android tablet or iPad; capable phones also render). Standalone Python Selecta remains independent. [Device/DSP feasibility](selecta-browser-device-capability-matrix.md) · [Full product/repository plan](selecta-browser-first-master-plan.md). Implementation status counts below are an older snapshot and do not certify browser parity; tests and real-device verification remain required.


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

1. Cloud is a **browser-native product**, with local media access, Web Audio/AudioWorklet playback, browser JS/WASM DSP and optional independently qualified WebGPU models. It must support real playing and rendering on capable phones/tablets and sole-iPad/sole-Android venue setups **without installing Python or owning a second computer**.
2. Cloud does not accept, store, proxy, process, stream, derive or log original/derived user audio, stems, PCM, rendered exports or reconstructible samples.
3. Cloud owns permitted metadata, identity, versioned recipes, billing, staff policy, Rooms, schedules, approved text/metadata AI planning, scoped browser control and audit.
4. Standalone Python/FFmpeg local mode remains a **separate, account-free, independently installable product**. Preserve native DSP musical outcomes by porting/testing them, not by making Cloud silently depend on Python.
5. Browser source access, codecs, model feasibility, storage eviction, battery/thermal throttling, user gesture, output routing, OS/browser background interruptions and foreground-only venue limitations are explicit device capability gates.
6. Actual physical speaker success is never inferred merely from a running Web Audio context or Cloud command acknowledgement.
7. No current Cloud customers need a speculative legacy audio-migration contract; retire obsolete hosted audio only after verifying repository/data/rights/security inventories and preserving existing standalone capability.
8. Enforce [ADR-0485](adr-0485-browser-first-cloud-and-ipad-venue-runtime.md) and its full device matrix wherever historical provisions disagree.

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
