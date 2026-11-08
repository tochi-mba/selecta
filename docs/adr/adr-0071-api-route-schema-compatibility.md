# ADR-0071: Frontend domain boundaries, additive APIs and route compatibility

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** Not started
- **Documentation status:** Drafted in the Selecta 3.0 documentation-only proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.0 complete experience overhaul
- **Phase:** 1 - Architecture
- **Extends existing decisions:** ADR-0005, ADR-0026, ADR-0030
- **Dependencies:** [programme roadmap](selecta-3-roadmap.md) and verified baseline; see phase order.
- **Work item statuses:** Every S3-0071-XX item below is **Not started**. No runtime feature, test or UI change is claimed by this ADR.

## Context and rationale

The overhaul adds possible job views, richer state and redesigned selection flows, but Selecta already has working backend APIs and persisted local data. Replacing them without reason would magnify regression risk.

## Decision proposed

Keep backend contracts authoritative and migrate frontends through adapters/selectors. Introduce versioned or additive API data only when a reviewed feature cannot be expressed with existing endpoints. Preserve old routes, persisted identifiers and user settings.

## Experience and frontend architecture

- Define typed DTO boundaries, canonical readiness projection and invalid/unknown field fallbacks; no UI component should independently infer backend status from single partial field. All mutations require resource identity, mix scope and stale-revision semantics appropriate to the endpoint.

- Where durable export jobs or secure native folder selection require new capabilities, write compatibility contract first, support old server response where possible and distinguish unavailable capability from an error. Never change database schema as a side-effect of CSS migration.

- Use route aliases rather than broken links; preserve query-param filters, Edit draft IDs, Back/Forward, installed-app routing and server-side SPA fallback. Changes are reversible by feature flag or staged deployment.

## Detailed implementation work (all Not started)

1. **S3-0071-01 - Not started.** Inventory all frontend API calls and payload variants, including nullable/missing legacy fields.
2. **S3-0071-02 - Not started.** Define canonical typed adapters and compare them against existing Python contract tests.
3. **S3-0071-03 - Not started.** Specify idempotency, revision guards and conflict response for each high-risk mutation.
4. **S3-0071-04 - Not started.** Design any additional export/folder/search API contract as an isolated ADR amendment and server review.
5. **S3-0071-05 - Not started.** Maintain backward compatibility with old persisted mix/draft identifiers and existing routes.
6. **S3-0071-06 - Not started.** Build migration fixtures and test old/new server combinations where realistically supported.
7. **S3-0071-07 - Not started.** Add route/history/query compatibility and unknown server-response tests.
8. **S3-0071-08 - Not started.** Document staged frontend feature flags and rollback that preserves user records.

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
