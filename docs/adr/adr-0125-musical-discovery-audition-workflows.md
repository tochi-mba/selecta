# ADR-0125 — Musical discovery as clear word and harmonic audition flows

- **Decision:** Proposed (requires named owner acceptance).
- **Implementation:** Not started (0/5 newly defined EX tasks).
- **Verified:** No (0/5 independent acceptance).
- **Proposed:** 2026-11-07. **Baseline:** `main` `6638ec2313ce53843adfaf363306f8e79c4c8c7e` after merged PR #29.
- **Priority / phase:** P1 / Collection.
- **Related:** ADR-0104, ADR-0061, not automatically superseded or verified.
- **Source touchpoints:** `web/src/views/Links.tsx`, `web/src/audio/focus.ts`, `web/src/views/Mixes.tsx`.

## Context and evidence limits

Selecta discovers lyric-word and harmonic connections, but automatically inferred musical relationships may be inaccurate or corny. Presenting machine matches as verified music would overpromise. This is a future design proposal; source-observed current functionality, CI and previous ADRs do not prove an implemented new experience or actual user acceptance.

## Decision proposal

- Give each word connection a readable pair of song identities, matching lyric context, and unambiguous preview/rating actions.
- Show harmonic discovery as a four-stage audition whose purpose and current stage users understand.
- Preserve exact pair/render/version identities and one-audio-owner preview behavior across navigation and late feedback.
- Do not claim musical truth or high confidence without human verification.
- Link the chosen pair into mix/draft workflows with explicit current mix scope and recoverability.

## Alternatives and tradeoffs

A dense grid of candidates is efficient for experts but weak for first auditions. A mandatory tutorial would slow repeated use. Choose an audition-first disclosure with fast scanning.

## Consequences, scope and failure modes

No invented lyrical timing, technique certainty or instant audio availability; human rating is evidence about what was actually heard, not an algorithm score. Preserve all existing routes, data, local file safety, listening study integrity, explicit bridge consent, revisions/Undo, single-owner transport and frozen-revision FLAC. Neither desktop packaging nor SaaS migration nor unreviewed backend/audio changes are part of this programme.

## New implementation status per task

1. **EX-0125-01 — Redesign word pair context**. **Acceptance:** Two exact track identities and meaningful shared lyric readable. **Verification:** Duplicate title and untimed lyric fixtures. **Implementation: Not started; Verified: No.**
2. **EX-0125-02 — Design four-stage harmonic audition**. **Acceptance:** Comparison order and purpose evident. **Verification:** Real audio and uncoached comprehension. **Implementation: Not started; Verified: No.**
3. **EX-0125-03 — Maintain preview focus**. **Acceptance:** No overlapping preview or unsolicited resume. **Verification:** Concurrent preview/transport tests. **Implementation: Not started; Verified: No.**
4. **EX-0125-04 — Guard feedback binding**. **Acceptance:** Rating remains attached to exact pair/version. **Verification:** Late response and changed-pair E2E. **Implementation: Not started; Verified: No.**
5. **EX-0125-05 — Verify safe add-to-mix flow**. **Acceptance:** Edit/draft/current destinations and Undo explicit. **Verification:** Active mix and draft parity test. **Implementation: Not started; Verified: No.**

## Independent verification

Review dark/light/system themes, empty/loading/stale/failed/partial states, 320–2560px widths, 200/400% zoom, reduced motion, keyboard/touch/NVDA, long/duplicate/RTL content and concurrent operations. Test actual audio when audible behavior is claimed. Do not mark new tasks done based on PR #29 without task-specific mapping. [WCAG 2.2](https://www.w3.org/TR/WCAG22/), [human-AI interaction research](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/) and [NN/g disclosure](https://www.nngroup.com/articles/progressive-disclosure/) inform patterns, not measured Selecta outcomes. [Checklist](selecta-experience-implementation-checklist.md) · [Evidence](selecta-experience-evidence.md) · [Historical status](selecta-experience-status-reconciliation.md).
