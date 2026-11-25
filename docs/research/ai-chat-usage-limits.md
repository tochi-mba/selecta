# How AI chat products price and limit usage - research notes

- **Reviewed:** 2026-11-25
- **Purpose:** support the Lucy Usage ADR set, [ADR-0480](../adr/adr-0480-lucy-usage-goal-evidence-and-boundaries.md) to [ADR-0487](../adr/adr-0487-lucy-usage-measurement-migration-and-rollout.md). It is not a pricing decision and does not change any plan.
- **Baseline inspected:** `main` at `f5b6a4a`.

## Evidence boundary

The figures below came from web searches run on 2026-11-25. The searches returned summaries of each page; the pages were not each opened and read in full. Rows marked **official** rest on the provider's own pricing or help pages. Rows marked **blogs** rest only on third-party guides that disagree with each other, and must not be quoted as fact. Every provider says its limits can change without notice, so re-check the linked page before any number here is used in a customer-facing claim.

## The seven limit designs in use

Most products combine two or three of these.

| Design | How it works | Who uses it |
|---|---|---|
| Rolling session window | The clock starts at the first message and the allowance comes back a set number of hours later. There is no fixed daily reset. | Claude (5 hours), Gemini (5 hours), ChatGPT Codex on Plus (5 hours), Grok (about 4 hours, blogs) |
| Weekly cap | A second, larger allowance sits above the session window. Both must have room. | Claude, Gemini, ChatGPT Codex |
| Compute meter | Usage is measured by work done, not by messages. Prompt size, features used, conversation length and model all count. | Claude, Gemini (since Google I/O 2026) |
| Tier multipliers | A higher plan is sold as a multiple of a lower plan's allowance, with no published message count. | Claude Max (5x Pro), Gemini Ultra (5x or 20x Pro), ChatGPT Pro (5x or 20x Plus for Codex) |
| Dollar credit pool | The plan includes credits spent at each model's API price. Going over is billed or bought as extra credits. | GitHub Copilot, Cursor, Claude usage credits, Gemini AI credits |
| Unlimited basics, capped extras | Plain text chat is unlimited within abuse guardrails. Costly features have their own caps. | ChatGPT (uploads, images, voice, deep research and Codex are capped) |
| Free with throttling | No paid chat plan. Heavy demand shows as "server busy". | DeepSeek |

When a limit is reached, a provider does one of three things: makes the person wait for the reset, moves them to a smaller model (Gemini falls back to Flash-Lite), or switches them to pay-as-you-go credits (Claude, Gemini, Copilot).

## Provider notes

