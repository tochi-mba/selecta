# ADR-0028: Backend-offline recovery, conflicts and multiple tabs

- **Decision status:** Proposed
- **Implementation status:** Not started
- **Proposed:** 2026-11-06
- **Delivery phase:** 3–12
- **Scope:** Proposed future implementation; no code changes made by this ADR.

> Merging this proposal does not mean the decision is accepted or the implementation has started. Update both statuses with a PR link and verification evidence when work actually occurs.

## Context

Disconnected local servers, stale polls, sleeping browsers and multiple editing tabs can create false empty screens and destructive races.

## Proposed decision and rationale

- Differentiate validation, not-found, conflict, offline, storage and render errors.
- Do not show server failures as empty library or no requests.
- Keep last known safe snapshots and explicit reconnect/retry with appropriate caution.
- Define active player ownership/takeover across tabs; prevent simultaneous audio where possible.
- Treat resource revision conflicts as visible decisions, never silent last-response overwrites.

## Compatibility and product invariants

- Durable operations remain backend-authoritative; no invented offline mode for analysis and render.

## Implementation sequence

- Introduce centralized connectivity and error UX, then targeted failure injection.

## Required tests and edge cases

- Server stop/restart during export, stale request poll, two windows, memory tab suspension, retry after timeout and malformed JSON.

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
