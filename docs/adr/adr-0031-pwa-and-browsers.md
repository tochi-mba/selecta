# ADR-0031: Installed PWA, browser features and platform integrations

- **Decision status:** Proposed
- **Implementation status:** Not started
- **Proposed:** 2026-11-06
- **Delivery phase:** 2–13
- **Scope:** Proposed future implementation; no code changes made by this ADR.

> Merging this proposal does not mean the decision is accepted or the implementation has started. Update both statuses with a PR link and verification evidence when work actually occurs.

## Context

Selecta can be installed in Chrome/Edge but the local backend must still run; new routes and media features cannot imply full offline capability.

## Proposed decision and rationale

- Preserve manifest, icons and standalone app identity.
- Feature-detect fullscreen, audio, Media Session and directory-selection behaviour across target browsers.
- Serve nested SPA paths correctly without intercepting API routes or caching private audio.
- Explain local-server dependence honestly.

## Compatibility and product invariants

- Existing install workflow and web access work on their supported platforms.

## Implementation sequence

- Define supported browser matrix and test desktop/installed modes and fallbacks.

## Required tests and edge cases

- Standalone refresh, missing backend, browser autoplay, media keys, fullscreen denial, cache and safe-area layouts.

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
