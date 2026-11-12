# ADR-0103: Requests drawer, bridge alternatives, explicit consent and atomic joining

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** Implemented (10/10 implemented, 0 in progress; source reconciliation 2026-11-10, branch feat/finish-checklists)
- **Verification status:** Not verified (0/10)
- **Documentation status:** Drafted, documentation-only Selecta 4.0 proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 4.0 complete UI/UX overhaul
- **Phase:** 7 Discovery
- **Extends, does not automatically supersede:** ADR-0015, ADR-0060, ADR-0085
- **Source surfaces to reconcile:** `web/src/views/Requests.tsx`; `web/src/views/RequestsJoining.test.tsx`; `src/selecta/routes/song_requests.py`
- **Tasks:** S4-0103-01 through S4-0103-10 in [the Selecta 4.0 checklist](selecta-4-implementation-checklist.md)
- **Baseline:** `main` `9b663f9f10212619f27ce67ce82f602347065cbd` (after merged PRs #25 and #26)

## Context and evidence boundary

A request being received, searched, approved, prepared and inserted are different states; the system may choose extra bridge songs and must not insert unapproved extras or partial routes.

This is a **proposal**. Source inspection and earlier planning documents establish current contracts and candidate risks; they do not establish verified visual quality, human task success, real audio quality, screen-reader usability or shipped implementation of this ADR. Earlier programme status headings can be stale and are not inherited as verified work.

## Proposed decision

Use four understandable visible groups-Waiting, Needs your choice, Preparing, Coming up-while retaining all detailed backend states. Present proposed multi-song bridges as entire routes with explicit consent and atomic insertion.

## Experience, frontend and interaction specification

- Top of drawer centers song search; action-required requests appear before passive work.
- No fabricated ETA or guarantee of strict FIFO if planner cannot assure it.
- Bridge proposal shows requested destination, all extra songs, why route is needed, preview state and Accept/Decline.
- Play it anyway remains available with understandable rough-transition warning and exact semantics.

## Detailed implementation work

1. **S4-0103-01 - Rebuild request search and matching results with song identity.** Acceptance: No wrong duplicate-title selection or inaccessible result. Required verification: Rapid search, Unicode, duplicate ID and keyboard tests. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: Claude with NVDA 2026.3.1 (owner-delegated 2026-11-12).** Evidence: web/src/views/Requests.test.tsx 'searches and adds, keeping the results open for more', 'two picks close together both stay', 'won't let a song be asked for twice', 'Enter takes the first song it can'; tests/test_requests_together.py 'a_different_artist_singing_the_same_title_is_a_different_song'. **Verified:** Claude with NVDA 2026.3.1 (owner-delegated 2026-11-12): in the Requests dialog the search said 'Request a song combo box collapsed has auto complete editable'; typing 'Same' said 'expanded, Matching songs list', and Down arrow read 'Same Name - Hal Greene (song 10) - Request 1 of 3', 'Same Name - Hal Greene (song 17) - Request 2 of 3', so duplicate titles are told apart by artist and song number from the keyboard (NVDA 2026.3.1 with headed Edge 157 on Windows 11 at 1280x860, made-up library with SELECTA_E2E_STRESS=1, commit 9af0eb13 plus working tree, speech log docs/verification/claude-checks/selecta-4-implementation-checklist/nvda/nvda-2026.3.1-session-1.txt).
2. **S4-0103-02 - Map all backend request states to truthful user-facing groups.** Acceptance: Waiting/approval/preparing/ready are not conflated. Required verification: State transition matrix including stalled/offline. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: Requests.tsx stage groups; Requests.test.tsx 'says where it will go and how long it will take', 'says when it has to be analysed first', 'is plain about a song it can't place'; tests/test_request_routes.py 'a_transition_says_what_kind_it_is_and_how_far_along'. Needs a person: review of the state matrix including stalled and offline.
3. **S4-0103-03 - Prioritize decisions needing human action within drawer.** Acceptance: Pending approvals cannot be buried in long list. Required verification: 50+ requests scrolling and focus tests. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: Claude (owner-delegated 2026-11-12).** Evidence: Requests.tsx GROUP_ORDER puts what needs you first; Requests.test.tsx 'names the extra song and asks'. **Verified:** Claude (owner-delegated 2026-11-12): Edge 157 headless via Playwright 1.65, made-up library (tests/e2e_server.py, SELECTA_E2E_STRESS=1), commit 9af0eb13 plus working tree, 2026-11-12: 55 requests with approvals at 31 and 55 at 1440 and 375 px: the drawer puts 'Needs your choice' before 'Waiting', the first approval's actions are two Tab presses from the search, Tab never left the dialog or landed on a hidden control over 40 presses, and Escape returned focus to the search; captures docs/verification/claude-checks/selecta-4-implementation-checklist/S4-0103-03/ (the fixture's second approval reused a song already requested, so only one approval row showed).
4. **S4-0103-04 - Design entire bridge path and extra-song consent.** Acceptance: Every inserted extra track is explicitly approved. Required verification: Proposed/declined/approved route E2E. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: Claude (owner-delegated 2026-11-12).** Evidence: tests/test_request_routes.py 'a_bridge_nobody_agreed_to_can_not_join', 'agreeing_to_one_bridge_does_not_agree_to_another'; Requests.test.tsx 'saying no stops asking and says what happens now'. **Verified:** Claude (owner-delegated 2026-11-12), a delegated review, not the owner's sign-off: read the consent checks in test_request_routes.py: an unapproved bridge cannot join and one approval does not cover another route; every test this line cites passed by name, reran 2026-11-12 at 9af0eb13 plus the uncommitted working tree: vitest (one worker) 22 files 348 passed and 5 files 77 passed, pytest 21 files 506 passed and 1 skipped (no symlink rights).
5. **S4-0103-05 - Preserve alternate bridge finder and preview.** Acceptance: Selection controls don't imply a path is already inserted. Required verification: Unavailable preview, missing bridge and selection race tests. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: Claude (owner-delegated 2026-11-12).** Evidence: web/src/views/RequestsJoining.test.tsx 'changes nothing until one is chosen', 'can be heard first, only rendering the one that's asked for'; test_request_routes.py 'finding_a_bridge_renders_nothing_and_changes_nothing', 'hearing_something_it_never_found_is_refused'. **Verified:** Claude (owner-delegated 2026-11-12), a delegated review, not the owner's sign-off: read RequestsJoining.test.tsx and test_request_routes.py: finding a bridge renders and changes nothing, an unfound bridge is refused; every test this line cites passed by name, reran 2026-11-12 at 9af0eb13 plus the uncommitted working tree: vitest (one worker) 22 files 348 passed and 5 files 77 passed, pytest 21 files 506 passed and 1 skipped (no symlink rights).
6. **S4-0103-06 - Preserve Play it anyway as deliberate override.** Acceptance: Warning clear and backend override behaves as before. Required verification: Rough transition and failure tests. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: Requests.tsx Play it anyway override; Requests.test.tsx 'is offered when nothing fits, and goes straight in'. Needs a person: rough-transition listening check.
7. **S4-0103-07 - Represent uncommitted requests as provisional editor rows.** Acceptance: Ghost rows never claim they already play or render. Required verification: Timeline request join/reorder tests. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: Claude (owner-delegated 2026-11-12).** Evidence: RequestsJoining.test.tsx 'shows where it's going, faded, and says it isn't ready', 'can't be played, because it isn't in the mix yet'. **Verified:** Claude (owner-delegated 2026-11-12), a delegated review, not the owner's sign-off: read RequestsJoining.test.tsx: the provisional row is faded, says it is not ready and offers no Play; every test this line cites passed by name, reran 2026-11-12 at 9af0eb13 plus the uncommitted working tree: vitest (one worker) 22 files 348 passed and 5 files 77 passed, pytest 21 files 506 passed and 1 skipped (no symlink rights).
8. **S4-0103-08 - Guarantee atomic insertion and operation idempotency.** Acceptance: Whole approved route inserts once or not at all. Required verification: Partial render fail/retry/two-tab duplicate tests. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: tests/test_requests.py 'ready_insertion_is_atomic_and_rejects_stale_or_unapproved_plans'; test_request_routes.py 'when_it_does_they_all_come_in_at_once_as_one_step'; web/e2e/integration.e2e.ts 'two requests at once'. Needs a person: two-tab duplicate check on a real server.
9. **S4-0103-09 - Harden cancel/approval and late polling reconciliation.** Acceptance: Cancelled request cannot reappear due to older result. Required verification: Cancellation vs join and out-of-order poll tests. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: Claude (owner-delegated 2026-11-12).** Evidence: Requests.test.tsx 'a slow poll can't bring back something just cancelled', 'a cancel that fails puts the request back'; integration.e2e.ts 'a cancelled request that's answered late doesn't come back'. **Verified:** Claude (owner-delegated 2026-11-12), a delegated review, not the owner's sign-off: read Requests.test.tsx (a held poll answered after Cancel does not bring the request back; a failed cancel restores it) and integration.e2e.ts 'a cancelled request that's answered late doesn't come back'; every test this line cites passed by name, reran 2026-11-12 at 9af0eb13 plus the uncommitted working tree: vitest (one worker) 22 files 348 passed and 5 files 77 passed, pytest 21 files 506 passed and 1 skipped (no symlink rights), and the cited Edge specs (Edge 157, dist-vb build, e2e_server) 25 passed.
10. **S4-0103-10 - Explain request dependencies and no-mix waiting.** Acceptance: Request order never falsely promised when music routing varies. Required verification: Multi-request/dependency/empty-mix scenarios. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: Claude (owner-delegated 2026-11-12).** Evidence: RequestsJoining.test.tsx 'names the request it's waiting behind', 'does not promise joining before the next valid opening'; Requests.test.tsx 'only looks for a spot while the mix is playing'. **Verified:** Claude (owner-delegated 2026-11-12), a delegated review, not the owner's sign-off: content review of the waiting copy in Requests.tsx ('Requested · waiting': requested, not scheduled, no known play time or queue position) and RequestsJoining.test.tsx: no order or time is promised; every test this line cites passed by name, reran 2026-11-12 at 9af0eb13 plus the uncommitted working tree: vitest (one worker) 22 files 348 passed and 5 files 77 passed, pytest 21 files 506 passed and 1 skipped (no symlink rights).

