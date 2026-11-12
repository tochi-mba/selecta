# ADR-0366 - Unified finish charter, current-source baseline and ADR parity

- **Decision:** Accepted (requester approved all 24 UF ADRs on 2026-11-08; implementation and independent acceptance remain separate).
- **Implementation:** 0/8 Not started; 0/8 In progress; 8/8 Implemented (1/8 ticked in the checklist with automated evidence, 2026-11-12; the person steps stay open).
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Selecta Unified Experience Finish (UF); 2026-11-08; `main` `f17944530d54203e49baebdabc08a57ee9f40526`.
- **Priority / phase:** P0 / 01 Baseline. **Owner:** Unassigned. **Implementing PR/SHA:** -.
- **Existing ADR owners:** ADR-0199, ADR-0239, ADR-0272, ADR-0299, ADR-0365; unchanged.
- **Source touchpoints (review, not implementation):** `docs/adr/README.md`; `web/src/App.tsx`.

## Context and evidence boundary

The current UI already supports significant parts of this workflow. No code, browser, accessibility, real-audio or human task evaluation is claimed by this documentation proposal. A new UF acceptance item does not prove that matching source functionality is absent. Reconcile each item against current source, tests and previous accepted ADR decisions at the later implementing SHA.

## Proposed decision

Establish one additive source-verifiable finishing backlog, without reinterpreting historical statuses or proposing duplicate missing features.

## User outcome and interaction contract

Users complete the named journey with clear action consequences, predictable controls and recoverable failure states. Test empty, partial, loading, stale, offline, failed, duplicate/long/RTL metadata, mobile, high zoom and relevant audio interruptions. Evidence must show the design improves comprehension without changing protected musical behaviour.

**Preservation and trade-offs:** Keep original music local/unchanged, one authoritative audio owner and deliberate Pause, exact recording/mix/draft/revision/occurrence/seam identities, guarded Undo, consented atomic request bridges, real valid ready-only seams, eight Studio lanes/8–64 cells, true library readiness and lyric provenance, frozen-revision decodable FLAC and blinded human evaluation. No SaaS, telemetry, engine rewrite or unsolicited upload.

## Implementation checklist - 6/8 Implemented; 0/8 independently Verified

