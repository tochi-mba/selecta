# ADR-0071: Frontend domain boundaries, additive APIs and route compatibility

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** In progress: 7 of 8 tasks implemented with automated evidence on 2026-11-11; 1 need a person; 0 still open
- **Documentation status:** Drafted in the Selecta 3.0 documentation-only proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.0 complete experience overhaul
- **Phase:** 1 - Architecture
- **Extends existing decisions:** ADR-0005, ADR-0026, ADR-0030
- **Dependencies:** [programme roadmap](selecta-3-roadmap.md) and verified baseline; see phase order.
- **Work item statuses:** Recorded on each item below (2026-11-11). Implemented means its automated evidence ran green; nothing here is independently Verified.

## Context and rationale

The overhaul adds possible job views, richer state and redesigned selection flows, but Selecta already has working backend APIs and persisted local data. Replacing them without reason would magnify regression risk.

## Decision proposed

Keep backend contracts authoritative and migrate frontends through adapters/selectors. Introduce versioned or additive API data only when a reviewed feature cannot be expressed with existing endpoints. Preserve old routes, persisted identifiers and user settings.

## Experience and frontend architecture

- Define typed DTO boundaries, canonical readiness projection and invalid/unknown field fallbacks; no UI component should independently infer backend status from single partial field. All mutations require resource identity, mix scope and stale-revision semantics appropriate to the endpoint.

- Where durable export jobs or secure native folder selection require new capabilities, write compatibility contract first, support old server response where possible and distinguish unavailable capability from an error. Never change database schema as a side-effect of CSS migration.

- Use route aliases rather than broken links; preserve query-param filters, Edit draft IDs, Back/Forward, installed-app routing and server-side SPA fallback. Changes are reversible by feature flag or staged deployment.

## Detailed implementation work

