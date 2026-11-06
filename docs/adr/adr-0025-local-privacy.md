# ADR-0025: Local-only security, privacy and filesystem boundaries

- **Decision status:** Proposed
- **Implementation status:** Implemented ([#22](https://github.com/tochi-mba/selecta/pull/22))
- **Proposed:** 2026-11-06
- **Delivery phase:** 3–13
- **Scope:** Implemented in [#22](https://github.com/tochi-mba/selecta/pull/22). See its status above and the evidence file for anything left.

> Merging this proposal does not mean the decision is accepted or the implementation has started. Update both statuses with a PR link and verification evidence when work actually occurs.

## Context

Routing, source picker, diagnostics and state management must not accidentally expose private music or filesystem access.

## Proposed decision and rationale

- Keep loopback server, host/origin checks and current forbidden foreign-site mutations.
- Do not require accounts, cloud upload, remote analytics, third-party runtime assets or remote fonts.
- Validate local paths and treat song metadata as untrusted display text.
- Only expose safe native folder selection with narrow capability bridge.
- Redact private paths and metadata from diagnostics by default.

## Compatibility and product invariants

- Original audio files remain local and untouched by cache operations.

## Implementation sequence

- Audit network requests, server route fallback, service worker and every new filesystem endpoint.

## Required tests and edge cases

- Cross-origin POST rejection, Host validation, path traversal, script-bearing metadata, optional diagnostics and offline limitations.

## Alternatives and trade-offs

Retaining the old UI permanently would avoid immediate migration risk but preserve the documented usability problems. A single simultaneous rewrite would be faster to describe but harder to verify and roll back. Implement this ADR incrementally, preserve the backend/audio contracts, and reject any proposal that cannot meet the stated invariants.

## Acceptance and status update

Implementation may move to **In progress** only when a linked implementation PR exists; to **Implemented** only when the intended behaviour and associated tests are merged; and to **Verified** only with relevant automated, browser, accessibility, audio and migration evidence recorded. The [feature-parity matrix](feature-parity.md) and [test plan](test-coverage-matrix.md) must be updated alongside it.

| Date | Decision status | Implementation status | Evidence |
|---|---|---|---|
| 2026-11-06 | Proposed | Not started | Documentation-only plan |
| 2026-11-06 | Proposed | Implemented | [#22](https://github.com/tochi-mba/selecta/pull/22), with evidence in [implementation-evidence.md](implementation-evidence.md) |

## References

- [ADR index](README.md)
- [Implementation roadmap](implementation-roadmap.md)
- [Existing acceptance ledger](../acceptance.md)
- [Existing UI/UX research](../research/ui-ux.md)
