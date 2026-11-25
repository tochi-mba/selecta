*Part of the [Selecta Cloud proposal](README.md). Accepted by the owner on 2026-11-09.*

## 9. Lucy and the AI gateway (hosted APIs, server-owned routing)

### 9.1 Routing model

Plans grant a **capability**; a routing table maps capabilities to **deployments**; deployments name a provider and model. Changing a model never touches plans, Stripe or the frontend.

| Plan | Capability | Starting deployment | Why |
|---|---|---|---|
| Free | `lucy_basic` | Claude Haiku 5.5 (`claude-haiku-5-5`), effort low | $0.10/$0.50 per M tokens: cheap enough to give Free users a real Lucy |
| Standard | `lucy_standard` | Claude Sonnet 5.5 (`claude-sonnet-5-5`, $2/$10, effort medium) for every turn: 400 everyday and 40 whole-mix planning turns a month | One clearly better model than Free; the monthly dollar ceiling keeps a maxed-out member inside a £6.99 plan |
| Premium | `lucy_advanced` | Claude Opus 5.5 (`claude-opus-5-5`, $4/$20, effort high) for every turn: 150 everyday, 25 deep plans, quick answers on fair use | The best model; the ceiling steps a heavy month down to Sonnet, then Haiku |
| Fallbacks | - | Per-tier chain: next smaller model of the same family → built-in planner (`lucy/builtin.py`) | Lucy degrades, never breaks the app |

**One model per plan, routing down never up.** Since 2026-11-24 (owner decision) each plan answers every kind of request with its own model: Free on Haiku, Standard on Sonnet, Premium on Opus. A request only ever moves down: when its model is unhealthy or disabled it falls back along the deployment's chain (Opus, Sonnet, Haiku, built-in planner), and when the next turn's worst case would pass the account's monthly dollar ceiling the gateway steps down the same chain to a cheaper model that fits before giving the turn to the built-in planner. It never routes a request to a model above the tier. A database still on an earlier starting map is moved to the new one at start; a map an admin chose is never touched.

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

Current implementation: `GET` and `PUT /api/account/lucy` (flag `account.lucy_settings`,
`selecta.lucy.cloud_settings`) read and change only Use Lucy, the phases and the two sharing
choices, stored per user under `lucy:` ids in the user preferences table. The answer adds the
plan's tier ("Lucy Basic", "Lucy Standard", "Lucy Advanced") and this month's turn meter. A body
naming a provider, model, key or budget is refused (422), and an unknown phase is refused by name.
Conversation history is kept in Cloud (§9.7); Lucy's memory facts and listening history are not, so the memory row is not offered and `GET /api/lucy-cloud/memory` says so.

Server-side, API keys move from plaintext `lucy-secrets.json` to the hosting platform's secret store in cloud mode (local mode keeps the file but should restrict its permissions).

### 9.6 Quality gate for model changes

A fixed Lucy evaluation set (synthetic libraries, scripted requests: mood + length, exclusions respected, no invented songs, current mix preserved unless approved, permission asked before big changes, valid tool calls, cost and latency within limits) must pass before a deployment becomes a tier default, then rolls out 5% → 25% → 100% with metrics compared against the previous deployment.

### 9.7 Lucy's conversations in Cloud (ADR-0476, flag `lucy.cloud_conversation`)

Built in PRs #133 and #134. The local Lucy page is reused in the browser-first Cloud shell at `/mixes/lucy`, talking to `/api/lucy-cloud/...` instead of the desktop server.

