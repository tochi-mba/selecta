# ADR-0109: Blind A/B listening study, harmonic feedback and learning-data integrity

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** In progress (8/10 implemented, 1 in progress; source reconciliation 2026-11-10, branch feat/finish-checklists)
- **Verification status:** Not verified (0/10)
- **Documentation status:** Drafted, documentation-only Selecta 4.0 proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 4.0 complete UI/UX overhaul
- **Phase:** 9 Operations
- **Extends, does not automatically supersede:** ADR-0021, ADR-0066, ADR-0086
- **Source surfaces to reconcile:** `web/src/views/Listening.tsx`; `web/src/views/Workshop.tsx`; `src/selecta/routes/* (study API; confirm route owner)`
- **Tasks:** S4-0109-01 through S4-0109-10 in [the Selecta 4.0 checklist](selecta-4-implementation-checklist.md)
- **Baseline:** `main` `9b663f9f10212619f27ce67ce82f602347065cbd` (after merged PRs #25 and #26)

## Context and evidence boundary

The study is a controlled comparison and should not be conflated with casual Good/Bad feedback. Redesign must retain version blindness and scientifically meaningful responses.

This is a **proposal**. Source inspection and earlier planning documents establish current contracts and candidate risks; they do not establish verified visual quality, human task success, real audio quality, screen-reader usability or shipped implementation of this ADR. Earlier programme status headings can be stale and are not inherited as verified work.

## Proposed decision

Give study tasks a dedicated minimal interface with clear session/progress/Version A and B controls, assured playback ownership, complete response validation and precise save/retry semantics while retaining the existing experimental protocol.

## Experience, frontend and interaction specification

- Version provenance and model parameters remain concealed until the study allows disclosure.
- Both clips must be audibly available and heard where the existing protocol requires before grading.
- Separate overall preference, quality scoring, issue tags and skip with explicit choices.
- Session reload, errors and duplicate submission must retain trial identity and blinding.

## Detailed implementation work

1. **S4-0109-01 - Inventory exact trial protocol and field requirements before UI changes.** Acceptance: No study variable is removed or accidentally exposed. Required verification: Protocol comparison against backend and tests. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: docs/listening-procedure.md; tests/test_listening.py covers the trial fields. Needs a person: protocol comparison by the researcher.
2. **S4-0109-02 - Redesign enrollment, session status and progress hierarchy.** Acceptance: Study code/input failure and session recovery understandable. Required verification: Invalid/expired code/reload tests. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: web/src/views/Listening.tsx study code field and load error; Listening.test.tsx 'restores unfinished ratings for the same study, without leaking them to another study'. Needs a person: invalid/expired code review.
3. **S4-0109-03 - Create accessible Version A/B transport.** Acceptance: Correct clip, no main-player overlap or wrong label. Required verification: Real media and focus/keyboard tests. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: Listening.tsx takes audio per version; flows.e2e.ts 'the listening test: nothing gives away which is which'. Needs a person: real media keyboard check.
4. **S4-0109-04 - Preserve exact heard-before-answer constraint where applicable.** Acceptance: UI cannot accept unsupported judgement or bypass required listen. Required verification: Missing clip and incomplete audition tests. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: Listening.test.tsx 'won't let you choose between two you haven't both heard'. Needs a person: independent review.
5. **S4-0109-05 - Preserve preference, quality and multi-tag form.** Acceptance: Data values correspond to existing response schema. Required verification: Validation/boundary/selection tests. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: Listening.test.tsx 'what's saved is the same grade and tags as ever', 'issues are ordinary checkboxes'. Needs a person: independent review.
6. **S4-0109-06 - Prevent version provenance leakage in UI/logs.** Acceptance: Blind A/B identity not inferable from labels, URLs or status. Required verification: Protocol/privacy review and E2E. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: tests/test_listening.py 'trials_hide_conditions_and_leave_unanswered_trials_unanswered', 'private_method_labels_group_pairs_but_keep_renderer_versions_separate'. Needs a person: protocol/privacy review.
7. **S4-0109-07 - Make submit pending/success/failure and retry truthful.** Acceptance: Duplicate or timed-out submit cannot record multiple trials. Required verification: Idempotent save and reordered response tests. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: Listening.tsx keeps one operation id per answer; Listening.test.tsx 'keeps a failed save on its current trial'; flows.e2e.ts 'a failed send can be retried'. Needs a person: independent review.
8. **S4-0109-08 - Handle skip, no trials left and early exit safely.** Acceptance: No false completion and session state recoverable. Required verification: Skip/reload/end-of-study tests. **Implementation: Implemented (2026-11-12); Verified: No.** Evidence: behind flag `listening_study.skip_and_stop` (src/selecta/flags/learning.json), web/src/views/Listening.tsx adds Skip this comparison (saves nothing, counted as skipped), Stop for now (sends nothing; reopening with the same code, nickname and setup carries on there) and a second pass over skipped ones; the end says 'You reached the end, with N skipped' instead of 'All responses saved' while any is skipped. web/src/views/Listening.skip.test.tsx 'a skip sends nothing, and the end says how many were skipped instead of claiming all were saved', 'stopping for now sends nothing, and opening the same study again carries on from there', 'with the flag off there is no skip or stop, and the page reads as before', 'no trials left is not a completion' and nextUnanswered; vitest Listening.skip.test.tsx with Listening.test.tsx 20/20 passed 2026-11-12. Needs a person: owner decides whether skip and stop stay on for real studies (flag `listening_study.skip_and_stop`) and the researcher confirms a skipped comparison stays unanswered on the server; pass = both sign the decision in docs/verification/listening-comprehension-script.md.
9. **S4-0109-09 - Protect main audio ownership during study.** Acceptance: Explicit pause/resume policy never surprises listener. Required verification: Listen→study→Listen handoff tests. **Implementation: Implemented (2026-11-10, source-reconciled); Verified: No.** Evidence: Listening.tsx takeAudio/releaseAudio; focus.test.tsx; web/e2e/listen.e2e.ts 'a preview takes the sound, and gives it back when it's done'. Needs a person: Listen to study to Listen handoff by ear.
10. **S4-0109-10 - Record human comprehension and actual protocol acceptance.** Acceptance: No claimed scientific validity without review. Required verification: Researcher sign-off and task observation. **Implementation: In progress (2026-11-12); Verified: No.** Evidence: docs/verification/listening-comprehension-script.md (8 observed tasks, 4 comprehension questions, researcher protocol-acceptance table); tests/test_s4_0109_comprehension_script.py 'every_quoted_wording_is_on_the_study_page', 'the_acceptance_table_has_no_unsigned_rows', 'the_script_names_the_skip_and_stop_wording_behind_its_flag' 3/3 passed 2026-11-12. Needs a person: a researcher runs docs/verification/listening-comprehension-script.md with real, unbriefed participants on a study of at least three comparisons and signs the protocol-acceptance row (date, name, commit SHA, participants, tasks and questions understood, accepted yes/no); pass = a signed row with every task understood or each failure recorded as a finding.

## Required negative cases and regression strategy

- Version A audio unavailable; UI cannot claim both heard.
- Switch tab during an unfinished trial; state remains accurate.
- Study code and local metadata must not leak in diagnostics or screenshots.
- Exercise light, dark and system themes; empty, loading, partial, ready, stale, failed, offline and recovering states where applicable.
- Exercise 320/375/390/430/768/1024/1280/1440/1920 CSS-pixel widths, short viewports, 200/400% zoom, keyboard, touch, reduced motion, realistic long/missing/duplicate/Unicode/RTL metadata.
- Maintain existing frontend, API, audio and Python assertions; changed markup may require selector updates but never weakened behavioural contracts.

## Preservation and dependencies

Retain the [existing Selecta 3.0 invariants INV-01–INV-20](selecta-3-roadmap.md) and [3.1 preservation contract](selecta-3-1-roadmap.md): no original-file mutation; local-first security and LRCLIB disclosure; no loss of current/draft state, preferences, corrections or ratings; stable old routes; one audio owner; exact request consent and atomic join; truthful requested-versus-rendered state; revision-pinned decodable FLAC; full keyboard alternatives and regression assertions. No backend, schema, audio-engine or dependency rewrite is authorized by this ADR. See [4.0 parity matrix](selecta-4-feature-parity.md) and [verification matrix](selecta-4-verification-matrix.md).

## Alternatives, risks and trade-offs

A minimal focused trial UI may feel less decorative, improving concentration and research validity.

## Evidence and advancement rules

An owner must separately **Accept** this decision before it becomes policy. Each implementing PR must name the S4-0109 task IDs, actual commit(s), changed files, pre-existing regression tests, new negative/concurrency cases, theme/viewport screenshots and relevant human/audible/AT evidence. **Implemented** requires merged code and applicable automated checks; **Verified** additionally requires independent real acceptance relevant to the change. An unchecked checkbox means not Verified. A docs merge does not advance these statuses.

## Status history

| Date | Decision | Implementation | Verification | Evidence |
|---|---|---|---|---|
| 2026-11-07 | Proposed | Not started | Not verified | Documentation-only specification; no runtime, test or UI changes |
| 2026-11-08 | Accepted | Not started | Not verified | Owner accepted all proposed ADRs ([#37](https://github.com/tochi-mba/selecta/pull/37)) |
| 2026-11-10 | Accepted | In progress (8/10) | Not verified | Source reconciliation against current code with focused tests run 2026-11-10; every task still needs independent verification |
| 2026-11-12 | Accepted | In progress (9/10) | Not verified | Automatable parts of the person-step tasks built and run 2026-11-12; every task still needs a person or independent verification |

## Related documents

- [Selecta 4.0 roadmap and ADR index](selecta-4-roadmap.md)
- [4.0 implementation checklist](selecta-4-implementation-checklist.md)
- [4.0 per-task evidence ledger](selecta-4-evidence.md)
- [4.0 verification and edge-case matrix](selecta-4-verification-matrix.md)
- [4.0 release readiness criteria](selecta-4-release-gates.md)
- [Earlier 3.1 implementation checklist](selecta-3-1-implementation-checklist.md)