1. **UF-0366-01 - Pin a real source baseline.** **Acceptance:** Record main SHA, route inventory and exact UI state for the starting candidate. **Required verification:** Compare source, build and capture manifest. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-10, coordinator commits); **Evidence:** baseline SHA, candidate branch, starting UI state and route inventory in docs/adr/adr-0366-unified-finish-charter-and-parity.md; web/src/ufBaseline.test.ts (3/3 passed) checks every listed address, alias and page kind against web/src/router.ts; capture manifest web/e2e/paired-theme.e2e.ts (2026-11-10); **Evidence/reviewer:** independent reviewer -.
2. **UF-0366-02 - Map old programme owners.** **Acceptance:** Crosswalk foundational, Flow, gap/final/micro-polish, Lucy and Library decisions. **Required verification:** Independent ADR link and owner audit. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-10, coordinator commits); **Evidence/reviewer:** per-ADR owner crosswalk (T/P/S3/S31/S4/EX/MI/CI, SF, GP/FP/MP, LU, LX) in docs/adr/selecta-unified-finish-overlap-and-parity.md, linked from ADR-0366 (2026-11-10); Needs a person: independent ADR link and owner audit. Independent reviewer -.
3. **UF-0366-03 - Classify each candidate gap.** **Acceptance:** Mark already satisfied, refinement, new, verification-only, duplicate or deferred with exact delta. **Required verification:** Sample current source and related evidence. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-10, coordinator commits); **Evidence/reviewer:** classification rule in ADR-0366 applied line by line for ADR-0366 to ADR-0377 (already satisfied = earlier owner's test, refinement = new UF test, verification only = Needs a person, duplicate = LX-owned) plus crosswalk tables in ADR-0376 and ADR-0377 (2026-11-10); Needs a person: sample current source against the classifications. Independent reviewer -.
4. **UF-0366-04 - Register critical user journeys.** **Acceptance:** Include first-run, listener, expert editor, returning user and errors. **Required verification:** Route and task walkthrough. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-10, coordinator commits); **Evidence/reviewer:** docs/adr/completion/journeys.md registers first-run listener, requester, creator, expert editor and returning journeys with failure, recovery and the walking test, linked from ADR-0366 (2026-11-10); Needs a person: route and task walkthrough. Independent reviewer -.
5. **UF-0366-05 - Record preservation invariants.** **Acceptance:** Protect local audio, one player, exact IDs, Undo, consent, eight-lane Studio and FLAC. **Required verification:** Current test/contract traceability review. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-10, coordinator commits); **Evidence/reviewer:** invariant-to-test table in ADR-0366 (local audio byte-for-byte, one player, exact IDs, scoped Undo, consent, eight-lane Studio, decodable FLAC) (2026-11-10); Needs a person: test/contract traceability review. Independent reviewer -.
6. **UF-0366-06 - Define exclusions.** **Acceptance:** No engine rewrite, cloud upload, accounts, telemetry or native bridge without separate approval. **Required verification:** Review exact source scope. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-10, coordinator commits); **Evidence/reviewer:** exclusions (no engine rewrite, music upload, accounts, telemetry or native bridge; Cloud is ADR-0391 to ADR-0416 behind its own flags) in ADR-0366 (2026-11-10); Needs a person: review exact source scope. Independent reviewer -.
7. **UF-0366-07 - Prioritise by critical risk.** **Acceptance:** Sequence correctness and comprehension ahead of animation and pixel-only polish. **Required verification:** Owner-approved dependency graph. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists-2` (2026-11-12, coordinator commits); **Evidence/reviewer:** code part built: proposed dependency graph generated from the code-status JSON by src/selecta/audit/uf_release_gate.py (dependency_graph, order_problems) into docs/adr/completion/uf-dependency-graph.md, phase by phase with correctness (P0) ahead of P1 and animation or pixel-only polish (ADR-0369, ADR-0375) last; tests/test_uf_person_evidence.py::test_the_proposed_order_puts_correctness_before_polish_and_respects_phases, ::test_the_dependency_graph_page_is_current (17/17 passed) (2026-11-12); Needs a person: the owner approves the dependency graph by setting dependency_graph_approved_by in docs/verification/uf/charter-approval.json. Independent reviewer -.
8. **UF-0366-08 - Approve unified charter.** **Acceptance:** Record named owner, date, rationale and any rejected proposed decisions. **Required verification:** Independent design decision audit. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists-2` (2026-11-12, coordinator commits); **Evidence/reviewer:** code part built: empty approval record docs/verification/uf/charter-approval.json and its checker charter_problems in src/selecta/audit/uf_release_gate.py (named owner, date, rationale, each rejected decision with a reason); tests/test_uf_person_evidence.py::test_the_charter_needs_a_named_owner_date_rationale_and_reasons (17/17 passed) (2026-11-12); Needs a person: the named owner fills docs/verification/uf/charter-approval.json with date, rationale and any rejected decisions, then an independent design decision audit. Independent reviewer -.

## Baseline, owners, journeys, invariants and exclusions (recorded 2026-11-10)

**Source baseline (UF-0366-01).** UF was planned against `main` `f17944530d54203e49baebdabc08a57ee9f40526` (2026-11-08). The implementing candidate is branch `feat/finish-checklists` on top of local `main` `405cf7ff06a4d4cb79fc7c9e0c02c25767219730`; the coordinator pins the final SHA when it commits. The starting UI state is: a fresh profile opens `/` on Make a Mix (browse tab), theme follows the system until chosen, comfortable density, motion follows the OS, every flag at its default in `src/selecta/flags/*.json`, no mix playing. The capture manifest is `web/e2e/paired-theme.e2e.ts` (matched Light/Dark states per route and viewport) and `web/e2e/visual.e2e.ts`. The route inventory below is checked against `web/src/router.ts` by `web/src/ufBaseline.test.ts`.

| Address | Page | Notes |
|---|---|---|
| `/` | mixes (browse) | default landing |
| `/mixes` | mixes (browse) | Make a Mix |
| `/mixes/mine` | mixes (mine) | My Mixes |
| `/mixes/lucy` | lucy | new conversation |
| `/mixes/lucy/<id>` | lucy | one conversation by id |
| `/mixes/drafts/<id>/edit` | edit | a draft by id |
| `/mix/current/edit` | edit | the current mix |
| `/listen` | listen | Listen |
| `/library` | library | Library |
| `/discover` | discover (words) | also `/discover/words` |
| `/discover/harmonic` | discover (harmonic) | |
| `/workshop` | workshop (overview) | Workspace |
| `/workshop/<tab>` | workshop | analysis, storage, sources, learning, diagnostics |
| `/listening` | listening | listening study |
| anything else | missing | a not-found page, never reinterpreted |

Older addresses kept as aliases: `/make`, `/make-a-mix`, `/explore`, `/explore/mixes`, `/explore/words`, `/explore/harmonic`, `/my-mixes`, `/workspace`, `/workspace/<tab>`, `/studies`.

