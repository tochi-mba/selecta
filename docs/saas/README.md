# Selecta Cloud: SaaS proposal

*Prepared 9 November 2026 for Tochi Mba. Grounded in the `tochi-mba/selecta` repo at `main` (3c2f1eb, including the feature-flag work merged today), three code maps of the backend, frontend and docs/CI, and web research on hosting, queues, billing, AI pricing, licensing and music-locker law. Prices are from public pages and third-party summaries as of Oct–Nov 2026 and must be re-checked before any spend decision.*

**Status:** Accepted by the owner on 2026-11-09. Decisions are recorded as ADR-0391 to ADR-0416 (all Accepted); progress is tracked in the [implementation checklist](../adr/selecta-cloud-implementation-checklist.md). Local mode keeps every guarantee it has today.

---

## 0. Context

**Why this exists.** Selecta is a local, single-user auto DJ: a FastAPI server bound to `127.0.0.1`, a SQLite database and a folder of music on one Windows PC, with a React web app on top. You want to turn it into a subscription product with three tiers (Free 10 GB, Standard 50 GB, Premium 100 GB), Stripe payments, hosted AI models chosen by the server per tier, a processing queue that serves paying tiers first without starving anyone and scales by adding workers, an admin dashboard with proper roles, and exaggerated stress testing. A long brainstorm from another assistant (shared during planning) covered much of the ground; this proposal checks it against the real code, corrects what it got wrong, fills the gaps, and turns it into one decided plan with an order of work.

**Decisions you have already made** (not re-opened here):

