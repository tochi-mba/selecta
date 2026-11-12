# ADR-0164 - Visual and audible proof, interaction research, rollback and release governance

- **Decision:** Accepted by the repository owner on 2026-11-07; implementation and independent verification remain separately evidenced.
- **Implementation:** 6/8 Implemented, 2/8 In progress, 0 Not started (source-level, PR #31).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta immersive experience and microinteractions; 2026-11-07; main `525a49cee6b0a02cae7e71dbe3f336a0141ec2d7` (after merged PR #30).
- **Priority / phase:** P0 / Verification.
- **Related earlier ADRs:** ADR-0133, ADR-0112, ADR-0113, ADR-0134; earlier decisions and historical implementation claims remain intact.
- **Source touchpoints:** web/e2e/visual.e2e.ts; web/e2e/flows.e2e.ts; docs/adr/selecta-experience-release-gates.md.

## Context and evidence boundary

The repository has synthetic muted E2E tests, visual review candidates and historical status ledgers. This new motion-and-delight proposal must never become a claim of implementation, test approval or human preference merely because its docs merge. This is a **new experience delta** to existing code and ADR-0114–0134, not a claim that existing implementations are missing. PR #31 includes source-level implementation and tests, but this proposal remains owner-unaccepted and independently unverified. Human visual, audio, screen-reader, touch and comprehension results are not asserted.

## Proposed decision

- Maintain distinct ADR decision, implementation and independent verification states for each new MI task, with exact PR/SHA/evidence and owner.
- Use approved screenshot baselines rather than automatically blessing raw Playwright captures; document reviewer and changed viewport.
- Run paired normal/reduced-motion, dark/light/system, accessibility and degraded-performance visual reviews.
- Use real audio capture and blind listening for transition truth; synthetic muted E2E is insufficient evidence of musical excellence.
- Define uncoached listener, creator and expert task protocols with denominators and confidence measures.
- Gate releases on scope/audio/privacy correctness first, then accessible interaction, then delightful visual outcomes; make rollback reversible.

## Interaction choreography and visual behavior

- Acceptance compares recorded videos at full speed and frame-by-frame for causality, focus, occlusion and movement.
- No screenshot, generated animation or HTML-only audit can claim a transition sounded good.
- No motion-related P0 failure accepted even if automation otherwise passes; reduced-motion parity is mandatory.
- Performance traces must state actual machine, branch SHA and limitations; avoid fictional frame-rate passes.

## Alternatives, trade-offs and limits

Prefer semantic, truthful feedback over cosmetic animation; static UI is better than invented musical evidence, gratuitous movement or a delayed critical control. Where visual polish conflicts with accurate playback, scope/revision identity, accessibility or control, behavior and safety win. Do not add runtime dependencies, processing APIs, telemetry or new audio assets under this documentation decision.

## Implementation tasks - 1 source-level Implemented, 0 independently Verified

1. **MI-0164-01 - Publish per-task evidence schema.** Acceptance: MI ID, decision, implement PR, SHA, test, reviewer and result required. Required verification: Ledger schema validation. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `docs/adr/selecta-microinteraction-evidence.md`, `docs/adr/selecta-microinteraction-implementation-checklist.md`; `docs/adr/selecta-microinteraction-verification-matrix.md`; independent checks pending.**
2. **MI-0164-02 - Create visual candidate matrix.** Acceptance: Every major surface in three themes, two motion modes and target viewports. Required verification: Named screenshot inventory. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: complete visual candidate matrix in `docs/adr/selecta-microinteraction-verification-protocols.md`; named screenshot review remains open.**
3. **MI-0164-03 - Define auditory continuity protocol.** Acceptance: Gap/overlap, preview ownership and fallback verified on real audio. Required verification: Recorded output and listening notes. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: real-audio continuity capture protocol in `docs/adr/selecta-microinteraction-verification-protocols.md`; recordings/listening notes remain open.**
4. **MI-0164-04 - Set uncoached task study.** Acceptance: First play, request, edit, Studio, export and recovery with denominators. Required verification: Study script and results. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: uncoached task-study script and result schema in `docs/adr/selecta-microinteraction-verification-protocols.md`; participant results remain open.**
5. **MI-0164-05 - Review accessibility manually.** Acceptance: NVDA/Edge, touch, zoom, cognitive and reduced-motion checks. Required verification: Named participant evidence. **Implementation: In progress; Verified: No; owner: Unassigned; PR/SHA: feat/finish-checklists-2 @ \779bd3c\ (WIP, 2026-11-12); evidence: code part built on 2026-11-12: a review sheet for NVDA with Edge, touch, 200 and 400% zoom, cognitive and reduced motion recording pass, failures and environment per check, in `src/selecta/audit/mi_study_kit.py` (`python -m selecta.audit.mi_study_kit sheet|check|summary MI-0164-05`) and the study kit section of `docs/adr/selecta-microinteraction-verification-protocols.md`; `tests/test_mi_study_kit.py` 33/33 passed on 2026-11-12. Left In progress and unticked: the acceptance is the people's result, which code cannot produce, and ticking would drop the task from the owner runbook. Needs a person: named participants run the NVDA with Edge, touch, zoom, cognitive and reduced-motion checks, recorded in a kit record that passes `check`.**
6. **MI-0164-06 - Set performance thresholds.** Acceptance: Reference hardware, p95 frame/INP and background load recorded. Required verification: Actual traces, not estimates. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: reference thresholds and trace-reporting contract in `docs/adr/selecta-microinteraction-verification-protocols.md`; actual traces remain open.**
7. **MI-0164-07 - Specify rollback and preservation.** Acceptance: Old to candidate to old data retains mix, drafts, prefs and audio. Required verification: Rehearsal with isolated data directory. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: old-new-old preservation rehearsal in `docs/adr/selecta-microinteraction-verification-protocols.md` plus `tests/rollback_check.py`; candidate rehearsal remains open.**
8. **MI-0164-08 - Record owner GO/NO-GO.** Acceptance: No undocumented P0, all P1 dispositioned, decision owners named. Required verification: Signed release gate with SHA. **Implementation: In progress; Verified: No; owner: Unassigned; PR/SHA: feat/finish-checklists-2 @ \779bd3c\ (WIP, 2026-11-12); evidence: code part built on 2026-11-12: a GO/NO-GO record that refuses a GO over an unfixed P0, any P1 without a disposition and owner, no decision owners, or no exact SHA, in `src/selecta/audit/mi_study_kit.py` (`python -m selecta.audit.mi_study_kit sheet|check|summary MI-0164-08`) and the study kit section of `docs/adr/selecta-microinteraction-verification-protocols.md`; `tests/test_mi_study_kit.py` 33/33 passed on 2026-11-12. Left In progress and unticked: the acceptance is the people's result, which code cannot produce, and ticking would drop the task from the owner runbook. Needs a person: the owner signs GO/NO-GO with no undocumented P0, every P1 dispositioned and decision owners named, on an exact SHA, recorded in a kit record that passes `check`.**

## Shared invariants and negative cases

Preserve original audio files; current/draft and revision identities; one audio-focus owner; manual Pause authority; explicit bridge consent and atomic join; full eight-lane Studio; existing library/route/search operations; blind-study neutrality; decodable exact-revision FLAC; local-only server and truthful LRCLIB metadata disclosure. **No desktop packager, native/browser folder-picker bridge, accounts, SaaS, cloud media upload, subscriptions, remote telemetry or sound effects.**

Review idle, hovered, focused, pressed, selected, queued, rendering, ready, blocked, failed, retry, cancellation, stale response, missing metadata, long/RTL names, low-resource mode and offline recovery. Run dark/light/system, forced colors, 320–2560px, 200/400% zoom, coarse touch, keyboard, NVDA/Edge, reduced-motion and audio-continuity checks as applicable. Automated screenshots/test passes are not human validation.

## Status, dependencies and records

PR #31 records code implementation with referenced source and automation. **Implemented is not independently Verified**; a named reviewer must still record all required real-world theme, accessibility, audio, performance and user results before Yes or owner Acceptance. [Immersive programme roadmap](selecta-microinteraction-roadmap.md) · [240-task checklist](selecta-microinteraction-implementation-checklist.md) · [evidence ledger](selecta-microinteraction-evidence.md) · [state and motion matrix](selecta-microinteraction-motion-matrix.md) · [release gates](selecta-microinteraction-release-gates.md).