1. **Claude - official.** A five-hour session limit on a rolling window and a weekly limit that resets at a fixed time assigned to the account. Max is five times Pro in both windows for $100 a month. Ultra has no five-hour limit for verified accounts. Chat, Claude Code and the desktop app draw on one pool. With usage credits switched on, requests past a limit continue at pay-as-you-go prices. [Pricing](https://claude.com/pricing), [Max plan](https://support.claude.com/en/articles/11049741-what-is-the-max-plan), [Ultra plan](https://support.claude.com/en/articles/17728952-what-is-the-ultra-plan), [usage credits](https://support.claude.com/en/articles/12429409-manage-usage-credits-for-paid-claude-plans).
2. **Gemini - official.** At I/O 2026 Google replaced daily prompt counts with a compute-used allowance that refreshes every five hours up to a weekly cap. AI Plus is 2x the standard allowance, AI Pro 4x, and AI Ultra 5x or 20x AI Pro ($99.99 and $199.99 a month). At the cap a subscriber can continue on Flash-Lite or spend AI credits. [Limits](https://support.google.com/gemini/answer/16275805?hl=en), [subscriptions](https://gemini.google/subscriptions/), [I/O 2026 changes](https://blog.google/products-and-platforms/products/google-one/google-ai-subscriptions/).
3. **ChatGPT - official for prices and the Codex window, blogs for the rest.** Go $8, Plus $20, Pro from $100 a month. Text chat is listed as unlimited within abuse guardrails on every plan. Codex on Plus is measured per five-hour window and Pro has no five-hour limit. A weekly allowance and a rolling 24-hour voice limit are reported by blogs only. [Pricing](https://chatgpt.com/pricing/), [Codex pricing](https://learn.chatgpt.com/docs/pricing?codex-pricing-plans=individual).
4. **GitHub Copilot and Cursor - blogs.** Copilot is reported to have replaced premium-request counts with dollar credits on 2026-06-01 (1 credit is $0.01, spent at API prices; code completions are free). Cursor bills from a credit pool at API prices; its tier names and prices changed in October 2026 and sources conflict. [DEV Community](https://dev.to/guarapay/your-ai-coding-tool-now-bills-like-a-cloud-provider-cursor-and-copilot-in-late-2026-1ccd), [devtoolsreview](https://devtoolsreview.com/pricing/copilot-pricing/).
5. **Grok, Perplexity, Microsoft Copilot, Mistral Le Chat, DeepSeek - blogs.** SuperGrok $30 with per-window message caps; Perplexity Pro $20 with weekly Pro Search limits and no published counts; Le Chat Pro $14.99; DeepSeek's app is free and throttled at peak hours. No reliable limit figures were found for Microsoft Copilot or Le Chat. [perspectiveai](https://perspectiveai.xyz/ai-pricing-guide/), [izzedo](https://www.izzedo.chat/blog/best-ai-subscription).

## What changed in 2026

- Message counts gave way to compute meters (Gemini; ChatGPT uncapped plain text chat).
- A weekly cap was added above the short window.
- A tier at about $100 a month appeared at every large provider, with one at about $200 above it.
- Top tiers dropped the short window and kept only the longer allowance.
- Coding tools moved to dollar credits at API prices.
- Paying to continue past a limit became normal.

## Why the designs look like this

This section is a reading of the designs, not something the providers state, except where noted.

- A flat price meets a variable cost. A weekly cap bounds the worst case per subscriber.
- A short window stops one person spending a week of capacity in an afternoon. Anthropic and Google both say limits exist to manage capacity.
- A window that starts at the first message spreads resets through the day, so there is no rush at midnight.
- A message count treats a one-line question and a long planning job the same. A compute meter does not.
- A multiplier lets a provider change the allowance underneath without rewriting the plan.

## What this means for Lucy

Selecta-specific design judgements, argued in the ADRs rather than proved here.

| Market pattern | Lucy at `f5b6a4a` | Proposed in |
|---|---|---|
| Compute meter | Turns per class per calendar month, with a separate hidden monthly dollar ceiling that does the real work | [ADR-0481](../adr/adr-0481-one-cost-weighted-lucy-allowance.md) |
| Rolling session plus weekly cap | Calendar month only | [ADR-0482](../adr/adr-0482-rolling-session-window-and-weekly-limit.md) |
| Smaller model, wait or credits at the limit | Silent step-down, then the built-in planner; one message for every cause | [ADR-0483](../adr/adr-0483-behaviour-at-the-limit-and-truthful-words.md) |
| One honest meter | The meter reads counters the gateway does not write | [ADR-0484](../adr/adr-0484-one-truthful-lucy-usage-meter.md) |
| Tier multipliers | Three hand-written allowance tables | [ADR-0485](../adr/adr-0485-plan-multipliers-and-one-allowance-catalogue.md) |
| Paid credits past the limit | None | [ADR-0486](../adr/adr-0486-extra-usage-credits.md) |

## Not established

- Whether SelectaDJ's customers, who mostly ask Lucy for a mix now and then, behave like chat-assistant subscribers at all. Beta data decides this ([ADR-0487](../adr/adr-0487-lucy-usage-measurement-migration-and-rollout.md)).
- Any provider's exact allowance. None publishes one.
- Whether a five-hour window is the right length for a music product. It is the market's convention, not a measured optimum.
