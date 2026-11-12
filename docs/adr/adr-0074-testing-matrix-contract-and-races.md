# ADR-0074: Full test architecture, invariants and concurrent edge-case matrix

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** In progress: 6 of 10 tasks implemented with automated evidence on 2026-11-11; 3 need a person; 1 still open (1 built with a browser check pending)
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
4. **S3-0074-04 - Implemented.** Add component keyboard/focus tests for dialogs, menus, playlist reorder, Studio grid and palette. **Implementation:** Implemented; **Independently Verified:** No; **Evidence:** dialogs and menus: web/src/ui/controls.test.tsx 'take focus, keep it inside, and give it back' and 'opens, moves with the arrow keys, and closes with Escape, back on its button'; playlist reorder: web/src/views/ufEditorReorder.test.tsx 'moves a song up with the keyboard handle, keeps focus on it, and offers Undo'; Studio grid: web/src/views/Studio.test.tsx 'is one tab stop, moves with the arrow keys, and Space turns a square on or off'; palette: web/src/ui/sfPaletteFocus.test.tsx 'opening focuses the search field, and Escape gives focus back to the opener' and web/src/ui/CommandPalette.test.tsx (8 Vitest files, 97 tests, passed 2026-11-11).
5. **S3-0074-05 - Needs a person.** Add E2E end-to-end tasks from folder scan through playback, editing, requests, stems and export. **Status:** Implemented; browser check passed ('folder to FLAC: scan, play, edit, request, stems and export join up (S3-0074-05)' passed (CI run 43119473767, Edge E2E (shard 2/2) job 130857753267, head f851f2b, recorded 2026-11-12)) (web/e2e/s3-0074-journey.e2e.ts 'folder to FLAC: scan, play, edit, request, stems and export join up (S3-0074-05)', written 2026-11-11). The separate steps already exist in web/e2e/flows.e2e.ts and web/e2e/mp-0282-onboarding.e2e.ts. Needs a person: real audible playback, since mocked or muted audio does not count.
6. **S3-0074-06 - Implemented.** Add audio fixtures for preview ownership, gapless seams, late/fallback render and Media Session. **Evidence:** preview ownership: web/src/audio/focusEdges.test.tsx; gapless seams and fallback: web/src/audio/transportEdges.test.ts 'a ready seam overlaps outgoing song, clip and incoming song with no gap' and 'a fallback fade brings the next song in before this one ends'; Media Session: web/src/audio/mediaSession.test.ts (passed 2026-11-11).
7. **S3-0074-07 - Implemented.** Add concurrency tests for simultaneous requests, stale edits, network loss, export snapshots and rescan overrides. **Implementation:** Implemented; **Independently Verified:** No; **Evidence:** simultaneous requests: tests/test_requests_together.py test_two_requests_never_go_in_the_same_spot and tests/test_request_routes.py test_two_requests_can_not_choose_the_same_bridge; stale edits: tests/test_api_contracts.py test_a_change_to_a_mix_that_has_moved_on_stops and test_guarded_replay_returns_original_response_after_its_own_mix_change; export snapshots: tests/test_selecta3_changes.py test_export_job_keeps_its_original_revision_after_the_mix_changes; rescan overrides: tests/test_scan.py test_a_person_can_overrule_the_filter_and_it_survives_a_rescan and tests/test_s2_correction_races.py (8 passed, 2026-11-11); network loss: web/src/apiFaults.test.ts and web/src/gp-0263-offline.test.tsx (passed 2026-11-11).
8. **S3-0074-08 - Needs a person.** Add visual/state accessibility regression gates and human verification scripts. **Status:** The automated gates are built: web/e2e/pages.e2e.ts axe in both themes, web/e2e/s3-0077-theme-choice.e2e.ts contrast with an explicit theme (passed 2026-11-10), and the pixel-diff gate web/e2e/s3-0075-visual-regression.e2e.ts (browser check pending); human scripts are in docs/adr/selecta-3-accessibility.md 'Scripts for a person'. Needs a person: run those scripts and review the baseline pictures.
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
