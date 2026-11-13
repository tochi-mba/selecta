# Selecta Local-First Cloud architecture

**Accepted owner decision:** 2026-11-13. **Implementation:** Not started. Baseline main at bfb2bd27938ac8b67e7d3e17125779cb092a8a3d. This chapter supersedes conflicting hosted-user-audio target assumptions in previous SaaS chapters. Historical implementation evidence is preserved.

## Product contract

Selecta becomes an intelligent local engine that DJs authorised recordings, connected to a cloud platform for accounts, metadata, saved mix recipes, AI planning, Rooms, remote device commands, venue scheduling, subscriptions and audit. Original files, audio bytes, stems, rendered transitions, PCM, exports, playback proxies and raw local media paths do not go to hosted systems.

Moving processing locally reduces Selecta's direct audio custody but does not automatically authorise copies, stems, exports or public performances. Specialist UK music/IP and software/model distribution review is an independent launch gate.

## Deployment map

| Unit | Audio ownership | Functions |

|---|---|---|

| Selecta Local Engine on Windows/Linux/macOS target hardware | User-controlled local files and caches | Indexing, analysis, beats, stems, seams, exports, audio output, local jobs, offline venue scheduling |

| Personal/browser/venue UI | None unless actual local engine attached | Browse catalogue, edit recipes, pair speaker, control output, manage venues |

| Hosted control API | No music or audio processing | Auth, tenancy, recipes, AI plan routing, business policy, rooms, device commands, billing, audit |

| PostgreSQL metadata DB | No original or derived audio | Tenant-scoped catalogue IDs, immutable recipe revisions, device registration, commands, schedules, play logs |

| WorkOS, Stripe, approved hosted AI | No audio | Identity, billing and bounded metadata-only intelligence |

| Optional non-audio object storage | No music | DB backups, audit retention and approved venue logos |

## Runtime dimensions

Separate audio capability (local engine or controller-only), network state (online/degraded/offline), and workspace (standalone personal, connected personal or organisation). Do not imply that cloud mode executes DSP on the server. Standalone local mode remains login-free.

## Canonical recordings and portable mix recipes

Cloud recipe references workspace-scoped canonical recording IDs and stable occurrence IDs, never filesystem paths or R2 audio objects. Every device independently maps a reference to an exact verified local recording. Same artist/title or ISRC alone is not sufficient. Alternate remasters, clean edits and radio edits require verification and may invalidate every dependent cue/seam.

Each recipe is an immutable version with parent history, ordered occurrences, requested transition techniques, timebase, engine requirements and policy. Local assets are recorded with content revisions, analysis/render/model versions and checksums.

Availability is per target device, recipe revision and policy, with last-verification freshness. Ready, needs-analysis, candidate-match, missing, source-disconnected, permission-required, unsupported, version-mismatch, policy-blocked, engine-offline, unknown and cache-invalid are distinct. A cloud-saved recipe is not proof it can play anywhere.

Repair actions: control a device that already has audio, locate local files, reauthorise source, approve verified equivalent, create a temporary variation or save a new revision without touching original history.

## Local execution and audio reliability

Keep the existing planner, seam repair, manual timeline, stem studio, requests/bridges, drafts and render line, valid FLAC export and blind listening features. Local priority protects imminent audio, then near-term seams, requests, editing, analysis and speculative discovery. Safety limits arise from actual CPU, GPU, RAM, disk, thermal state and multi-zone output, not from cloud processing tier.

Local venue players use the existing committed/prepared/planned horizon idea, but prepare seams locally from locally authorised files instead of downloading four-hour R2 audio bundles. They cache schedules, time-zone rules, content policy, rights permits, playback checkpoints, prepared transitions and offline play logs. Actual output monitoring, not browser AudioContext unlock, determines readiness.

## Device control and takeover

Agent establishes outbound authenticated control channel, avoiding public filesystem APIs. Commands carry actor/tenant/zone scope, operation ID, expected generation/revision, expiry and stable acknowledgement states. Cloud queued does not mean local executed.

Takeover must preflight current and near-future recordings and audio output, prepare destination, fence old owner, confirm safe release and only then start new speaker. An offline venue speaker may remain audible despite stale cloud lease; unsafe remote takeover is refused unless confirmed physical isolation resolves the partition.

## Plans and services

New plan versions remove hosted music GB, upload-size limits, daily analysis, cloud render concurrency and CPU weights, local stem-preview/export caps and cloud media retention. Preserve subscriptions to remote devices, synced recipes, Rooms, business venues/zones/seats, support and metered hosted AI.

Retire Modal DSP functions, worker gateway, R2 originals/derived/exports/staging and music backups only after successor parity, user-data retrieval, retention, backups and legal sign-offs. Keep API, Postgres/RLS, identity, billing, email, control events, hosted AI and non-audio backups.

## Hard gates

No cloud-audio egress; two isolated devices with a saved eight-track recipe and three missing/alternate recordings; safe playback takeover; local audio-engine and editor parity; six-hour offline real venue test; security, billing, migrations, human usability, licensing and independent review.

**Navigation:** [Roadmap](../adr/selecta-local-first-roadmap.md) · [Source map](../adr/selecta-local-first-source-map.md) · [UX matrix](../adr/selecta-local-first-ui-state-matrix.md) · [API contract](../adr/selecta-local-first-api-contracts.md) · [Migration](22-local-first-transition.md).
