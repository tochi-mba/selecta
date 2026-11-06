# ADR-0022: Rendered FLAC export and artifact lifecycle

- **Decision status:** Proposed
- **Implementation status:** Not started
- **Proposed:** 2026-11-06
- **Delivery phase:** 6
- **Scope:** Proposed future implementation; no code changes made by this ADR.

> Merging this proposal does not mean the decision is accepted or the implementation has started. Update both statuses with a PR link and verification evidence when work actually occurs.

## Context

Export may depend on unfinished seam rendering and should represent a real downloadable artifact, not a hopeful request.

## Proposed decision and rationale

- Provide an export panel showing exact target mix/revision, required pending renders, current status, format and finished download link.
- Preserve FLAC; do not show new formats until supported by backend.
- Define snapshot/invalidation if edits happen during export.
- Confirm server completion before offering file.

## Compatibility and product invariants

- Original songs and draft/current content unaffected by exporting; downloaded file is decodable and from intended mix.

## Implementation sequence

- Add operation identity and render dependency presentation; retain existing export endpoint compatibility.

## Required tests and edge cases

- All seams ready, partly ready, corrupt seam, disk full, switch draft, stale URL and decode-verify downloaded FLAC.

## Alternatives and trade-offs

Retaining the old UI permanently would avoid immediate migration risk but preserve the documented usability problems. A single simultaneous rewrite would be faster to describe but harder to verify and roll back. Implement this ADR incrementally, preserve the backend/audio contracts, and reject any proposal that cannot meet the stated invariants.

## Acceptance and status update

Implementation may move to **In progress** only when a linked implementation PR exists; to **Implemented** only when the intended behaviour and associated tests are merged; and to **Verified** only with relevant automated, browser, accessibility, audio and migration evidence recorded. The [feature-parity matrix](feature-parity.md) and [test plan](test-coverage-matrix.md) must be updated alongside it.

| Date | Decision status | Implementation status | Evidence |
|---|---|---|---|
| 2026-11-06 | Proposed | Not started | Documentation-only plan |

## References

- [ADR index](README.md)
- [Implementation roadmap](implementation-roadmap.md)
- [Existing acceptance ledger](../acceptance.md)
- [Existing UI/UX research](../research/ui-ux.md)
