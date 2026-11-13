# LF supersession map and feature-preservation contract

**Authority:** ADR-0455 through ADR-0484 accepted 2026-11-13. Existing accepted ADRs document historical intent and remain unchanged until implementation evidence is independently reconciled. A later local-first decision supersedes only a conflicting hosted-audio assumption, not the user's completed functionality.

## Existing ADR conflict map

| Prior ADRs | Status in history | New source of truth | Treatment |
|---|---|---|---|
| 0025, 0072, 0391 | Accepted local guarantees and cloud plan | 0455,0457 | Preserve standalone privacy; replace hosted-audio allowance |
| 0392,0393 | Two runtime modes and tenancy | 0456,0458,0480 | Keep multi-tenant metadata DB; separate audio capability/device |
| 0394,0395,0396 | Durable jobs, tier fairness, gateway/worker pools | 0463,0469,0481 | Preserve local durable work; replace cloud DSP scheduler |
| 0397,0398,0399 | R2 user originals/derived/exports, uploads, playback proxy | 0457,0464,0465,0480,0481 | Sunset remote audio data plane after migration |
| 0400,0401,0403,0414 | Identity, RBAC, Stripe, flags | 0462,0470,0471,0483 | Preserve; adapt actor/device/capability boundaries |
| 0402 | Storage/compute quotas by plan | 0470,0471 | New versioned feature/cloud-AI benefits; no local DSP tax |
| 0404,0405,0406 | AI and music-model/lyrics rights | 0472,0475 | Local execution; remote metadata and distribution licence review |
| 0407-0413 | Events, admin, infra, privacy, legal | 0457,0469,0479-0482 | Preserve metadata governance; remove hosted media terms |
| 0415-0419 | Device, Rooms, cloud mixing, single owner | 0458-0460,0466,0469,0473 | Make portable recipe and safe per-device audio true |
| 0420-0423 | Cloud UI and saved-mix state | 0476,0477 | Replace upload UX and false playback assumptions |
| 0424-0440 | Autopilot and resident DJ | 0463,0467,0468,0472,0474,0478 | Preserve musical decisions, deadlines, fallback and learning |
| 0441-0454 | Business venues and operations | 0467,0468,0471,0474,0475,0478 | Keep business functionality; venue-local media, separate licences |

## Feature parity matrix

| Current capability | User outcome that must survive | Owner | Gate |
|---|---|---|---|
| Local folders, scan, watchers and corrections | Any supported local collection remains browseable/recoverable | 0458,0461 | Local scan + external drive recovery |
| BPM, key, analysis and discovery | Full musical analysis works without remote DSP | 0463,0464,0475 | Synthetic + listening metrics |
| Seam planner, beatmatching, stems and repair | Current technique options, previews and iterative fixes preserved | 0464,0477 | Real local render/preview E2E |
| Mixes, drafts, render line, history, undo | Recipe/history preserved even on a music-less device | 0459,0460,0477 | Dual-device 5/8 and history restore |
| Song/artist constraints, request bridges | No wrong substitution or content-rule relaxation | 0467,0473,0474 | Blocked and missing request scenarios |
| Frozen FLAC exports and blind studies | Local export validation and study comparison retained | 0465 | FLAC and study parity |
| Lucy suggestions and local tool calls | Intelligence preserved with explicit hosted data boundary | 0472 | Model eval + no-audio request |
| One audio owner, remote controller | Authenticated, safe, transparent device selection | 0462,0466,0469 | Multi-tab/takeover partition test |
| Guest rooms, QR, moderation | Guests request eligible local songs without audio streams | 0473 | Real venue/local planner ack |
| Multi-venue schedules, dayparts, DJ automation | Unattended zone music continues if cloud disappears | 0467,0468,0474 | Six-hour local soak and DST |
| Licence attestations, content safety, logs | Hard policies, audit and compliance responsibilities remain | 0474,0475 | Policy/licence/fallback tests |
| Account, plan, staff/admin, security | Tenant isolation and subscription operations continue | 0462,0470,0471,0479 | PostgreSQL/RBAC/webhook tests |
| Accessibility, responsive shell, visuals | No regressions on studio, mobile, kiosk or management | 0476-0478 | Browser state matrix |
| Existing standalone mode | No account required; files never uploaded | 0455,0461 | Existing local E2E unchanged |

## No silent scope reduction

"Remove upload route" means replace media import with local source selection, not remove adding music. "Remove render quota" means unmetered local work with device resource controls, not unlimited parallel RAM. "Remove cloud exports" means preserve local validated exports, not remove export buttons. "Remove worker" means keep the music algorithms locally, not delete the DSP engine.

**Auditor procedure:** For each existing test/route/feature flag and UX action, record old behavior, replacement source, new evidence, accessibility outcome, migration and explicit decision. Mark a capability **At risk** until a real end-to-end replacement passes. No functionality is retired solely on documentation claims.
