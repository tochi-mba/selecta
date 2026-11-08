# ADR-0062: Scalable Library search, filters, rows and pagination

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** Not started
- **Documentation status:** Drafted in the Selecta 3.0 documentation-only proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.0 complete experience overhaul
- **Phase:** 5 — Discovery and operations
- **Extends existing decisions:** ADR-0017, ADR-0034, ADR-0043
- **Dependencies:** [programme roadmap](selecta-3-roadmap.md) and verified baseline; see phase order.
- **Work item statuses:** Every S3-0062-XX item below is **Not started**. No runtime feature, test or UI change is claimed by this ADR.

## Context and rationale

Library supports URL-based search, Ready/Not yet/Priority/Set aside/Everything filters, ordering, pages of 100 and per-song actions. A readiness-only default risks making imported songs appear missing, while dense rows and long metadata compete with advanced actions.

## Decision proposed

Use a search-first Library with explicit filter scope, compact/comfortable density, contextual actions and responsive detail panel. Favor Everything as the proposed default, subject to usage testing; preserve Ready and all other filters and existing URL behavior.

## Experience and frontend architecture

- Search, filter, sort and pagination state are captured in URLs and restored across Back/Forward. Keep prior data visible during refresh but identify stale content and avoid announcing an empty library on fetch failure.

- Rows emphasize song title and artist; technical metrics occupy stable secondary columns. High-frequency actions remain directly reachable, less frequent actions enter accessible menus; no action is hover-only on touch.

- For 20,000 songs, profile scroll/fetch/render before virtualization; if introduced, retain roving focus, stable row identity, screen-reader list semantics and scroll restoration.

## Detailed implementation work (all Not started)

1. **S3-0062-01 — Not started.** Create a Library header with search, filter controls, sort and real readiness summary.
2. **S3-0062-02 — Not started.** Redesign row hierarchy and optional compact density without losing playback/analysis/set-aside actions.
3. **S3-0062-03 — Not started.** Select default filter from measured task research; if changed, preserve existing saved query behavior.
4. **S3-0062-04 — Not started.** Make all search/filter/sort/deep-link combinations deterministic and keyboard accessible.
5. **S3-0062-05 — Not started.** Implement stale-request cancellation and a truthful refreshing/failure experience.
6. **S3-0062-06 — Not started.** Preserve 100-item incremental loading or a tested equivalent with stable scroll and selection.
7. **S3-0062-07 — Not started.** Profile 20k tracks under background analysis and implement targeted optimization only if needed.
8. **S3-0062-08 — Not started.** Test long/unicode/RTL/duplicate/missing metadata and touch row actions.

## Preservation and integration constraints

This work must preserve all applicable capabilities in [the existing feature-parity ledger](feature-parity.md): original source music and library data; drafts, user corrections, ratings and preferences; correct current-versus-draft mutation isolation; original routes; honest playable/render readiness; a single audio owner with no unintended stop or overlap; explicit request bridge consent and atomic insertion; accurate revision-bound FLAC; and secure localhost/origin privacy. New dependencies, API fields or native integration require separately reviewed contracts; the design does not itself authorize backend replacement.

## Required tests and edge-case verification (not yet executed)

- Queries with special characters and out-of-order responses; URL reload and Back/Forward.
- 20k rows, repeated Show more and server changes mid-pagination without duplicates/holes.
- Action availability under partial readiness; no mismatch between row label and canonical ability.

General test dimensions: dark and light; initial/populated/empty/partial/refreshing/busy/failed/offline/recovery; 320px–4K; zoom, pointer and keyboard; realistic long/missing/duplicate/RTL metadata; accessibility checks; stale response and race tests; representative local-audio playback where relevant. Existing tests may be adapted to accessible semantics but not deleted or weakened.

## Alternatives, risks and trade-offs

Move to a complex spreadsheet interface: efficient for a subset of experts but hurts casual users. Keep the existing rows unchanged: least risk but misses discoverability and density issues. The proposed design balances both.

## Acceptance and evidence

Users can find every imported song, understand applied filters, and operate a large library without losing context or invoking unsupported actions.

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
