# ADR-0218 - Wordplay and harmonic Connection Gallery grounded in actual evidence

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** In progress (5/8 Implemented, 0/8 In progress, 3/8 Not started or needing a person; updated 2026-11-10).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta / Flow artistic UI/UX; 2026-11-08; main `c3715b14a70a0a9005e9fbc08d44576f3eac3c15`.
- **Priority / phase:** P1 / Explore.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0155/0176/0125; no earlier status changed.
- **Existing source touchpoints:** web/src/views/Links.tsx; web/src/views/Workshop.tsx.

## Context and evidence boundary

Make validated song-pair connections discoverable as an editorial gallery or optional map while preserving staged listening and source provenance. Earlier ADRs and code may already implement significant functionality, but no new task is marked complete without exact acceptance and evidence. This is a proposed artistic delta, not source implementation, visual sign-off or real-audio approval.

## Proposed decision

Make validated song-pair connections discoverable as an editorial gallery or optional map while preserving staged listening and source provenance. Retain all current usable controls with intentional grouping, exact stable musical object identities, recoverable errors and local-only data. An expressive layout must never imply a new audio-engine capability.

## Visual, animation and microinteraction contract

- One first-glance object and action plus discoverable expert options, accurate editable versus committed scope and visible pending outcomes.
- Illustrative graphics and confirmed data remain distinguishable in every visual mode and accessibility description.
- Motion only follows user gestures or real audio/status events, with full reduced-motion, touch, keyboard and screen-reader parity.
- Audio playback, paused state and authoritative mix revisions cannot change as a side effect of inspecting or navigating.

## Alternatives, trade-offs and limits

No invented lyric connection, false harmonic certainty, unavailable clip or pseudo-recommendation. Reject ungrounded decoration, forced transitions and high-fidelity effects that starve the player. This ADR does not authorize SaaS, remote upload, telemetry or new backend logic without its own decision and tests.

## Implementation checklist - 5/8 Implemented, 0/8 Verified

1. **SF-0218-01 - Map genuine discovery fields.** **Acceptance:** All link types map to actual API output. **Required verification:** Schema fixtures. **Implementation:** Implemented; **Verified:** No; **Owner:** Claude agent flb; **PR/SHA:** feat/finish-checklists (uncommitted; coordinator commits); **Evidence:** `web/src/views/Links.test.tsx` 'show only what's asked for', 'each have their own address', 'can't load isn't the same as nothing there'; `tests/test_discovery_search.py` (13 tests incl. test_lyric_links_ignore_legacy_synced_rows_without_text) (2026-11-10).
2. **SF-0218-02 - Design evidence-based cards.** **Acceptance:** Pair, technique, limitations and status legible. **Required verification:** Expert review. **Implementation:** Needs a person: expert review of evidence cards; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
3. **SF-0218-03 - Build optional relationship view.** **Acceptance:** Only returned edges with stable IDs shown. **Required verification:** Sparse graph tests. **Implementation:** Implemented; **Verified:** No; **Owner:** Claude agent r2k; **PR/SHA:** feat/finish-checklists (uncommitted; coordinator commits); **Evidence:** `web/src/views/RelationshipMap.tsx` (optional, closed by default, above the cards in `web/src/views/Links.tsx`; flag `discover.relationship_map`); `web/src/views/sfFlowConnections.test.tsx` (5 passed: dots only for touched songs and lines only per returned pair, playing order kept, same titles told apart by ID, closed by default and exact edges once opened, too sparse shows nothing); `web/src/views/Links.test.tsx` passed (2026-11-10).
4. **SF-0218-04 - Prioritize real audition.** **Acceptance:** Audio preview available only with media readiness. **Required verification:** Audio focus E2E. **Implementation:** Implemented; **Verified:** No; **Owner:** Claude agent flb; **PR/SHA:** feat/finish-checklists (uncommitted; coordinator commits); **Evidence:** `web/src/views/Links.test.tsx` 'says so when a pair cannot be played, and you can still answer', 'never calls a requested harmonic stage playing until the media element starts', 'pauses the mix when it starts playing' (2026-11-10).
5. **SF-0218-05 - Clarify search stages.** **Acceptance:** Candidate, ready and rated distinct. **Required verification:** Async fixture states. **Implementation:** Implemented; **Verified:** No; **Owner:** Claude agent flb; **PR/SHA:** feat/finish-checklists (uncommitted; coordinator commits); **Evidence:** `web/src/views/Links.test.tsx` 'says how long it will take while it gets ready', 'keeps answers out of the way, and they can be changed', 'says there's nothing yet when there is nothing to show'; `tests/test_discovery_search.py::test_exhaustive_sweep_resumes_remembers_nonmatches_and_invalidates_changes` (2026-11-10).
6. **SF-0218-06 - Retain pair-specific feedback.** **Acceptance:** Ratings attach to correct pair and revision. **Required verification:** Identity regression. **Implementation:** Implemented; **Verified:** No; **Owner:** Claude agent flb; **PR/SHA:** feat/finish-checklists (uncommitted; coordinator commits); **Evidence:** `web/src/views/Links.test.tsx` 'never plays an obsolete prepared audition after the user skips that pair', 'answering moves straight on to the next pair', 'keeps focus on the answer while it saves' (2026-11-10).
7. **SF-0218-07 - Add accessible list alternative.** **Acceptance:** Map facts navigable by keyboard and screen reader. **Required verification:** NVDA review. **Implementation:** Needs a person: NVDA review of the card list as the map's alternative. Automated part: the map (`web/src/views/RelationshipMap.tsx`) is optional and closed by default, and draws only connections the card list also shows (`web/src/views/sfFlowConnections.test.tsx`, passed 2026-11-10); **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
8. **SF-0218-08 - Test discoverability.** **Acceptance:** Listeners find valuable links without false trust. **Required verification:** Uncoached study. **Implementation:** Needs a person: uncoached discoverability study; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.

## Invariants and required negative cases

Preserve single audio owner, intentional Pause, original media and local privacy, accurate LRCLIB metadata disclosure, current/draft revisions and scoped Undo, exact song/seam IDs, consented atomic request bridge, all eight Studio stem lanes and 8–64 cells with local recovery, truthful library readiness, blind listening neutrality and frozen-revision decodable FLAC. Include stale/failed/slow operations, absent media, duplicate songs, keyboard/touch/zoom/RTL, forced-colors/reduced motion and real-audio cases where relevant.

## Dependencies, evidence and status

- **Depends on:** ADR-0155/0176/0125 and new foundation ADR-0198/0199, plus shared visual system.
- **Next:** owner decision → prototype/critique → targeted implementation PR with tests → independent human/AT/real-audio/performance evidence → GO/NO-GO.
- **Now:** Accepted, 4/8 Implemented (2026-11-10), 0/8 independently Verified; no implementation PR/SHA.
- [Roadmap](selecta-flow-roadmap.md) · [Checklist](selecta-flow-implementation-checklist.md) · [Evidence](selecta-flow-implementation-evidence.md) · [Parity](selecta-flow-feature-parity.md) · [Interaction](selecta-flow-interaction-matrix.md) · [Verification](selecta-flow-verification-matrix.md) · [Gates](selecta-flow-release-gates.md).
