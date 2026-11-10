# ADR-0095: Truthful asynchronous state, revision guards, Undo, recovery and multi-tab consistency

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** 8/10 Implemented, 2 In progress (per-task source and test reconciliation 2026-11-10)
- **Verification status:** Not verified (0/10)
- **Documentation status:** Drafted, documentation-only Selecta 4.0 proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 4.0 complete UI/UX overhaul
- **Phase:** 1 Foundations / cross-cutting
- **Extends, does not automatically supersede:** ADR-0005, ADR-0028, ADR-0052, ADR-0080
- **Source surfaces to reconcile:** `web/src/state/*`; `web/src/api.ts`; `web/src/views/Requests.tsx`; `web/src/views/Mix.tsx`
- **Tasks:** S4-0095-01 through S4-0095-10 in [the Selecta 4.0 checklist](selecta-4-implementation-checklist.md)
- **Baseline:** `main` `9b663f9f10212619f27ce67ce82f602347065cbd` (after merged PRs #25 and #26)

## Context and evidence boundary

Backend tasks continue after overlays close and network responses can arrive out of order. A visual rewrite must not turn stale results into apparently successful writes or wrong-scope edits.

This is a **proposal**. Source inspection and earlier planning documents establish current contracts and candidate risks; they do not establish verified visual quality, human task success, real audio quality, screen-reader usability or shipped implementation of this ADR. Earlier programme status headings can be stale and are not inherited as verified work.

## Proposed decision

Define shared presentation-state vocabulary but preserve distinct domain state machines. Carry scope, operation ID and revision through mutations; server state is authoritative, optimistic UI is reversible, and retries require idempotency.

## Experience, frontend and interaction specification

- User-facing concepts: waiting, working, needs a choice, ready, degraded, failed, stale, recovering, cancelled.
- Each operation distinguishes local acceptance, server acknowledgment and completed output.
- Undo is scoped by exact mix/draft and operation; Activity's in-memory history cannot be labelled permanent.
- Reads may back off/retry; writes cannot blindly retry after ambiguous acceptance.

## Detailed implementation work

1. **S4-0095-01 - Inventory domain state machines and user-visible labels.** Acceptance: Request/export/analysis/render statuses translate truthfully without data loss. Required verification: State transition table per domain. **Implementation: In progress (2026-11-10). Evidence: truthful label mapping in `web/src/state/readiness.ts`, `web/src/state/jobs.ts`, `web/src/lib.ts` with `readiness.test.ts`, `jobs.test.ts`, `lib.test.ts`; no per-domain state transition table document yet. Verified: No.**
2. **S4-0095-02 - Create mutation scope/operation/revision contracts.** Acceptance: Late response cannot target a newer pair or different draft. Required verification: Out-of-order mutation tests. **Implementation: Implemented (2026-11-10). Evidence: `tests/test_api_contracts.py::test_a_change_to_a_mix_that_has_moved_on_stops`, `::test_a_draft_is_checked_against_itself_not_the_current_mix`; `web/src/views/Mix.test.tsx` 'never confuses two different drafts with identical songs and transition keys'; `web/e2e/flows.e2e.ts` 'a change to a mix that's moved on stops', run 2026-11-10. Verified: No.**
3. **S4-0095-03 - Define last-intent-wins versus server-authoritative cases.** Acceptance: Newer local intent preserved while conflicts remain visible. Required verification: Rapid transition choice, energy and preference tests. **Implementation: Implemented (2026-11-10). Evidence: `web/src/views/Mixes.test.tsx` 'serializes rapidly changed feel settings so the last selection wins'; `web/src/views/Mix.test.tsx` 'keeps the latest choice visible when an older server response refreshes the inspector'; `web/e2e/finishing.e2e.ts` 'two quick seam changes on a slow server: the last one wins', run 2026-11-10. Verified: No.**
4. **S4-0095-04 - Enforce safe idempotency and retry policy.** Acceptance: No duplicated request, bridge, export or song insert on timeout/retry. Required verification: Ambiguous commit and duplicate-submit fault tests. **Implementation: Implemented (2026-11-10). Evidence: `tests/test_api_contracts.py::test_the_same_operation_sent_twice_only_happens_once`, `::test_sent_twice_at_the_same_moment_it_still_only_happens_once`; `tests/test_operation_identity.py`; `tests/test_export_retry.py`; `web/e2e/integration.e2e.ts` 'two requests at once: no song goes in twice', run 2026-11-10. Verified: No.**
5. **S4-0095-05 - Standardize pending, stale, offline and recovery UI.** Acceptance: Offline does not erase last confirmed data or imply failure. Required verification: Server disconnect/reconnect E2E. **Implementation: Implemented (2026-11-10). Evidence: `web/e2e/flows.e2e.ts` 'when the server stops answering' (3 tests); `web/src/shell/Shell.test.tsx` 'says so across the top, and what's on screen stays'; `web/src/state/async.test.tsx` 'keeps the last good answer only for a failed refresh of the same key', run 2026-11-10. Verified: No.**
6. **S4-0095-06 - Preserve scoped Undo order and Activity semantics.** Acceptance: Wrong-scope Undo is impossible; older Undo blocked with explanation. Required verification: Draft A/B plus intervening operation tests. **Implementation: Implemented (2026-11-10). Evidence: `web/src/shell/Shell.test.tsx` 'undoes the mix it was about', 'Z will not mutate a draft until its exact identity and Undo state have loaded'; `web/src/ui/controls.test.tsx` 'keeps older Undo blocked'; `tests/test_drafts.py::test_undo_in_a_draft_only_undoes_that_draft`; `web/e2e/integration.e2e.ts` draft/current Undo, run 2026-11-10. Verified: No.**
7. **S4-0095-07 - Audit polling ownership/backoff and tab visibility.** Acceptance: No duplicate loops, stale deep Library rows or backend overload. Required verification: Background tab and multi-view poll tests. **Implementation: Implemented (2026-11-10). Evidence: `web/src/ui/useVisiblePoll.test.tsx` (hidden tabs, no overlap, failed read); `web/src/views/Library.test.tsx` 'reloads an edited song on a middle page'; `web/e2e/integration.e2e.ts` 'a hundred quick looks at a page never lose what's on it', run 2026-11-10. Verified: No.**
8. **S4-0095-08 - Implement user-friendly conflict and supersession notices.** Acceptance: Conflict reveals exact object and safe next action. Required verification: Two-tab edit, deleted target and newer revision tests. **Implementation: Implemented (2026-11-10). Evidence: `web/e2e/flows.e2e.ts` 'a change to a mix that's moved on stops, says so, and touches nothing'; `web/src/App.test.tsx` 'says so if the draft has gone'; `web/src/views/Studio.test.tsx` 'a mix that moved on refuses the shape', run 2026-11-10. Verified: No.**
9. **S4-0095-09 - Validate browser storage and migration fallbacks.** Acceptance: Malformed or denied preferences cannot crash or claim persistence. Required verification: Storage denial/quota/version migration tests. **Implementation: Implemented (2026-11-10). Evidence: new `web/src/state/prefsStorage.test.ts` (malformed, wrong-type, denied read, quota on save) and `web/src/views/inspectorResize.test.tsx`; `web/src/views/Studio.test.tsx` 'ignores a corrupted local grid', run 2026-11-10. Verified: No.**
10. **S4-0095-10 - Publish invariant-oriented model/property tests.** Acceptance: Single audio owner, atomic bridge, snapshot export and scoped writes hold. Required verification: Property and model-based race suite. **Implementation: In progress (2026-11-10). Evidence: race invariants are covered by example-based suites (`focus.test.tsx`, `test_api_contracts.py`, `integration.e2e.ts`); no property/model-based race suite exists for the local app. Verified: No.**

## Required negative cases and regression strategy

- Server accepts mutation but response disappears; retry must be safe.
- Edit Draft A, switch to Draft B, then A response resolves; no B mutation.
- A cancelled request cannot reappear after late poll; failed fetch is not an empty authoritative list.
- Exercise light, dark and system themes; empty, loading, partial, ready, stale, failed, offline and recovering states where applicable.
- Exercise 320/375/390/430/768/1024/1280/1440/1920 CSS-pixel widths, short viewports, 200/400% zoom, keyboard, touch, reduced motion, realistic long/missing/duplicate/Unicode/RTL metadata.
- Maintain existing frontend, API, audio and Python assertions; changed markup may require selector updates but never weakened behavioural contracts.

## Preservation and dependencies

Retain the [existing Selecta 3.0 invariants INV-01–INV-20](selecta-3-roadmap.md) and [3.1 preservation contract](selecta-3-1-roadmap.md): no original-file mutation; local-first security and LRCLIB disclosure; no loss of current/draft state, preferences, corrections or ratings; stable old routes; one audio owner; exact request consent and atomic join; truthful requested-versus-rendered state; revision-pinned decodable FLAC; full keyboard alternatives and regression assertions. No backend, schema, audio-engine or dependency rewrite is authorized by this ADR. See [4.0 parity matrix](selecta-4-feature-parity.md) and [verification matrix](selecta-4-verification-matrix.md).

## Alternatives, risks and trade-offs

Some operations cannot be optimistically presented as complete without sacrificing truthful state.

## Evidence and advancement rules

An owner must separately **Accept** this decision before it becomes policy. Each implementing PR must name the S4-0095 task IDs, actual commit(s), changed files, pre-existing regression tests, new negative/concurrency cases, theme/viewport screenshots and relevant human/audible/AT evidence. **Implemented** requires merged code and applicable automated checks; **Verified** additionally requires independent real acceptance relevant to the change. An unchecked checkbox means not Verified. A docs merge does not advance these statuses.

## Status history

| Date | Decision | Implementation | Verification | Evidence |
|---|---|---|---|---|
| 2026-11-07 | Proposed | Not started | Not verified | Documentation-only specification; no runtime, test or UI changes |
| 2026-11-08 | Accepted | Not started | Not verified | Owner accepted all proposed ADRs ([#37](https://github.com/tochi-mba/selecta/pull/37)) |
| 2026-11-10 | Accepted | 8/10 Implemented, 2 In progress | Not verified | Per-task source and test reconciliation; each task names the automated checks run on 2026-11-10 and any check that needs a person |

## Related documents

- [Selecta 4.0 roadmap and ADR index](selecta-4-roadmap.md)
- [4.0 implementation checklist](selecta-4-implementation-checklist.md)
- [4.0 per-task evidence ledger](selecta-4-evidence.md)
- [4.0 verification and edge-case matrix](selecta-4-verification-matrix.md)
- [4.0 release readiness criteria](selecta-4-release-gates.md)
- [Earlier 3.1 implementation checklist](selecta-3-1-implementation-checklist.md)
