*Part of the [Selecta Cloud proposal](README.md). Accepted by the owner on 2026-11-09.*

## 9. Lucy and the AI gateway (hosted APIs, server-owned routing)

### 9.1 Routing model

Plans grant a **capability**; a routing table maps capabilities to **deployments**; deployments name a provider and model. Changing a model never touches plans, Stripe or the frontend.

| Plan | Capability | Starting deployment | Why |
|---|---|---|---|
| Free | `lucy_basic` | Claude Haiku 5.5 (`claude-haiku-5-5`), effort low | $0.10/$0.50 per M tokens: cheap enough to give Free users a real Lucy |
| Standard | `lucy_standard` | Haiku 5.5 at medium/high effort for everyday turns; Claude Sonnet 5.5 (`claude-sonnet-5-5`, $2/$10) for a monthly allowance of whole-mix planning turns | Keeps a maxed-out Standard user well inside a £6.99 plan |
| Premium | `lucy_advanced` | Sonnet 5.5 for everyday turns; Claude Opus 5.5 (`claude-opus-5-5`, $4/$20) for "deep plan" turns within an allowance; Haiku for quick questions | Opus only where it earns its cost |
| Fallbacks | - | Per-tier chain: next smaller model of the same family → built-in planner (`lucy/builtin.py`) | Lucy degrades, never breaks the app |

**Routing down, never up.** Within a tier, the gateway sends simple requests (help questions, "skip this song", small edits) to the cheapest model the tier allows, and keeps the bigger model for planning. It never routes a request to a model above the tier.

Model IDs and prices are from Anthropic's current published table (Oct 2026); re-check before launch. The registry also allows a second provider via the existing OpenAI-compatible adapter in `lucy/providers.py` if a different vendor proves better or cheaper for a tier.

### 9.2 Registry and policy (admin-editable, versioned)

Each deployment record: provider, model id, secret reference, capabilities (streaming, tools, structured output), max input/output tokens, max tool cycles, per-turn cost ceiling, per-deployment concurrency, data-region notes, rollout percentage, fallback, status (active/draining/disabled), evaluation results. Every Lucy run stores the deployment, policy version, prompt version and tool-schema version it used, so behaviour is reproducible and a mid-conversation config change doesn't switch models under a running turn.

### 9.3 Spend protection (layered)

| Layer | Control |
|---|---|
| Per call | max tokens, cost estimate reserved before the call, reconciled after |
| Per turn | max tool cycles (existing `max_cycles`), max seconds, max cost |
| Per account | monthly turn allowance, per-day soft cap, max 1–2 concurrent runs (replaces the process-wide `Semaphore(2)`) |
| Per tier | allowed models, deep-plan allowance |
| Per provider | concurrency limit, circuit breaker on errors/429s |
| Platform | daily and monthly spend alarms, hard admission cap, emergency disable per deployment |

A turn uses the allowance of the class that actually served it: a deep plan that falls back from Opus to Sonnet counts as a planning turn, the run records both the class requested and the class served, and a turn the built-in planner answers uses no model allowance.

Prompt caching (already used in `providers.py`) keeps repeated system prompts and library context cheap; the gateway tracks cache-hit rate per tier as a cost KPI.

### 9.4 Safety of tool use

Unchanged principle from today's design and worth restating: model output never authorises anything. Lucy proposes WeftAI plans; the server validates them against `PlanSchema`, checks the user's permissions and entitlements, and mutations still need the user's approval in the UI (`LucyApprove`). Song metadata and lyrics are untrusted text in prompts. Side-effecting tool steps carry idempotency keys so an interrupted stream is never replayed into duplicate changes. Provider failure mid-stream → the run is marked incomplete with a "try again" button, never stitched together from two providers.

### 9.5 Settings split

| Setting | Local mode | Cloud mode |
|---|---|---|
| Use Lucy on/off, phases (chat, proposals, commit, memory, voice) | User | User |
| Share lyric snippets / listening history with the AI | User | User (with a clear note that text goes to Selecta's AI provider) |
| Memory facts, clear memory, conversation history and deletion | User | User |
| Provider, model, base URL, API key, consent to a provider | User (bring your own key) | **Hidden**; shows "Lucy Basic / Standard / Advanced" from the plan |
| Max rounds/steps/seconds, spend limit (USD) | User | **Hidden**; server policy |
| Usage shown | - | Turns used this month, resets on date |

Server-side, API keys move from plaintext `lucy-secrets.json` to the hosting platform's secret store in cloud mode (local mode keeps the file but should restrict its permissions).

### 9.6 Quality gate for model changes

A fixed Lucy evaluation set (synthetic libraries, scripted requests: mood + length, exclusions respected, no invented songs, current mix preserved unless approved, permission asked before big changes, valid tool calls, cost and latency within limits) must pass before a deployment becomes a tier default, then rolls out 5% → 25% → 100% with metrics compared against the previous deployment.

---

[← 08-billing.md](08-billing.md) · [Contents](README.md#chapters) · [10-audio-engine-in-cloud.md →](10-audio-engine-in-cloud.md)