| Decision | Your answer |
|---|---|
| Tiers and storage | Free 10 GB, Standard 50 GB, Premium 100 GB |
| Payments | Stripe |
| Generative AI | Hosted model APIs (no self-hosted LLM GPUs); server picks the model per tier; users never choose a model |
| Code home | GitHub, existing `tochi-mba/selecta` repo |
| Local app | **Keep it**: one codebase, a `local` mode and a `cloud` mode |
| Launch shape | **Private beta first**: ~50–300 invited users, roughly $100–400/month infrastructure, then open up |
| Business location | **United Kingdom** |
| Where this proposal lands | Markdown chapters under `docs/saas/` plus Proposed ADR stubs; nothing committed until you say |
| Premium Rooms | A host shares a QR code; anyone can join and add song requests ([§11A.2](11a-devices-and-rooms.md#11a2-rooms-premium)) |
| Many devices per account | Design for one account signed in on several devices, with one device playing ([§11A.1](11a-devices-and-rooms.md#11a1-devices-and-the-playback-session)) |
| Feature flags | Build on the new flag system so any feature can be turned off for specific users or whole tiers ([§11B](11b-feature-flags.md#11b-feature-flags-and-targeting)) |

**Intended outcome.** A proposal you can approve chapter by chapter, that a future implementation session can execute phase by phase, with every big choice recorded as an ADR in the repo's existing format.

---

## 1. Executive summary

**What we build.** "Selecta Cloud": the same Selecta experience in the browser, but your music lives in private cloud storage, the heavy work (analysis, stems, transitions, exports) runs on a pool of workers, and accounts, plans and payments sit around it. The local app keeps working from the same code.

**The shape, in one breath.** A static React app on Cloudflare; a stateless FastAPI API; PostgreSQL as the single source of truth (including the job queue); Cloudflare R2 for audio (no egress fees, which matters for a music app); workers that pull jobs over HTTPS from a separate gateway service (on Modal at beta for both CPU work and GPU stem separation, with a cheap reserved CPU pool added later; never on Render, whose egress pricing would make every upload to R2 expensive); Lucy routed through a server-side AI gateway to Claude models chosen per tier; Stripe for billing; WorkOS AuthKit for sign-in; an admin console inside the same app behind server-enforced roles.

**The queue, in one breath.** Jobs live in Postgres. Each worker pool (analyse, seams, stems, export…) dispatches by **weighted fair share per active account**: every account with waiting work gets a share proportional to its tier weight (Free 1, Standard 3, Premium 6, admin-tunable), charged in estimated compute seconds and corrected by actual use. A protected interactive lane makes "the transition you're about to hear" jump ahead of bulk work, but each account's interactive use is capped so it can't be gamed. Workers hold short renewable leases with fencing tokens, write results to attempt-scoped keys, and only the current lease holder can publish, so a crashed or zombie worker can never corrupt a result. Adding capacity means starting another worker container; nothing else changes.

**Why per-account weights, not tier percentages** (a correction to the brainstorm). Fixed 10%/30%/60% splits by tier misbehave as the user mix changes: with 10 Premium and 1,000 Free users backlogged, each Premium account would get 600× a Free account; with 1,000 Premium and 10 Free, each Free account would get more than a Premium one. Per-account weights keep the promise stable: "a Premium account gets about 6× the processing rate of a Free account when both are waiting", whatever the population ([§4A.4](04-queue-and-scheduling.md#4a4-scheduling-policy)).

**Devices and Rooms.** An account can be signed in anywhere, but only one device plays at a time: it holds a short lease, every other device is a remote with live state, and "Play here" moves the music. Premium hosts can open a **Room**: guests scan a QR code, open a light web page with no app or account, search the host's requestable songs and ask for one; Selecta's existing request planner fits it into the mix, the host stays in control, and guests never receive audio (a legal and practical choice).

**Feature flags.** The repo's new flag registry (ADR-0390) stays the single list of features. The cloud adds context on top: a feature reaches a user only if the build has it, the mode supports it, the plan includes it, and no admin rule has switched it off for that user, workspace, tier or cohort. Admins get a Flags page with kill switches, per-tier and per-user rules, percentage rollouts, an impact preview and a "what does this user see, and why" trace. Flags can switch features off or roll them out, but never grant what a plan doesn't include.

**Money.** Raw storage is cheap (100 GB on R2 ≈ $1.50/month). The real costs are processing (first-time analysis of a big library, stems, speculative transition preparation) and Lucy. So plans get **processing and AI allowances** alongside storage, Free work runs at the lowest weight with daily caps, and speculative preparation has a per-tier budget. A beta of ~200 users fits the $100–400/month budget.

**Blockers found in the code that the brainstorm missed:**

1. **The key-detection model (Deezer S-KEY) is licensed for non-commercial research only** (`src/selecta/analysis/skey_model.py:5-6`). It must be replaced before any paid plan exists.
2. **212 ADRs list "SaaS, accounts, cloud upload" as explicit non-goals** (e.g. ADR-0025, ADR-0072, `docs/adr/README.md`). A superseding ADR must scope those guarantees to local mode.
3. **Lyrics come from LRCLIB per song**; a cloud service calling it for every user's library raises rate-limit, terms and lyric-licensing questions, especially where lyric snippets are displayed (Word connections).
4. **The player downloads whole songs as decoded WAV** (`/api/songs/{id}/audio` decodes to in-memory WAV, ~42 MB for 4 minutes). That can't go over the internet as-is; cloud playback needs pre-made playback files.
5. **Cloudflare R2 doesn't support presigned POST policies**, so upload size can't be enforced at signing time; the upload design below enforces it at completion instead.
6. **Fly.io GPU machines were withdrawn on 1 August 2026**, so the brainstorm's Fly-for-GPU option is gone.
7. **Lots of process-local state** (idempotency cache, export `running` dict, Lucy semaphore, startup code that deletes every "rendering" seam) would break or corrupt data with two API instances.
8. **CI runs Python on Windows only**; cloud workers will be Linux containers, so the cloud path needs Linux CI.

**Order of work** (detail in [§17](17-roadmap-and-risks.md#17-roadmap)): Phase 0 decisions, benchmarks and legal kickoff → Phase 1 durable jobs and storage abstraction *inside the local app first* → Phase 2 fair scheduler plus simulator → Phase 3 cloud data plane (Postgres, R2, uploads, workers) → Phase 4 identity, tenancy, Stripe → Phase 5 Lucy gateway → Phase 6 SaaS UX, devices and admin v1 → Phase 6B Rooms → Phase 7 hardening and extreme stress → Phase 8 private beta. Roughly 7–10 months of focused solo work with AI help before the first invited users; the queue is buildable and testable from Phase 1.

**Five principles that never bend:** no accepted job is ever lost; no user ever reaches another user's data; no tier is starved by design; no spending is unbounded; the UI never claims more than the backend has verified.

---

## Chapters

| Chapter | What it covers |
|---|---|
| [01-current-state.md](01-current-state.md) | What the code does today, verified, and corrections to the brainstorm |
| [02-plans-and-economics.md](02-plans-and-economics.md) | Plan catalogue, pricing hypothesis and unit economics |
| [03-architecture.md](03-architecture.md) | Runtime modes, component map and deployment units |
| [04-queue-and-scheduling.md](04-queue-and-scheduling.md) | The processing and queue system: jobs, lanes, fairness, leases, workers |
| [05-storage-uploads-playback.md](05-storage-uploads-playback.md) | R2 layout, uploads, quotas, deletion and cloud playback |
| [06-data-model.md](06-data-model.md) | Schema approach, tables by domain and local data migration |
| [07-identity-rbac-admin.md](07-identity-rbac-admin.md) | Sign-in, staff roles, dangerous actions, admin console and audit |
| [07a-authentication.md](07a-authentication.md) | Sign-up, Google, forgot password, sessions, sign out everywhere, WorkOS webhooks, staff sign-in, every edge case |
| [08-billing.md](08-billing.md) | Stripe setup, webhooks, entitlement rules and UK obligations |
| [09-lucy-ai-gateway.md](09-lucy-ai-gateway.md) | Model routing per tier, spend protection and settings split |
| [10-audio-engine-in-cloud.md](10-audio-engine-in-cloud.md) | Engine storage abstraction, CPU vs GPU, model licences, lyrics |
| [11-ui-ux.md](11-ui-ux.md) | New screens, changes by file, real-time updates and honest status |
| [11a-devices-and-rooms.md](11a-devices-and-rooms.md) | One playing device per account, remotes, and Premium Rooms |
| [11b-feature-flags.md](11b-feature-flags.md) | Layered, context-aware flags on top of the existing registry |
| [12-security-privacy-legal.md](12-security-privacy-legal.md) | Threat model, UK GDPR, copyright, retention and abuse controls |
| [13-hosting-and-cost.md](13-hosting-and-cost.md) | Chosen stack, environments, CI/CD, cost estimate and recovery |
| [14-operations.md](14-operations.md) | Traces, metrics, SLOs, alerts, runbooks and emergency controls |
| [15-stress-testing.md](15-stress-testing.md) | Invariants, tools, the load ladder, scenarios and thresholds |
| [16-edge-cases.md](16-edge-cases.md) | Product and correctness edge cases by area |
| [17-roadmap-and-risks.md](17-roadmap-and-risks.md) | Phases, risks, open questions, repo layout and the ADR list |
| [18-test-plan.md](18-test-plan.md) | Every edge case and test per module, coverage gates, security suite and CI wiring |
| [sources.md](sources.md) | Where the facts and prices came from |
| [licence-register.md](licence-register.md) | Every model and key dependency, its licence and whether cloud mode may use it |

ADRs: [0391](../adr/adr-0391-selecta-cloud-goal-and-local-guarantees.md) · [0392](../adr/adr-0392-two-runtime-modes.md) · [0393](../adr/adr-0393-postgres-alembic-and-tenancy.md) · [0394](../adr/adr-0394-durable-jobs-leases-and-fencing.md) · [0395](../adr/adr-0395-fair-scheduling-policy.md) · [0396](../adr/adr-0396-worker-gateway-and-pools.md) · [0397](../adr/adr-0397-object-storage-layout.md) · [0398](../adr/adr-0398-upload-protocol-and-quota-reservations.md) · [0399](../adr/adr-0399-cloud-playback-proxies.md) · [0400](../adr/adr-0400-identity-with-workos-authkit.md) · [0401](../adr/adr-0401-authorization-rbac-and-audit.md) · [0402](../adr/adr-0402-plans-entitlements-and-quotas.md) · [0403](../adr/adr-0403-stripe-billing-and-uk-vat.md) · [0404](../adr/adr-0404-lucy-ai-gateway.md) · [0405](../adr/adr-0405-licence-register-and-s-key-replacement.md) · [0406](../adr/adr-0406-lyrics-in-cloud-mode.md) · [0407](../adr/adr-0407-realtime-updates-sse.md) · [0408](../adr/adr-0408-admin-console-v1.md) · [0409](../adr/adr-0409-hosting-topology-and-environments.md) · [0410](../adr/adr-0410-observability-slos-and-emergency-controls.md) · [0411](../adr/adr-0411-stress-chaos-and-release-gates.md) · [0412](../adr/adr-0412-privacy-retention-and-deletion.md) · [0413](../adr/adr-0413-copyright-takedown-and-repeat-infringers.md) · [0414](../adr/adr-0414-feature-flag-targeting-in-cloud-mode.md) · [0415](../adr/adr-0415-playback-devices-and-sessions.md) · [0416](../adr/adr-0416-rooms-guest-requests.md)
