*Part of the [Selecta Cloud proposal](README.md). Accepted by the owner on 2026-11-09.*

## 3. Product: plans, entitlements and economics

### 3.1 Plan catalogue (starting values, all admin-tunable and versioned)

**Current implementation:** Plans are versioned in `src/selecta/billing/plans.py`. Cloud API and worker gateway startup call `validate_catalogue()` to catch stale flag ids, invalid plan versions and plan-gating conflicts before serving requests. The required unit and CI checks have not yet been run.

Storage is your decision. Everything else is a proposed starting point to validate in beta.

| Entitlement | Free | Standard | Premium |
|---|---|---|---|
| Stored music (originals + saved exports) | 10 GB | 50 GB | 100 GB |
| Scheduling weight (per account) | 1 | 3 | 6 |
| Concurrent jobs per pool (standard / interactive lane) | 1 / 1 | 2 / 2 | 4 / 3 |
| New-song analysis per day | 150 songs | 1,500 songs | 5,000 songs |
| Spare-time transition preparation budget | 10 CPU-min/day | 60 CPU-min/day | 240 CPU-min/day |
| Stem-assisted transitions and Stem Studio | Preview only (limited windows/day) | Yes | Yes, plus priority GPU lane |
| Exports (FLAC) | 3 per month, kept 7 days | 30 per month, kept 30 days | Unlimited (fair use), kept 90 days |
| Max upload file size / duration | 200 MB / 20 min | 500 MB / 60 min | 1 GB / 120 min |
| Lucy | Basic: Haiku 5.5, ~40 turns/month | Sonnet 5.5 for every turn: ~400 everyday + ~40 whole-mix planning turns | Opus 5.5 for every turn: ~150 everyday + ~25 deep plans + quick answers (fair use) |
| Library size soft cap (songs) | 3,000 | 15,000 | 40,000 |
| Word/harmonic discovery sweep | Sampled only | Sampled + scheduled | Sampled + larger scheduled sweeps |
| Rooms (QR guest requests) | Shown as a Premium feature | Shown as a Premium feature | 1 open room, up to 100 guests (beta), 12 h max, ~60 request renders/hour |
| Signed-in devices / playing at once | 10 / 1 | 10 / 1 | 10 / 1 |

