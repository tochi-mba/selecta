# Selecta - creative-interface cross-programme status reconciliation

**New CI programme (baseline main 4c2f9f03b8b7e185a7a5021979f4b443e40299dd): 20 Accepted, 140 new tasks Not started, 0 In progress, 0 Implemented, 0 independently Verified.** This documentation-only programme does not change any historical status.

| Programme | Historical evidence | What is reused | Status changed here |
|---|---|---|---|
| Original T / ADR-0001–0032 | [Original evidence](implementation-evidence.md) | Audio, safety and routing | None |
| Polish P / 0033–0046 | [Polish evidence](polish-implementation-evidence.md) | Tokens and components | None |
| Selecta 3 / 0047–0077 | [3.0 evidence](selecta-3-evidence.md) | Architecture and preservation | None |
| Selecta 3.1 / 0078–0088 | [3.1 evidence](selecta-3-1-evidence.md) | Visual QA framework | None |
| Selecta 4 / 0089–0113 | [4.0 evidence](selecta-4-evidence.md) | Broad surface contracts | None |
| Experience EX / 0114–0134 | [Experience evidence](selecta-experience-evidence.md) | User intention and journey | None |
| Immersive MI / 0135–0164 | [MI status](selecta-microinteraction-status-reconciliation.md) | Existing accepted design and source-level motion | None; published 208 Implemented, 4 In progress, 28 Not started, 0 independently Verified, not reaudited |
| **Creative CI / 0165–0184** | [New ledger](selecta-creative-interface-implementation-evidence.md) | New cross-screen musical object identity and human acceptance | **140 Not started, 0 Implemented, 0 Verified** |

Before implementing CI: compare actual current main with related MI source/test and its exact SHA. A prior implemented hover/animation does not automatically implement a new cross-surface song/seam identity; conversely, existing code that meets a requirement should be reused, not rewritten. If a CI requirement is redundant, revise/reject or supersede it with dated decision, do not mark it done without task-specific evidence.

Historical programmes overlap in scope and different baselines. Do NOT sum all historic task counts to estimate unique remaining work. No source-level code or visual acceptance is claimed by this new ADR PR.