**Old programme owners (UF-0366-02).** The per-ADR crosswalk of earlier owner ADRs, source touchpoints and the exact UF boundary is [selecta-unified-finish-overlap-and-parity.md](selecta-unified-finish-overlap-and-parity.md) (foundational T/P/S3/S31/S4/EX/MI/CI, Flow SF, gap/final/micro-polish GP/FP/MP, Lucy LU and Library LX).

**Gap classification (UF-0366-03).** Each UF task in ADR-0366 to ADR-0377 is classified on its own line in the [checklist](selecta-unified-finish-implementation-checklist.md): a task credited to an earlier owner's test is *already satisfied* (its Evidence names that test), a task with a new UF test is a *refinement*, a task that only a person can close is *verification only* (marked "Needs a person"), and LX-owned design work is *duplicate* and left to LX (see ADR-0376 and ADR-0377).

**Critical journeys (UF-0366-04).** [completion/journeys.md](completion/journeys.md) registers the first-run listener (folder, readiness, first play), live requester, mix creator, expert editor, scenes and returning user, with what can go wrong, the recovery and the automated test that walks each step.

**Preservation invariants (UF-0366-05) and their tests.**

| Invariant | Test that protects it |
|---|---|
| Local original audio is never changed | `tests/test_api_contracts.py::test_stopping_watching_leaves_every_music_file_byte_for_byte`, `tests/test_library_lx.py::test_reset_restores_the_measurement_and_leaves_the_file` |
| One player | `web/e2e/listen.e2e.ts` "only one tab plays at a time", `web/src/audio/focusEdges.test.tsx`, `web/e2e/mp-0281-mini-player.e2e.ts` MP-0281-07 |
| Exact IDs | `web/src/player.test.ts` "keeps the later occurrence when the same recording appears twice", `web/e2e/lx-library.e2e.ts` LX-0340-05 duplicate titles |
| Scoped Undo | `web/src/shell/Shell.test.tsx` "undoes the mix it was about, even after moving to another page", `web/src/ui/CommandPalette.test.tsx` |
| Consent | `web/e2e/mp-0290-requests.e2e.ts` MP-0290-04, `web/src/views/Lucy.test.tsx` remote provider consent |
| Eight-lane Studio | `web/src/views/gp-0261-studio.test.tsx` GP-0261-07 (eight lanes of 64 cells) |
| Decodable FLAC export | `tests/test_export_validation.py::test_complete_export_is_decoded_frame_by_frame` |

**Exclusions (UF-0366-06).** This programme does not rewrite the audio engine, upload music, add accounts, add telemetry or add a native bridge to the local app. Cloud work is its own programme (ADR-0391 to ADR-0416, `selecta-cloud-implementation-checklist.md`) behind its own flags and approval; nothing in ADR-0366 to ADR-0377 adds a network destination.

## Verification and release boundaries

Compare baseline/candidate at the same route, viewport, theme, density, fixture, current player/revision and scroll. Test Light/Dark/System/forced-colours, 320–3840px, short landscape, 200/400% zoom, keyboard/touch/AT and reduced motion where relevant. Synthetic muted browser tests and screenshots alone do not prove real-audio quality, independent accessibility acceptance or user comprehension.

**Research:** [Existing UI/UX research](../research/ui-ux.md) · [Polish research](../research/ui-ux-polish.md) · [WCAG 2.2](https://www.w3.org/TR/WCAG22/) · [ARIA APG](https://www.w3.org/WAI/ARIA/apg/patterns/) · [NN/g progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) · [Microsoft human-AI](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/).

## Decision, implementation and independent verification

**Accepted** by requester on 2026-11-08; future supersession requires owner/date/rationale. Implementation Not started → In progress → Implemented only after exact source/test PR, SHA and item-specific evidence. Independent verification No → Yes only with separate reviewer/date/device/OS/browser/AT and relevant real user/audio/visual measurements. Update ADR, checklist, evidence ledger and JSON together; preserve older status histories.

[Roadmap](selecta-unified-finish-roadmap.md) · [192-task checklist](selecta-unified-finish-implementation-checklist.md) · [evidence](selecta-unified-finish-implementation-evidence.md) · [JSON](selecta-unified-finish-code-status.json) · [parity](selecta-unified-finish-overlap-and-parity.md) · [interaction contract](selecta-unified-finish-experience-contract.md) · [verification](selecta-unified-finish-verification-matrix.md) · [reconciliation](selecta-unified-finish-status-reconciliation.md) · [release](selecta-unified-finish-release-gates.md)
