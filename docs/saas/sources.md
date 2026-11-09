*Part of the [Selecta Cloud proposal](README.md). Proposed, for owner review.*

## 22. Sources

- Temporal Task Queue Priority and Fairness: https://docs.temporal.io/develop/task-queue-priority-fairness
- Hatchet concurrency and fair queueing: https://docs.hatchet.run/home/concurrency · https://github.com/abelanger5/postgres-fair-queue
- PostgreSQL `SKIP LOCKED` (SELECT docs): https://www.postgresql.org/docs/current/sql-select.html
- Cloudflare R2 pricing: https://developers.cloudflare.com/r2/pricing/ · presigned URLs (no POST policies, S3 domain only): https://developers.cloudflare.com/r2/api/s3/presigned-urls/
- Uppy S3 multipart (works with R2): https://uppy.io/docs/aws-s3/
- Modal pricing summaries (T4 $0.000164/s, L4 $0.000222/s, CPU $0.0000131/core/s): https://www.spheron.network/blog/modal-gpu-pricing-2026-per-second-billing/
- Runpod serverless pricing: https://docs.runpod.io/serverless/pricing
- Fly.io GPU deprecation: https://fly.io/docs/gpus/getting-started-gpus/ · https://community.fly.io/t/gpu-migration-fly-io-gpus-will-be-deprecated-as-of-july-31-2026/27110
- Render compute plans and Postgres storage pricing: https://render.com/docs/compute-plans · https://render.com/pricing
- Hetzner 2026 price increases: https://www.tomshardware.com/tech-industry/hetzner-to-raise-prices-by-up-to-37-percent-from-april-1 · https://wz-it.com/en/blog/hetzner-price-increase-june-2026-cpx-ccx-alternatives/
- Neon vs Supabase pricing: https://www.bytebase.com/blog/neon-vs-supabase/
- Auth provider pricing (WorkOS AuthKit free to 1M MAU, Clerk): https://www.propelauth.com/post/best-managed-auth-for-startups-in-2026 · https://clerk.com/articles/clerk-pricing-explained
- Stripe Entitlements and subscription webhooks: https://docs.stripe.com/billing/entitlements · https://docs.stripe.com/billing/subscriptions/webhooks
- Stripe Billing/Tax fees: https://support.stripe.com/questions/understanding-stripe-tax-pricing · https://stripe.com/gb/pricing
- Stripe Managed Payments (merchant of record) fees and availability: https://alexcloudstar.com/blog/merchant-of-record-indie-saas-2026/
- Anthropic model table and prices (Haiku 5.5, Sonnet 5.5, Opus 5.5, Fable 5.1): Claude API reference, cached 2026-10-06
- LLM gateways (LiteLLM, OpenRouter, Portkey) comparison: https://openrouter.ai/blog/insights/openrouter-vs-litellm/
- Demucs status (archived Jan 2025, maintained fork): https://github.com/facebookresearch/demucs
- htdemucs speed (HDemucs RTF on T4 vs CPU): https://arxiv.org/pdf/2310.11364
- Beat This licence (MIT per project): https://pypi.org/project/beat-this/
- EMI v. MP3tunes (2011) and Second Circuit (2016): https://copyrightandtechnology.com/2011/08/23/mixed-verdict-for-emi-against-mp3tunes-com/ · https://www.loeb.com/en/insights/publications/2016/11/emi-christian-music-group-inc-v-mp3tunes-llc
- DMCA designated agent renewal: https://www.mondaq.com/unitedstates/copyright/902198/us-copyright-office-renewal-of-dmca-designated-agent-required-for-dmca-safe-harbor
- LRCLIB (terms to confirm with operators): https://lrclib.net
- Competitor references: https://help.moises.ai/hc/articles/5968943445404 · https://dj.studio/pricing · https://www.soundverse.ai/features/dj-one · https://djmag.com/news/new-djay-ai-ios-adds-improved-ai-mixing
- Feature flags in the repo: `docs/flags.md`, `docs/adr/adr-0390-feature-flags.md`, `src/selecta/flags/`
- Spotify Jam (QR invites, guest queue, host controls): https://support.spotify.com/article/jam/
- Spotify Connect active-device model: https://developer.spotify.com/documentation/commercial-hardware/implementation/guides/connect-basics
- Song-request apps with QR, no-account guests, approval and voting (Rekwest, Wedibox, Tell the DJ, Releventful): https://www.wedibox.com/features/shared-playlist · https://help.releventful.com/en/articles/8712974-live-song-selection-tutorial
- iOS web audio background limits: https://bugs.webkit.org/show_bug.cgi?id=198277 · https://developer.apple.com/forums/thread/762582
- UK Online Safety Act scope (user-to-user definition): https://www.legislation.gov.uk/ukpga/2023/50/section/3 · https://bratby.law/does-the-online-safety-act-apply/
- Public performance licensing (TheMusicLicence): https://pplprs.co.uk/faqs · https://www.gov.uk/licence-to-play-live-or-recorded-music
- UK specifics to confirm with professionals: HMRC VAT registration threshold and digital services to EU consumers (non-Union OSS); ICO data protection fee; UK Consumer Contracts Regulations 2013 (digital content cancellation); DMCC Act 2024 subscription rules; ICO Age Appropriate Design Code; Online Safety Act scope.

---

[← 17-roadmap-and-risks.md](17-roadmap-and-risks.md) · [Contents](README.md#chapters)