- **What she works over.** The account's catalogue of song details and its mixes as recipes, never the music files (they stay on the person's devices). Her tools search the catalogue, list artists, read the current and saved mixes, and propose a mix; a proposal is a list of catalogue songs, and saving it writes a recipe revision. She also knows where the playing mix is and an open room's waiting requests.
- **Storage.** Five tenant tables (`lucy_cloud_conversations`, `_messages`, `_turns`, `_events`, `_proposals`) with the workspace isolation policy (migrations `bf0476lucy01` to `03`). A conversation belongs to the workspace and the person who started it; anyone else gets the answer a made-up id gets. Conversations are in Download my data (`lucy-conversations.json`).
- **Every turn through the gateway.** Admitted by `gateway.plan_turn` with the plan's tier and ceilings, settled with the real tokens, given back when it fails or is stopped. One turn in flight per conversation (a partial unique index); a refusal is answered at once in plain words and counts nothing. When the allowance or the dollar ceiling is used up, the built-in planner answers and says which of the two it was, with the date it comes back. The words decide which allowance a turn counts against: a whole new mix is a planning turn, one of two hours or more (or for a wedding, a festival, all night) a deep plan, a short question that asks for no mix a quick turn, anything else an everyday turn. The turns meter reads the same counters admission uses (`ai_usage`).
- **Several devices.** A turn records the device it came from; every device sees the same conversation, the person's words and the turns meter (`lucy.turns` on the workspace stream).
- **Streaming.** The page reads the conversation's event log with a cursor every 500 ms while visible (a bearer token cannot ride on `EventSource`); text deltas are batched and pruned once a reply is complete.
- **Not in Cloud yet.** Memory facts and listening history; a real-phone keyboard check; song titles in the playing position.
- **Evaluation.** `tests/lucy_eval/` (72 cases) and `tools/lucy_eval.py`; run within the owner's spending limit.

### 9.8 Proposed: one usage allowance on a session and a week (ADR-0477 to ADR-0484, flag `lucy.usage_windows`)

Proposed on 2026-11-25 and not built. Today Lucy is limited twice: by turns per class per calendar month, which the customer is sold, and by a monthly dollar ceiling per account (§9.3), which the customer never sees and which is the limit that really holds since each plan moved to one model. The [Lucy Usage ADR set](../adr/README.md#selecta-lucy-usage-adr-set-2026-11-25) proposes to make them one thing.

- **One allowance, weighted by cost.** A turn is charged what it cost, reserved at admission and settled with the real tokens. The request class stops deciding what a person is charged ([ADR-0478](../adr/adr-0478-one-cost-weighted-lucy-allowance.md)).
- **Two windows.** A five-hour session that opens at the first message and a weekly limit with a fixed reset per account, in place of the calendar month. Venue pools get the weekly limit only ([ADR-0479](../adr/adr-0479-rolling-session-window-and-weekly-limit.md)).
- **At the limit.** Session spent: a lighter Lucy answers and says so once. Week spent: the built-in planner. Each cause has its own true words and the real time it ends ([ADR-0480](../adr/adr-0480-behaviour-at-the-limit-and-truthful-words.md)).
- **One meter.** Session and week as percentages with reset times, read from the ledger the gateway enforces; never tokens, dollars or model names ([ADR-0481](../adr/adr-0481-one-truthful-lucy-usage-meter.md)).
- **Plans as multipliers** of one base allowance, written once in the plan catalogue ([ADR-0482](../adr/adr-0482-plan-multipliers-and-one-allowance-catalogue.md)).
- **Extra usage** in prepaid packs, deferred until the owner decides ([ADR-0483](../adr/adr-0483-extra-usage-credits.md)).
- **Measured before it is sized.** Shadow metering on beta accounts sets every number; the 40% rule and the prices do not change ([ADR-0484](../adr/adr-0484-lucy-usage-measurement-migration-and-rollout.md)).

Faults found in the present model while writing the set are listed in [ADR-0477](../adr/adr-0477-lucy-usage-goal-evidence-and-boundaries.md) and filed in `docs/todo/items/`. The market research behind the design is in [docs/research/ai-chat-usage-limits.md](../research/ai-chat-usage-limits.md).

---

[← 08-billing.md](08-billing.md) · [Contents](README.md#chapters) · [10-audio-engine-in-cloud.md →](10-audio-engine-in-cloud.md)
