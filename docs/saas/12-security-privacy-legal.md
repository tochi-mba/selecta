*Part of the [Selecta Cloud proposal](README.md). Accepted by the owner on 2026-11-09.*

## 12. Security, privacy and legal

### 12.1 Threat model highlights

| Threat | Control |
|---|---|
| Cross-tenant reads (guessing ids) | Random UUIDv7 ids, workspace check on every query, RLS backup, automated cross-tenant attack suite ([§15](15-stress-testing.md#15-stress-testing-and-verification)) |
| Malicious audio files (parser exploits, decode bombs) | Validation in a sandboxed worker: no network except the gateway, read-only filesystem except scratch, CPU/memory/time limits, ffprobe with limits, duration caps |
| Stolen session | Short access tokens, refresh rotation, device list with revoke, new-device email |
| Compromised staff session | MFA, short admin sessions, step-up, delayed dangerous actions, no default content access, audit + alerts |
| Worker compromise | Workers get only their attempt's signed URLs and a pool-scoped token; no DB credentials |
| Secret leakage | Platform secret stores; GitHub OIDC to deploy targets; secret scanning in CI; no secrets in the frontend bundle |
| Prompt injection via tags/lyrics | Untrusted content marking; tools authorise nothing on their own |
| Abuse of Free (mass accounts for storage/compute) | [§12.6](#126-abuse-controls-for-the-free-tier) |
| Webhook forgery | Stripe signature verification, replay window |
| DoS / API flooding | Cloudflare WAF and rate limits, per-account and per-IP limits in the API, upload concurrency limits |
| Room abuse (code guessing, request spam, strangers joining from a leaked code) | 40-bit codes looked up by hash, join rate limits, per-guest/IP/room request limits, host lock/approve/ban, code rotation ([§11A.2](11a-devices-and-rooms.md#11a2-rooms-premium)) |
| Guest tokens used beyond their room | Guest tokens can only read that room's snapshot and requestable-song metadata and create requests; no audio, no host account data |
| Flag rules leaking targeting (user lists, segments) | Rules evaluated server-side only; browsers receive decisions, never rules ([§11B.4](11b-feature-flags.md#11b4-enforcement-in-the-cloud)) |

### 12.2 Privacy (UK GDPR)

- **ICO data protection fee**: register and pay (small-business tier, roughly £50/year; check the current amount) before processing customers' personal data.
- **Privacy notice** listing data, purposes, lawful bases, retention, processors and transfers. Processors: Cloudflare, Render, Modal, Anthropic, Stripe, WorkOS, Sentry, Grafana, email provider. Sign each one's DPA.
- **International transfers**: US processors via the UK Extension to the EU–US Data Privacy Framework where the vendor is certified, otherwise the UK IDTA/Addendum. Choose EU regions where offered (R2 EU jurisdiction, Render Frankfurt, Postgres in Frankfurt).
- **Cookies**: only strictly necessary cookies (session, CSRF) so no consent banner is needed under PECR; product analytics, if any, cookieless and aggregate.
- **Children's Code**: a music app is likely to be used by teenagers, so run a DPIA, default to high privacy, no profiling for marketing, no nudges.
- **Rights**: access/export ("Download my data"), deletion, correction, objection; respond within one month.
- **AI data**: tell users exactly what goes to the AI provider (their messages, song titles/artists, optional lyric snippets and listening summary only if they opt in) and that it's not used to train models under the provider's API terms (verify the current terms for each provider).

### 12.3 Copyright and music

This needs a UK media/IP lawyer before paid launch. Facts that shape the design:
- The UK has **no private-copying exception** (the 2014 one was quashed in 2015), so a personal cloud copy of music is not clearly lawful for UK users; US lockers relied on DMCA safe harbour and, for big players, licences.
- **US precedent**: EMI v. MP3tunes (2011) treated locker deduplication and personal playback leniently, but the Second Circuit (2016) held MP3tunes could lose safe harbour for failing to implement a repeat-infringer policy and for red-flag knowledge.
- **What the product does about it**: terms require users to have the rights to what they upload; private lockers only (no public links, no sharing at launch); a notice-and-takedown process (UK hosting defence under the E-Commerce Regulations needs expeditious action on knowledge); a written repeat-infringer policy that's actually enforced; a registered DMCA agent for US users ($6 filing, renew every 3 years); no cross-account dedupe; derived audio (stems, transitions) kept only as long as useful.
- **Takedown and repeat infringers, as built** (`selecta/admin/takedowns.py`): staff with `legal.takedowns.manage` log a notice against one asset (`POST /api/admin/takedowns`); it records when it arrived and its 24-hour decision deadline, and the list flags overdue notices. Acting on it (`POST /api/admin/takedowns/{id}/act`) hides the asset and starts its deletion through the storage deletion ledger; rejecting it leaves the asset alone. Every step is audited. When a workspace reaches `SELECTA_REPEAT_INFRINGER_NOTICES` valid notices (three by default) its uploads are suspended: the upload API answers 403 `uploads_restricted` while the rest of the account keeps working, an Owner is alerted, and lifting it is a separate audited decision. The written policy text and the timed drill are still to do.
- **Lyrics**: see [§10.5](10-audio-engine-in-cloud.md#105-lyrics-in-cloud-mode-needs-a-decision).
- **UK Online Safety Act**: a private locker where users can't encounter each other's uploads is unlikely to be a user-to-user service. Rooms are the exception to watch: guests' requests and nicknames are seen by the host and other guests, so Rooms are designed with no free text ([§11A.2](11a-devices-and-rooms.md#11a2-rooms-premium)). Sharing or team workspaces later need a fresh assessment.

### 12.4 Data lifecycle

Retention table published in the privacy notice: originals until deleted (or 12 months after a lapsed account stays over quota, with warnings); derived data evicted under budgets; exports per plan; Lucy conversations until deleted (or 24 months idle); audit logs 2 years; database backups 30 days. `DELETE /api/account` immediately hides the account and revokes sessions. A durable workflow has per-step leases, fencing, retry backoff and a 30-day delay. Its adapter cancels jobs/subscriptions, removes memberships, releases upload reservations, tombstones account objects, and defers row erasure until physical purge. The final step deletes the WorkOS identity before removing the local user row, treating an upstream 404 as a successful retry. Song, account and export tombstones enter a transactional outbox. `selecta account-deletion-maintenance` advances workflow steps and writes account-plan snapshots; `selecta storage-maintenance` mirrors tombstones to `SELECTA_R2_BUCKET_DELETION_LEDGER` (a dedicated private R2 bucket) before bounded physical deletion. Configure `SELECTA_WORKOS_API_KEY` for account maintenance. Both commands require scheduling and a privileged database role. `selecta replay-deletions-after-restore` replays storage and account records before restored traffic opens. The restore drill and final backup-expiry confirmation remain required before claiming the proposed 60-day erasure guarantee.

Erasure leaves the audit log as written. `audit_events` is append-only (the app role may only insert, and triggers refuse updates even from the table owner), and its rows hold only random user, workspace and resource ids, never names, emails or content. Once the user row and the personal data are erased, those ids point at nothing and identify no one, so the rows stay for the two-year audit retention unchanged.

`GET /api/account/export` downloads a ZIP with original files verified against their recorded size and SHA-256, `settings.json` (account, workspace, plan, feature opt-outs, Lucy choices and signed-in devices), asset metadata and a manifest. `mixes.json` says mix revisions are unavailable because Cloud mix persistence is not implemented yet, and carries what Cloud does keep: the workspace's playback session (mix revision id, song index, offset and state). The Account page's "Download my data" button fetches it with the signed-in token and saves the ZIP. Assembly currently uses temporary local disk synchronously, so this path is not yet sized for very large libraries.

### 12.5 Open source and licensing of Selecta itself

The repo is public and GPL-3.0-or-later. Running GPL code on your servers isn't distribution, so the cloud service can stay as it is; the local edition keeps shipping under GPL. You hold the copyright to your own code, so dual-licensing later is possible. Decision for later (not a blocker): keep the cloud control plane in the public repo, or move it to a private repo while the engine stays public.

### 12.6 Abuse controls for the Free tier

New accounts start with lower daily caps for 7 days; email verification before uploads; one Free account per verified email and device-signal heuristics; per-IP and per-ASN signup rate limits; anomaly alerts (storage filled within hours, analysis caps hit daily, many accounts sharing payment or device signals); progressive restrictions with human review; never punitive on a large legitimate library alone.

---

[← 11b-feature-flags.md](11b-feature-flags.md) · [Contents](README.md#chapters) · [13-hosting-and-cost.md →](13-hosting-and-cost.md)