Notes:
- **Daily analysis caps are a deliberate trade-off.** A Free account can hold about 2,500 MP3s, and at 150 a day a full library takes over two weeks to analyse. Mixes unlock at 6 ready songs and priority songs (`library.priority`) go first, so users can start at once; a one-off welcome allowance (e.g. 500 songs on the first day) is worth testing in beta. Premium's 5,000 a day covers a 25,000-song library in about five days.
- **Decimal GB**, enforced in bytes, shown as "18.4 GB of 50 GB".
- **What counts against storage**: uploaded originals and exports the user chose to keep. **What doesn't**: analysis data, playback proxies, stems, transition clips, waveform data, staging uploads after they finish or expire. Those are system-managed with their own per-account budgets and eviction (Selecta pays for them; they're bounded so they can't explode).
- **Daily/monthly allowances** reset in the account's timezone at midnight; the UI shows remaining amounts plainly, never as tokens or CPU seconds.
- "Turns" for Lucy are a user-facing unit; internally each turn is metered in tokens and dollars with hard per-turn ceilings ([§9](09-lucy-ai-gateway.md#9-lucy-and-the-ai-gateway-hosted-apis-server-owned-routing)). Allowances are sized so a user who spends every turn costs at most ~40% of their plan price in AI (Standard ≈ $3.56 of ~$8.90; Premium ≈ $6.60 of ~$16.50); typical use should be far lower. Beta measurements replace these numbers.
- **One model per plan (owner, 2026-11-24).** Free runs on Haiku, Standard on Sonnet and Premium on Opus for every kind of turn. At the typical turn shapes below, a member who used every turn would cost more than the 40% ceiling (Standard ≈ 400 × $0.02 + 40 × $0.055 ≈ $10.20, above its ~$8.90 net; Premium ≈ 150 × $0.045 + 25 × $0.10 ≈ $9.25 before fair-use quick turns, below its ~$16.50 net but above its $6.60 ceiling). The account's monthly dollar ceiling (`TIER_LIMITS`, $0.25 / $3.56 / $6.60) is what holds the margin: once the next turn's worst case would pass it, the gateway steps down the deployment's own chain (Opus, Sonnet, Haiku) and then to the built-in planner, so a heavy month gets smaller answers rather than a loss. In practice a Standard member gets about 170 typical Sonnet turns before Haiku answers, and a Premium member about 140.

### 3.2 Pricing hypothesis (to test, not decided)

| | Free | Standard | Premium |
|---|---|---|---|
| Monthly | £0 | £6.99 | £12.99 |
| Annual | - | £59 | £109 |

Reference points: Moises lists Premium around $4–6/month and Pro around $10–30/month (sources disagree); DJ.Studio sells a perpetual licence at the higher end. Selecta's differentiator is automatic, musically clever transitions on *your own* library in the browser, a gap most competitors don't fill (Soundverse DJ One and Fadr are the closest browser tools; djay and DJ.Studio are native apps).

### 3.3 Unit economics (estimates to be replaced by Phase 0 benchmarks)

Inputs: R2 Standard $0.015/GB-month; Modal CPU ≈ $0.047/physical-core-hour + $0.008/GiB-hour; Modal T4 ≈ $0.59/hour; analysis ≈ 0.15 s per second of audio on the laptop (≈ 36 s for a 4-minute song); Claude Haiku 5.5 $0.10/$0.50, Sonnet 5.5 $2/$10, Opus 5.5 $4/$20 per million input/output tokens, cache reads ~0.1×.

| Cost line | How it scales | Rough number |
|---|---|---|
| Storage, full Premium account | 100 GB × $0.015 | $1.50/month |
| Storage, full Free account | 10 GB × $0.015 | $0.15/month |
| System-managed derived data | Capped at ~15% of plan storage | ≤ $0.23/month (Premium) |
| First analysis of one song | ~1 core-minute + 1.5 GB-min on serverless | ~$0.001 (≈ $0.0003 on a reserved box) |
| Full 100 GB library import (≈ 25k MP3s or ≈ 3k FLACs) | one-time | $3–25 depending on format and pool |
| One stem window (46 s) on T4 | ~3–5 s GPU + CPU/mem | ~$0.001 |
| One transition render | 5–80 CPU-seconds | $0.0001–0.002 |
| Lucy turn, Haiku 5.5, 20k in (mostly cached) + 1.5k out | | ~$0.001 |
| Lucy turn, Sonnet 5.5, same shape | | ~$0.02 |
| Lucy turn, Opus 5.5 deep plan, 40k in + 4k out | | ~$0.10 |
| Stripe on £12.99 (UK card ~1.5% + 20p, Billing 0.7%, Tax 0.5%) | per invoice | ~£0.55 |

**Takeaways.** A fully used Premium account costs a few dollars a month in steady state, dominated by Lucy and spare-time preparation, both of which are allowance-bounded. The one-time import of a huge library is the largest single cost, so imports run at plan weight and Free imports are paced by daily caps. A Free account costs cents unless abused, which is why new-account limits and abuse signals ([§12.6](12-security-privacy-legal.md#126-abuse-controls-for-the-free-tier)) matter more than the storage number.

### 3.4 Update 2026-11-17: plan v2 under Browser-first Cloud (ADR-0464)

*Added for the Browser-first Cloud programme. §3.1 to §3.3 above are the accepted v1 text and stay as written; existing subscriptions keep v1 semantics until a notified change at renewal (ADR-0402 versioning). This section records what v2 changes.*

**What the tiers sell in v2 (the local-first axes).** Lucy allowances and model classes, Rooms (Premium only), playing devices and zones, and discovery sweeps. Explicitly not paid axes for default accounts: storage, daily analysis caps, speculative CPU minutes, export counts and upload sizes. The member's own device does that work, and SelectaDJ does not charge for permission to use it.

**Storage and analysis caps are now hosted-only.** `storage_bytes`, upload sizes, export counts and retention, `analysis_songs_per_day` and `speculative_cpu_minutes_per_day` keep their v1 values in the v2 plan entries, but from v2 they bind only for accounts holding the `cloud.hosted_media` grant (ADR-0456; the grant is rules-based, never a plan line). Everyone else sees a truthful "no hosted storage" meter state instead of a quota. The library soft cap rises to 10,000 / 40,000 / 100,000 songs as a UI sanity bound only.

**Prices hold.** £0 / £6.99 / £12.99 monthly, £59 / £109 annual, re-anchored against the 2026 consumer market researched in ADR-0464: djay Pro about $6.99/month, Serato DJ Pro about $11.99/month, rekordbox tiers about $120-360/year, VirtualDJ Pro $19/month. Standard sits in the djay band and Premium in the Serato band; SelectaDJ sells automatic mixing plus Rooms, not a performance deck, so the band is an anchor rather than a ceiling. Falling costs widen margin; they do not cut prices (owner decision, ADR-0464).

**Marginal cost shifts.** A default (local-first) account costs roughly zero outside Lucy: metadata rows, SSE traffic and Lucy turns, with the 40% Lucy rule unchanged from §3.1. A hosted-grant account carries today's stack, dominated by storage at R2's $0.015/GB-month: about $0.75/month for a full Standard quota (50 GB) and about $1.50/month for a full Premium quota (100 GB), plus roughly two thirds again for the Infrequent Access backup copy. The hosted population is grandfathered and only shrinks. Sources and re-verification notes are in ADR-0464.

---

[← 01-current-state.md](01-current-state.md) · [Contents](README.md#chapters) · [03-architecture.md →](03-architecture.md)