1. **S3-0071-01 - Implemented.** Inventory all frontend API calls and payload variants, including nullable/missing legacy fields. **Evidence:** docs/adr/selecta-3-api.md 'Every call the frontend makes', 'Other writes the local app makes' and 'Fields that may be missing'; web/src/s3-0071-api-inventory.test.ts 'finds the calls it is checking' and 'every address a local page calls is in docs/adr/selecta-3-api.md' (passed 2026-11-11).
2. **S3-0071-02 - Implemented.** Define canonical typed adapters and compare them against existing Python contract tests. **Evidence:** web/src/api.ts typed client, the only local fetch (web/src/importBoundaries.test.ts 'only api.ts talks to the local server with fetch, apart from the listed byte streams'); compared with the server by tests/test_api_contract_fixtures.py test_each_read_still_answers_with_its_recorded_shape and test_the_shape_check_allows_additions_and_catches_removals (passed 2026-11-11).
3. **S3-0071-03 - Implemented.** Specify idempotency, revision guards and conflict response for each high-risk mutation. **Evidence:** docs/adr/selecta-3-api.md 'How each kind of write stays safe'; tests/test_api_contracts.py test_guarded_replay_returns_original_response_after_its_own_mix_change, test_different_operations_each_happen, test_a_refusal_is_remembered_too_rather_than_being_tried_again and test_a_change_to_the_mix_it_saw_goes_through (passed 2026-11-11).
4. **S3-0071-04 - Needs a person.** Design any additional export/folder/search API contract as an isolated ADR amendment and server review. **Status:** Needs a person: the export and folder contracts are written as amendments in docs/adr/selecta-3-api.md 'Export: what it did, and what it does now' and docs/adr/selecta-3-privacy.md 'Choosing a folder', but the server review they ask for is a reviewer's call
5. **S3-0071-05 - Implemented.** Maintain backward compatibility with old persisted mix/draft identifiers and existing routes. **Evidence:** web/src/sfCompat.test.ts 'each older address opens exactly the page its replacement opens, never "missing"' and 'older Workspace tab addresses open the same Workshop tab'; web/src/router.test.tsx 'a draft is always told apart from the current mix'; tests/test_api_contract_fixtures.py test_every_pre_redesign_route_is_still_offered (passed 2026-11-11).
6. **S3-0071-06 - Implemented.** Build migration fixtures and test old/new server combinations where realistically supported. **Evidence:** tests/test_api_contract_fixtures.py recorded pre-redesign response fixtures (test_each_read_still_answers_with_its_recorded_shape, test_every_pre_redesign_route_is_still_offered); a newer server's unknown values: web/src/views/ExportJobs.test.tsx 'names every stage distinctly, and an unknown one as unknown rather than ready'; old and new builds over one preference store: web/src/state/prefsRollback.test.ts 'old to new to old keeps the theme and every choice the old build made' (passed 2026-11-11).
7. **S3-0071-07 - Implemented.** Add route/history/query compatibility and unknown server-response tests. **Evidence:** web/src/router.test.tsx 'every page’s address leads back to it', 'follows along, including Back', 'going where you already are adds nothing to Back' and 'remembers filters in the address, without adding to Back'; web/src/sfCompat.test.ts 'where an older address lands, the address written back is the current one'; unknown responses: web/src/views/ex-0128-job-truth.test.tsx 'a malformed or failed refresh keeps the last answer but says it may be out of date' (passed 2026-11-11).
8. **S3-0071-08 - Implemented.** Document staged frontend feature flags and rollback that preserves user records. **Evidence:** docs/flags.md and src/selecta/flags/*.json held by tests/test_flags.py; docs/adr/selecta-3-routes.md 'Going back: the kill switch'; web/src/flags.test.tsx 'sends classic Discover to whichever of its pages is there'; web/src/state/prefsRollback.test.ts 'new to old to new keeps motion and theme while the old build only reads' (passed 2026-11-11).

## Preservation and integration constraints

This work must preserve all applicable capabilities in [the existing feature-parity ledger](feature-parity.md): original source music and library data; drafts, user corrections, ratings and preferences; correct current-versus-draft mutation isolation; original routes; honest playable/render readiness; a single audio owner with no unintended stop or overlap; explicit request bridge consent and atomic insertion; accurate revision-bound FLAC; and secure localhost/origin privacy. New dependencies, API fields or native integration require separately reviewed contracts; the design does not itself authorize backend replacement.

## Required tests and edge-case verification (not yet executed)

- Old JSON fixture missing optional fields; unknown enum value; stale revision rejected safely.
- Deep link to all old paths and draft ID; reload with filters and browser history.
- Frontend rolled back after creating no new persisted schema; songs, ratings and drafts unaffected.

General test dimensions: dark and light; initial/populated/empty/partial/refreshing/busy/failed/offline/recovery; 320px–4K; zoom, pointer and keyboard; realistic long/missing/duplicate/RTL metadata; accessibility checks; stale response and race tests; representative local-audio playback where relevant. Existing tests may be adapted to accessible semantics but not deleted or weakened.

## Alternatives, risks and trade-offs

Rewrite API and data model to mirror new screens: conceptually neat, unnecessarily risky. A typed adapter and additive contracts preserve value and speed.

## Acceptance and evidence

Every existing API/route contract remains tested, and new optional capabilities degrade safely without corrupting old state.

Before marking **Implemented**, link implementing PR(s), commit(s), contract tests, component/integration/E2E tests, screenshots and rollback disposition in [the evidence ledger](selecta-3-evidence.md). Before marking **Verified**, additionally record human task testing, assistive technology and audible checks wherever the change affects them. No prospective metric is a completed observation.

## Status history

| Date | Decision | Implementation | Evidence |
|---|---|---|---|
| 2026-11-07 | Proposed | Not started | Documentation-only ADR; no application or test changes |
| 2026-11-08 | Accepted | Not started | Owner accepted all proposed ADRs ([#37](https://github.com/tochi-mba/selecta/pull/37)) |

## References

- [Selecta 3.0 roadmap and ADR status index](selecta-3-roadmap.md)
- [Selecta 3.0 implementation checklist](selecta-3-implementation-checklist.md)
- [Selecta 3.0 verification matrix](selecta-3-verification-matrix.md)
- [Prior feature preservation contract](feature-parity.md)
- [Prior test coverage](test-coverage-matrix.md)