## Required negative cases and regression strategy

- One of several bridge transitions fails; insert none of the route.
- User cancels while backend joined; UI distinguishes already-inserted state.
- Server accepts approval but response times out; retry must be idempotent.
- Exercise light, dark and system themes; empty, loading, partial, ready, stale, failed, offline and recovering states where applicable.
- Exercise 320/375/390/430/768/1024/1280/1440/1920 CSS-pixel widths, short viewports, 200/400% zoom, keyboard, touch, reduced motion, realistic long/missing/duplicate/Unicode/RTL metadata.
- Maintain existing frontend, API, audio and Python assertions; changed markup may require selector updates but never weakened behavioural contracts.

## Preservation and dependencies

Retain the [existing Selecta 3.0 invariants INV-01–INV-20](selecta-3-roadmap.md) and [3.1 preservation contract](selecta-3-1-roadmap.md): no original-file mutation; local-first security and LRCLIB disclosure; no loss of current/draft state, preferences, corrections or ratings; stable old routes; one audio owner; exact request consent and atomic join; truthful requested-versus-rendered state; revision-pinned decodable FLAC; full keyboard alternatives and regression assertions. No backend, schema, audio-engine or dependency rewrite is authorized by this ADR. See [4.0 parity matrix](selecta-4-feature-parity.md) and [verification matrix](selecta-4-verification-matrix.md).

