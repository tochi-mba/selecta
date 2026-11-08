# ADR-0048: Intent-based information architecture, routes and discoverability

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** Not started
- **Documentation status:** Drafted in the Selecta 3.0 documentation-only proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.0 complete experience overhaul
- **Phase:** 1 — Architecture
- **Extends existing decisions:** ADR-0002, ADR-0010, ADR-0012, ADR-0019, ADR-0020
- **Dependencies:** [programme roadmap](selecta-3-roadmap.md) and verified baseline; see phase order.
- **Work item statuses:** Every S3-0048-XX item below is **Not started**. No runtime feature, test or UI change is claimed by this ADR.

## Context and rationale

Listen, Mixes, Library, Discover and Workshop are functional but do not cleanly distinguish discovery, personal projects and maintenance. The current router has stable public addresses, which cannot be casually broken.

## Decision proposed

Adopt five primary destinations: Listen, Explore, My Mixes, Library and Workspace. Make Edit a contextual workspace. Explore groups preset Mixes, Word Connections and Harmonic Matches; My Mixes groups the current set, drafts and render line; Workspace groups operations and diagnostics. Existing URLs remain supported.

## Experience and frontend architecture

- A typed route manifest owns canonical paths, titles, labels, breadcrumbs and legacy aliases. Navigation actions change route presentation only; the main audio service is not remounted on every route.

- Avoid hidden-only subviews. The user must be able to see where current work lives. Preserve browser history, direct navigation, filters in query parameters, scroll restoration and installed-PWA navigation.

- Use stable links to existing /listen, /mixes, /mixes/mine, /library, /discover, /discover/harmonic, /workshop/*, /listening, /mix/current/edit and /mixes/drafts/:id/edit paths. New aliases may be added but may not silently reinterpret existing paths.

## Detailed implementation work (all Not started)

1. **S3-0048-01 — Not started.** Produce a route and destination map, including hidden developer panels and studies; identify canonical and legacy paths.
2. **S3-0048-02 — Not started.** Build and usability-test alternative navigation labels and task-findability for new listeners, returning listeners and power users.
3. **S3-0048-03 — Not started.** Define responsive primary/secondary navigation with current-location, descendant-selection and context semantics.
4. **S3-0048-04 — Not started.** Specify legacy route aliases, URL parameter mapping, unknown-route recovery and scroll restoration policies.
5. **S3-0048-05 — Not started.** Define draft/current editor context banners and route semantics that prevent edits to the wrong resource.
6. **S3-0048-06 — Not started.** Provide visible entry points to Requests, Export, listening studies, diagnostics and advanced discoveries without burying existing functionality.
7. **S3-0048-07 — Not started.** Create a page title and breadcrumb system that preserves Media Session, playback status and assistive-tech route announcements.
8. **S3-0048-08 — Not started.** Document migration from the old navigation with no data migration required and a reversible route-flag strategy.

## Preservation and integration constraints

This work must preserve all applicable capabilities in [the existing feature-parity ledger](feature-parity.md): original source music and library data; drafts, user corrections, ratings and preferences; correct current-versus-draft mutation isolation; original routes; honest playable/render readiness; a single audio owner with no unintended stop or overlap; explicit request bridge consent and atomic insertion; accurate revision-bound FLAC; and secure localhost/origin privacy. New dependencies, API fields or native integration require separately reviewed contracts; the design does not itself authorize backend replacement.

## Required tests and edge-case verification (not yet executed)

- Deep link, reload, Back/Forward, query preservation, invalid draft ID, missing route, PWA direct launch and browser navigation.
- During active playback, switch across all destinations including Stage, Edit and Studio; assert no transport reinitialization.
- Keyboard and screen-reader tests for nav landmarks, current-page semantics, focus destination and collapsed rail.

General test dimensions: dark and light; initial/populated/empty/partial/refreshing/busy/failed/offline/recovery; 320px–4K; zoom, pointer and keyboard; realistic long/missing/duplicate/RTL metadata; accessibility checks; stale response and race tests; representative local-audio playback where relevant. Existing tests may be adapted to accessible semantics but not deleted or weakened.

## Alternatives, risks and trade-offs

Keep the current five labels: lower migration cost but leaves project ownership unclear. Add all sections as permanent tabs: better direct reachability but increases mobile density. The intent-led grouping provides a better starting model pending user research.

## Acceptance and evidence

Every preserved feature is reachable without guessing; all legacy addresses resolve correctly; users can distinguish discovery, personal mixes and operational settings.

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
