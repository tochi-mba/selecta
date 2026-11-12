# ADR-0148 - Song requests, live queue uncertainty and bridge-route consent

- **Decision:** Accepted by the repository owner on 2026-11-07; implementation and independent verification remain separately evidenced.
- **Implementation:** 7/8 Implemented, 1/8 In progress, 0 Not started (source-level, PR #31).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta immersive experience and microinteractions; 2026-11-07; main `525a49cee6b0a02cae7e71dbe3f336a0141ec2d7` (after merged PR #30).
- **Priority / phase:** P0 / Requests.
- **Related earlier ADRs:** ADR-0124, ADR-0103, ADR-0131; earlier decisions and historical implementation claims remain intact.
- **Source touchpoints:** web/src/views/Requests.tsx; web/src/views/Now.tsx; web/src/views/EditorRows.tsx.

## Context and evidence boundary

A requested song may wait for analysis, find a direct fit, need bridge approval or never fit safely. Motion and reassuring copy must not promise a time or placement that the route planner has not confirmed. This is a **new experience delta** to existing code and ADR-0114–0134, not a claim that existing implementations are missing. PR #31 includes source-level implementation and tests, but this proposal remains owner-unaccepted and independently unverified. Human visual, audio, screen-reader, touch and comprehension results are not asserted.

## Proposed decision

- Request submission appears immediately in a stable list with pending server acknowledgment; duplicates are guarded.
- Group waiting, preparing, ready and needs-consent states with explicit labels and separate action emphasis.
- Show a proposed bridge as an understandable route with every extra song; never automatically insert those tracks before approval.
- A bridge joins as one atomic group only when required transitions are ready, with cancellation remaining available beforehand.
- Expose 'play it anyway' as a deliberate override with an honest rough-transition consequence.
- When a requested route becomes stale, do not animate its old destination into the timeline; recheck or ask for a new choice.

## Interaction choreography and visual behavior

- New pending request enters with ≤180 ms opacity/space reveal after immediate optimistic insertion; rollback uses an explicit error, not vanishing silently.
- Route steps draw only when an actual candidate exists; no fabricated moving path or percentage of musical fit.
- Approval button acknowledges press immediately, then shows preparing without visual implication of joining; joining animates only after atomic commit.
- Queued route preview is static; reduced motion replaces route drawing with numbered song order and status text.

## Alternatives, trade-offs and limits

Prefer semantic, truthful feedback over cosmetic animation; static UI is better than invented musical evidence, gratuitous movement or a delayed critical control. Where visual polish conflicts with accurate playback, scope/revision identity, accessibility or control, behavior and safety win. Do not add runtime dependencies, processing APIs, telemetry or new audio assets under this documentation decision.

## Implementation tasks - 3 source-level Implemented, 0 independently Verified

1. **MI-0148-01 - Create lifecycle microstate board.** Acceptance: Adding/searching/waiting/approve/preparing/ready/stuck/in-mix distinct. Required verification: Request status unit and UI fixture review. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: request lifecycle, bridge consent, stable cancellation and explicit rough override mapped in the surface contract to Requests and API fixtures.**
2. **MI-0148-02 - Guard duplicate and stale submission.** Acceptance: One request per intended action, no phantom rows after failure. Required verification: Rapid press and network race tests. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `web/src/views/Requests.tsx`; `web/src/views/Requests.test.tsx`, `web/src/views/RequestsJoining.test.tsx`; independent checks pending.**
3. **MI-0148-03 - Visualize bridge consent.** Acceptance: Every extra song, order and transition displayed before accept. Required verification: Human consent comprehension test. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: request lifecycle, bridge consent, stable cancellation and explicit rough override mapped in the surface contract to Requests and API fixtures.**
4. **MI-0148-04 - Keep atomic joins truthful.** Acceptance: No partial bridge displayed as active mix until full commit. Required verification: API race and render failure test. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `web/src/views/Requests.tsx`; `web/src/views/Requests.test.tsx`, `web/src/views/RequestsJoining.test.tsx`; independent checks pending.**
5. **MI-0148-05 - Specify request cancellation.** Acceptance: Cancel removes only exact request and restores focus reliably. Required verification: Keyboard, touch and scope tests. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: request lifecycle, bridge consent, stable cancellation and explicit rough override mapped in the surface contract to Requests and API fixtures.**
6. **MI-0148-06 - Handle rough override clearly.** Acceptance: Play anyway warns without shame and preserves user's authority. Required verification: No-cues and no-fit fixtures. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: request lifecycle, bridge consent, stable cancellation and explicit rough override mapped in the surface contract to Requests and API fixtures.**
7. **MI-0148-07 - Define placement anticipation.** Acceptance: No invented countdown or fixed FIFO promise; explain recheck conditions. Required verification: Multiple competing request simulation. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `web/src/views/Requests.tsx`; `web/src/views/Requests.test.tsx`, `web/src/views/RequestsJoining.test.tsx`; independent checks pending.**
8. **MI-0148-08 - Measure perceived fairness.** Acceptance: Users can explain wait/approve and predict next result in multiple requests. Required verification: Observed party-like local session and interview. **Implementation: In progress; Verified: No; owner: Unassigned; PR/SHA: feat/finish-checklists-2 @ \779bd3c\ (WIP, 2026-11-12); evidence: code part built on 2026-11-12: a multi-request sheet recording whether each requester explained waiting and approval and predicted the next result, plus the interview, in `src/selecta/audit/mi_study_kit.py` (`python -m selecta.audit.mi_study_kit sheet|check|summary MI-0148-08`) and the study kit section of `docs/adr/selecta-microinteraction-verification-protocols.md`; `tests/test_mi_study_kit.py` 33/33 passed on 2026-11-12. Left In progress and unticked: the acceptance is the people's result, which code cannot produce, and ticking would drop the task from the owner runbook. Needs a person: observe a party-like local session with several requesters and interview them on waiting, approval and what comes next, recorded in a kit record that passes `check`.**

## Shared invariants and negative cases

Preserve original audio files; current/draft and revision identities; one audio-focus owner; manual Pause authority; explicit bridge consent and atomic join; full eight-lane Studio; existing library/route/search operations; blind-study neutrality; decodable exact-revision FLAC; local-only server and truthful LRCLIB metadata disclosure. **No desktop packager, native/browser folder-picker bridge, accounts, SaaS, cloud media upload, subscriptions, remote telemetry or sound effects.**

Review idle, hovered, focused, pressed, selected, queued, rendering, ready, blocked, failed, retry, cancellation, stale response, missing metadata, long/RTL names, low-resource mode and offline recovery. Run dark/light/system, forced colors, 320–2560px, 200/400% zoom, coarse touch, keyboard, NVDA/Edge, reduced-motion and audio-continuity checks as applicable. Automated screenshots/test passes are not human validation.

## Status, dependencies and records

PR #31 records code implementation with referenced source and automation. **Implemented is not independently Verified**; a named reviewer must still record all required real-world theme, accessibility, audio, performance and user results before Yes or owner Acceptance. [Immersive programme roadmap](selecta-microinteraction-roadmap.md) · [240-task checklist](selecta-microinteraction-implementation-checklist.md) · [evidence ledger](selecta-microinteraction-evidence.md) · [state and motion matrix](selecta-microinteraction-motion-matrix.md) · [release gates](selecta-microinteraction-release-gates.md).