## Alternatives, risks and trade-offs

Simpler visible status categories require preserving detailed drill-down so advanced users can diagnose a stuck request.

## Evidence and advancement rules

An owner must separately **Accept** this decision before it becomes policy. Each implementing PR must name the S4-0103 task IDs, actual commit(s), changed files, pre-existing regression tests, new negative/concurrency cases, theme/viewport screenshots and relevant human/audible/AT evidence. **Implemented** requires merged code and applicable automated checks; **Verified** additionally requires independent real acceptance relevant to the change. An unchecked checkbox means not Verified. A docs merge does not advance these statuses.

## Status history

| Date | Decision | Implementation | Verification | Evidence |
|---|---|---|---|---|
| 2026-11-07 | Proposed | Not started | Not verified | Documentation-only specification; no runtime, test or UI changes |
| 2026-11-08 | Accepted | Not started | Not verified | Owner accepted all proposed ADRs ([#37](https://github.com/tochi-mba/selecta/pull/37)) |
| 2026-11-10 | Accepted | Implemented (10/10) | Not verified | Source reconciliation against current code with focused tests run 2026-11-10; every task still needs independent verification |

## Related documents

- [Selecta 4.0 roadmap and ADR index](selecta-4-roadmap.md)
- [4.0 implementation checklist](selecta-4-implementation-checklist.md)
- [4.0 per-task evidence ledger](selecta-4-evidence.md)
- [4.0 verification and edge-case matrix](selecta-4-verification-matrix.md)
- [4.0 release readiness criteria](selecta-4-release-gates.md)
- [Earlier 3.1 implementation checklist](selecta-3-1-implementation-checklist.md)
