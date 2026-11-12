# ADR-0043: Scannable Library, actionable Workshop and polished export/study flows

- **Decision status:** Accepted (owner requested implementation in PR #23)
- **Implementation status:** In progress ([#23](https://github.com/tochi-mba/selecta/pull/23)); 2026-11-10 reconciliation: 12 of 12 tasks ticked (P0100-P0111); P0103 and P0104 ticked 2026-11-12 after `polish-p0103-scroll.e2e.ts`, MP-0291-06 and MP-0291-07 passed in CI run 43123598913. See the [evidence ledger](polish-implementation-evidence.md).
- **Proposed:** 2026-11-06
- **Programme:** UI/UX polish
- **Delivery phase:** 5 - Library, discovery and operations
- **Extends:** [ADR-0017](adr-0017-library-scale-and-readiness.md), [ADR-0018](adr-0018-library-corrections-and-folders.md), [ADR-0020](adr-0020-workshop-and-storage.md), [ADR-0021](adr-0021-blind-listening.md), [ADR-0022](adr-0022-flac-export.md), [ADR-0032](adr-0032-diagnostics-and-operations.md); does not silently supersede their behavioural contracts.
- **Dependencies:** ADR-0034 and ADR-0044 foundations, ADR-0035 shared controls and ADR-0036 asynchronous states. Apply ADR-0045 accessibility requirements during implementation.
- **Checklist:** P0100–P0111 in [polish implementation checklist](polish-implementation-checklist.md).

> The owner requested implementation in PR #23 after the planning review. Functionality is written first; verification follows. Checkboxes require actual evidence, including any remaining human checks.

## Context and evidence boundary

Library rows expose several actions alongside metadata and readiness. Workshop includes a developer-facing ControlStates disclosure. Export already waits for transitions and exposes FLAC download; its lifecycle and the blind-study states need complete visual/recovery treatment.

## Proposed decision and rationale

Reduce routine information density through consistent hierarchy and accessible secondary actions. Organize maintenance around current work and next steps, give export a truthful lifecycle, and preserve blind-study protocol and privacy.

## Compatibility and product invariants

Preserve the existing feature and route inventory, local-first privacy, source files, drafts and ratings, explicit current/draft mutation scope, single audio ownership, bridge approval and atomic joining, and truthful export identity. Do not remove capability or weaken behavioural tests to obtain a cleaner screenshot. New API, schema, engine or platform work requires an explicitly scoped implementing change; this proposal alone does not authorize it.

## Implementation sequence and acceptance details

1. **P0100:** Prioritize Library title/artist/readiness and relevant action; group secondary actions without hover-only access.
2. **P0101:** Unify search/filter/sort/count presentation and provide clear-filter recovery for empty search results.
3. **P0102:** Keep analysed versus mix-ready, detected versus corrected, Never play versus Set aside, and priority versus readiness distinct.
4. **P0103:** Preserve filter/query/scroll/focus through song details, correction saves, errors and return navigation.
5. **P0104:** Verify 20,000-song responsiveness with realistic metadata/action density and pagination or rendering strategy.
6. **P0105:** Organize Workshop overview, analysis, storage, sources, learning and diagnostics around actual work and useful actions.
7. **P0106:** Move the developer state showcase out of everyday Workshop navigation while retaining a development review surface.
8. **P0107:** Distinguish storage budget, cache usage, free disk and protected content; reconcile controls to confirmed saved values.
9. **P0108:** Specify export preparation/render/file-creation/success/download/error states, mix snapshot identity and close/reopen behaviour based on actual backend support.
10. **P0109:** Provide direct recovery from failed export transitions and verify the downloaded FLAC matches the intended mix.
11. **P0110:** Polish blind-study validation, audio switching, partial responses, retry and completion without revealing conditions or changing scoring/protocol.
12. **P0111:** Verify disconnected sources, low disk, worker pause/restart, stale storage writes and private-diagnostic redaction.

## Required tests and edge cases

Use the applicable cases in [the polish verification matrix](polish-verification-matrix.md), plus the task-specific cases above. Review both themes, loading-to-content transitions, narrow and wide layouts, keyboard/focus, long or missing metadata and failed/retried operations. For audio-affecting surfaces, include real audio ownership and continuity checks; for data-affecting actions, include current/draft identity and stale-response checks. Mark a case not applicable only with a recorded reason.

## Alternatives and trade-offs

Removing expert controls or shortening study questions would change capability or evaluation meaning. Moving infrequent controls into clear secondary surfaces retains access while improving scanability.

## Acceptance and status update

Users can find and assess songs, resolve operational blockers and export the intended mix; study presentation remains neutral and submissions recoverable.

The owner accepted proceeding with implementation in PR #23. Implementation progresses Not started → In progress → Implemented → Verified using linked evidence. Only implemented and verified work can satisfy runtime tasks. Record partial work and unperformed human checks in [the polish evidence ledger](polish-implementation-evidence.md); do not infer success from a checkbox in the previous programme.

| Date | Decision status | Implementation status | Evidence |
|---|---|---|---|
| 2026-11-06 | Proposed | Not started | Original documentation-only proposal |
| 2026-11-06 | Accepted | In progress | Owner requested full implementation and merge after green CI in PR #23; verification pending |

## References

- [Polish programme and roadmap](polish-roadmap.md)
- [Polish implementation checklist](polish-implementation-checklist.md)
- [Research and source-inspection notes](../research/ui-ux-polish.md)
- [Existing feature parity](feature-parity.md)
- [Existing test coverage](test-coverage-matrix.md)
