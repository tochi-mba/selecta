# ADR-0129 - Neutral blind A/B listening study with protocol integrity

- **Decision:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation:** 4/5 Implemented; 1 Not started (2026-11-10).
- **Verified:** 1/5 (EX-0129-04, 2026-11-10).
- **Proposed:** 2026-11-07. **Baseline:** `main` `6638ec2313ce53843adfaf363306f8e79c4c8c7e` after merged PR #29.
- **Priority / phase:** P1 / Operations.
- **Related:** ADR-0109, ADR-0066, not automatically superseded or verified.
- **Source touchpoints:** `web/src/views/Listening.tsx`, `src/selecta/listening.py`, `docs/listening-procedure.md`.

## Context and evidence limits

Selecta includes a blind listening comparison system. Method names must remain hidden to participants, A and B controls must be equally prominent, and responses must stay associated with their study/pair identity. This is a future design proposal; source-observed current functionality, CI and previous ADRs do not prove an implemented new experience or actual user acceptance.

## Decision proposal

- Give alternatives A and B symmetrical visual and interaction priority without audio-method hints.
- Keep listening controls, quality grading, overall preference and submitting responses visibly distinct.
- Retain study code, listener setup, order, exact condition keys and once-only submission rules.
- Represent unavailable audio, incomplete listening and save failure honestly.
- Require actual human listening/protocol acceptance beyond automated rendering and screenshot checks.

## Alternatives and tradeoffs

Animated visual feedback could bias participants; a neutral symmetric comparison is less exciting but preserves experimental validity.

## Consequences, scope and failure modes

Do not change randomization, normalization, study data model or reports through this UI programme; preserve blindness even in accessibility labels and logs. Preserve all existing routes, data, local file safety, listening study integrity, explicit bridge consent, revisions/Undo, single-owner transport and frozen-revision FLAC. Neither desktop packaging nor SaaS migration nor unreviewed backend/audio changes are part of this programme.

## New implementation status per task

1. **EX-0129-01 - Audit all method leakage**. **Acceptance:** No method/renderer names visible or announced. **Verification:** Screenreader, DOM and protocol audit. **Implementation: Implemented; Verified: No. Needs a person: screen-reader pass.** Evidence: `tests/test_ex_0129_study_integrity.py`, MP-0294-07.
2. **EX-0129-02 - Design balanced A/B interface**. **Acceptance:** Equal control treatment and order clarity. **Verification:** Counterbalanced human pilot. **Implementation: Implemented; Verified: No. Needs a person: counterbalanced human pilot.**
3. **EX-0129-03 - Separate listening, grading and save**. **Acceptance:** Missing ratings and submissions explained. **Verification:** Study form validation E2E. **Implementation: Implemented; Verified: No.** Open: MP-0294-05/-06 E2E needs a green rerun.
4. **EX-0129-04 - Preserve once-only identity**. **Acceptance:** Retry/race cannot double-submit or misattribute answer. **Verification:** API and delayed response tests. **Implementation: Implemented; Verified: Yes (2026-11-10).** Evidence: `tests/test_ex_0129_study_integrity.py` (5 passed).
5. **EX-0129-05 - Verify with real blind sessions**. **Acceptance:** Method remains hidden and ratings recorded accurately. **Verification:** Named listener/protocol reviewer. **Implementation: Not started; Verified: No. Needs a person: named listener and protocol reviewer.**

## Independent verification

Review dark/light/system themes, empty/loading/stale/failed/partial states, 320–2560px widths, 200/400% zoom, reduced motion, keyboard/touch/NVDA, long/duplicate/RTL content and concurrent operations. Test actual audio when audible behavior is claimed. Do not mark new tasks done based on PR #29 without task-specific mapping. [WCAG 2.2](https://www.w3.org/TR/WCAG22/), [human-AI interaction research](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/) and [NN/g disclosure](https://www.nngroup.com/articles/progressive-disclosure/) inform patterns, not measured Selecta outcomes. [Checklist](selecta-experience-implementation-checklist.md) · [Evidence](selecta-experience-evidence.md) · [Historical status](selecta-experience-status-reconciliation.md).
