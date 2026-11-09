*Part of the [Selecta Cloud proposal](README.md). Accepted by the owner on 2026-11-09.*

## 3. Product: plans, entitlements and economics

### 3.1 Plan catalogue (starting values, all admin-tunable and versioned)

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
| Lucy | Basic: Haiku 5.5, ~40 turns/month | Haiku 5.5 (higher effort) ~400 turns + ~40 Sonnet 5.5 whole-mix planning turns | Sonnet 5.5 ~150 turns + ~25 Opus 5.5 deep plans + Haiku quick answers (fair use) |
| Library size soft cap (songs) | 3,000 | 15,000 | 40,000 |
| Word/harmonic discovery sweep | Sampled only | Sampled + scheduled | Sampled + larger scheduled sweeps |
| Rooms (QR guest requests) | Shown as a Premium feature | Shown as a Premium feature | 1 open room, up to 100 guests (beta), 12 h max, ~60 request renders/hour |
| Signed-in devices / playing at once | 10 / 1 | 10 / 1 | 10 / 1 |

Notes:
- **Daily analysis caps are a deliberate trade-off.** A Free account can hold about 2,500 MP3s, and at 150 a day a full library takes over two weeks to analyse. Mixes unlock at 6 ready songs and priority songs (`library.priority`) go first, so users can start at once; a one-off welcome allowance (e.g. 500 songs on the first day) is worth testing in beta. Premium's 5,000 a day covers a 25,000-song library in about five days.
- **Decimal GB**, enforced in bytes, shown as "18.4 GB of 50 GB".
- **What counts against storage**: uploaded originals and exports the user chose to keep. **What doesn't**: analysis data, playback proxies, stems, transition clips, waveform data, staging uploads after they finish or expire. Those are system-managed with their own per-account budgets and eviction (Selecta pays for them; they're bounded so they can't explode).
- **Daily/monthly allowances** reset in the account's timezone at midnight; the UI shows remaining amounts plainly, never as tokens or CPU seconds.
- "Turns" for Lucy are a user-facing unit; internally each turn is metered in tokens and dollars with hard per-turn ceilings ([§9](09-lucy-ai-gateway.md#9-lucy-and-the-ai-gateway-hosted-apis-server-owned-routing)). Allowances are sized so a user who spends every turn costs at most ~40% of their plan price in AI (Standard ≈ $1.50 of ~$8.90; Premium ≈ $7 of ~$16.50); typical use should be far lower. Beta measurements replace these numbers.

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

---

[← 01-current-state.md](01-current-state.md) · [Contents](README.md#chapters) · [03-architecture.md →](03-architecture.md)
