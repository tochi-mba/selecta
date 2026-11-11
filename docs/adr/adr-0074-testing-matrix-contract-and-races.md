# ADR-0074: Full test architecture, invariants and concurrent edge-case matrix

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** In progress: 4 of 10 tasks implemented with automated evidence on 2026-11-11; 2 need a person; 4 still open
- **Documentation status:** Drafted in the Selecta 3.0 documentation-only proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.0 complete experience overhaul
- **Phase:** 7 - Verification
- **Extends existing decisions:** ADR-0029, ADR-0046
- **Dependencies:** [programme roadmap](selecta-3-roadmap.md) and verified baseline; see phase order.
- **Work item statuses:** Recorded on each item below (2026-11-11). Implemented means its automated evidence ran green; nothing here is independently Verified.

## Context and rationale

The current repo contains frontend unit tests, Python contracts and Playwright page/listen/flow/integration suites. A complete UI redesign will invalidate selectors and screenshots while preserving domain behavior. Deleting tests to make a new layout pass is unacceptable.

## Decision proposed

Preserve the entire existing behavioral suite and add state-machine, contract, accessible component, visual, real-browser audio and failure-concurrency coverage. Selector changes may be updated; outcome assertions cannot be weakened or silently removed.

## Experience and frontend architecture

- Maintain a feature-parity matrix that maps every old behavior to owning ADR, implementing PR and test case. Use stable accessible roles and names instead of brittle CSS selectors. E2E fixtures use generated/licensed audio, sanitized metadata and deterministic clocks.

- Separate unit/state tests, component interaction tests, frontend/server contract tests, full Playwright user journeys, screenshots, accessibility automation/manual AT and actual audible tests. Mock success never substitutes for audio or server verification.

- Release blockers include wrong mix/draft mutation, unrecoverable data loss, unexpected sound/silence, unsafe file access, partial bridge insertion, invalid FLAC, inaccessible essential controls and fabricated readiness.

## Detailed implementation work

1. **S3-0074-01 - Implemented.** Snapshot all existing unit/Python/E2E tests and map to ADR/feature parity before changes. **Evidence:** docs/adr/test-coverage-matrix.md and docs/adr/test-parity-inventory.json held by tests/test_parity_inventory.py; the older T and P tasks mapped to S3 decisions by tests/test_s3_parity_task_map.py (passed 2026-11-11).
2. **S3-0074-02 - Implemented.** Build reusable fixtures for empty, 6-ready, 20k songs, duplicate/RTL metadata, missing audio and invalid durations. **Evidence:** tests/e2e_server.py (empty, six-ready and full made-up libraries; SELECTA_E2E_STRESS=1 adds long, duplicate and right-to-left names; set-aside and broken files); 20k: tests/test_s3_library_profile.py; missing audio and invalid durations: tests/test_library_edges.py (passed 2026-11-11).
3. **S3-0074-03 - Implemented.** Add domain tests for optimistic reconciliation, statuses, revision guards and safe Undo. **Evidence:** web/src/state/workState.test.ts 'page reads keep loading, refreshing, stale and failed apart'; web/src/state/async.test.tsx 'ignores an old response that completes after a newer request'; tests/test_api_contracts.py test_guarded_replay_returns_original_response_after_its_own_mix_change; web/src/ui/controls.test.tsx Undo tests (passed 2026-11-11).
4. **S3-0074-04 - Not started.** Add component keyboard/focus tests for dialogs, menus, playlist reorder, Studio grid and palette.
5. **S3-0074-05 - Not started.** Add E2E end-to-end tasks from folder scan through playback, editing, requests, stems and export.
6. **S3-0074-06 - Implemented.** Add audio fixtures for preview ownership, gapless seams, late/fallback render and Media Session. **Evidence:** preview ownership: web/src/audio/focusEdges.test.tsx; gapless seams and fallback: web/src/audio/transportEdges.test.ts 'a ready seam overlaps outgoing song, clip and incoming song with no gap' and 'a fallback fade brings the next song in before this one ends'; Media Session: web/src/audio/mediaSession.test.ts (passed 2026-11-11).
7. **S3-0074-07 - Not started.** Add concurrency tests for simultaneous requests, stale edits, network loss, export snapshots and rescan overrides.
8. **S3-0074-08 - Not started.** Add visual/state accessibility regression gates and human verification scripts.
9. **S3-0074-09 - Needs a person.** Report test changes by assertion intent and investigate flakiness rather than raising timeouts blindly. **Status:** Needs a person: reporting test changes by assertion intent and investigating flakiness is a reviewer's practice on each PR; nothing here can show it was done
10. **S3-0074-10 - Needs a person.** Require passing full CI and separate human review before describing an entire ADR as Verified. **Status:** Needs a person: full CI on the integrated head plus a separate human review before any ADR is called Verified

## Preservation and integration constraints

This work must preserve all applicable capabilities in [the existing feature-parity ledger](feature-parity.md): original source music and library data; drafts, user corrections, ratings and preferences; correct current-versus-draft mutation isolation; original routes; honest playable/render readiness; a single audio owner with no unintended stop or overlap; explicit request bridge consent and atomic insertion; accurate revision-bound FLAC; and secure localhost/origin privacy. New dependencies, API fields or native integration require separately reviewed contracts; the design does not itself authorize backend replacement.

## Required tests and edge-case verification (not yet executed)

- Old test assertion semantics retained even when labels and markup change.
- At least one failure injected into every write/retry path; duplicate submit and stale response.
- Run actual locally synthesized Web Audio in supported real browsers; no simulated scheduler claims.

General test dimensions: dark and light; initial/populated/empty/partial/refreshing/busy/failed/offline/recovery; 320px–4K; zoom, pointer and keyboard; realistic long/missing/duplicate/RTL metadata; accessibility checks; stale response and race tests; representative local-audio playback where relevant. Existing tests may be adapted to accessible semantics but not deleted or weakened.

## Alternatives, risks and trade-offs

Rely exclusively on screenshots or automated axe: cannot prove backend/transport correctness. Preserve layered tests with real outcomes.

## Acceptance and evidence

Every feature-parity row has passing relevant automated checks and required manual evidence, with no known unresolved release-blocker.

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
