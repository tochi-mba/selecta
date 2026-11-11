# ADR-0126 - Browser-first onboarding and readiness, without desktop packaging

- **Decision:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation:** Implemented 4/5 new tasks (2026-11-10, uncommitted on `feat/finish-checklists`).
- **Verified:** Automated verification 2/5 on 2026-11-10; open items name a person or a pending run in the checklist.
- **Proposed:** 2026-11-07. **Baseline:** `main` `6638ec2313ce53843adfaf363306f8e79c4c8c7e` after merged PR #29.
- **Priority / phase:** P1 / Listener.
- **Related:** ADR-0096, ADR-0106, ADR-0134, not automatically superseded or verified.
- **Source touchpoints:** `web/src/views/Start.tsx`, `web/src/views/Setup.tsx`, `web/src/views/WorkshopPanels.tsx`.

## Context and evidence limits

First-run currently accepts a local folder path and starts source scans/analysis. The product owner has expressly declined a desktop launcher or native folder-picker proposal; SaaS may happen much later, but is not an active implementation project. This is a future design proposal; source-observed current functionality, CI and previous ADRs do not prove an implemented new experience or actual user acceptance.

## Decision proposal

- Improve explanations and error handling around the existing local folder path field rather than proposing a new desktop picker.
- Make current scanning, analyzed, ready and unavailable states explicit, with a clear route to first valid playback once enough songs are ready.
- Communicate what remains local and what lyric metadata the current optional lookup sends outward.
- Preserve current folder monitoring, validation, privacy, original-media safety and accurate readiness thresholds.
- Explicitly exclude desktop launcher, installer, native file dialog, browser-to-server picker bridge, account, remote upload, SaaS backend and migration work.

## Alternatives and tradeoffs

Desktop packaging could shorten initial local setup but is intentionally out of scope and may oppose the future web strategy. A browser picker cannot automatically provide backend-readable absolute paths.

## Consequences, scope and failure modes

Do not falsely claim that current browser UI can access arbitrary filesystem paths; do not imply current app already has remote sources or SaaS authentication. Preserve all existing routes, data, local file safety, listening study integrity, explicit bridge consent, revisions/Undo, single-owner transport and frozen-revision FLAC. Neither desktop packaging nor SaaS migration nor unreviewed backend/audio changes are part of this programme.

## New implementation status per task

1. **EX-0126-01 - Improve local path guidance**. **Acceptance:** Folder path entry understandable on current server. **Verification:** First-use/invalid path comprehension test. **Implementation: Implemented; Verified: No. Needs a person: first-use and invalid-path comprehension test with a new user. Evidence: see checklist.**
2. **EX-0126-02 - Clarify readiness and first mix**. **Acceptance:** Ready tracks are usable while others analyze. **Verification:** Partial and complete readiness E2E. **Implementation: Implemented; Verified: Yes (automated, 2026-11-10). Evidence: see checklist.**
3. **EX-0126-03 - Specify failure/recovery states**. **Acceptance:** No music, cancelled scan, server down and bad path distinct. **Verification:** Fault/permission fixtures. **Implementation: Implemented; Verified: Yes (automated, 2026-11-10). Evidence: see checklist.**
4. **EX-0126-04 - Audit current network/privacy copy**. **Acceptance:** Local files and LRCLIB metadata lookup represented accurately. **Verification:** Source/API and disclosure review. **Implementation: Implemented (audit); Verified: No. Needs a person: owner disclosure decision on whether the glossary line "nothing else about your music is sent anywhere" should also mention these model downloads. Evidence: see checklist.**
5. **EX-0126-05 - Enforce excluded platform scope**. **Acceptance:** No desktop packaging/native picker or SaaS feature introduced. **Verification:** PR path/dependency checklist. **Implementation: Superseded in part; Verified: No. Superseded by ADR-0391: Selecta Cloud (a SaaS) is now an accepted goal, so the "no SaaS feature" exclusion no longer holds; the desktop-packaging and native-picker exclusions still hold. Evidence: see checklist.**

## Independent verification

Review dark/light/system themes, empty/loading/stale/failed/partial states, 320–2560px widths, 200/400% zoom, reduced motion, keyboard/touch/NVDA, long/duplicate/RTL content and concurrent operations. Test actual audio when audible behavior is claimed. Do not mark new tasks done based on PR #29 without task-specific mapping. [WCAG 2.2](https://www.w3.org/TR/WCAG22/), [human-AI interaction research](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/) and [NN/g disclosure](https://www.nngroup.com/articles/progressive-disclosure/) inform patterns, not measured Selecta outcomes. [Checklist](selecta-experience-implementation-checklist.md) · [Evidence](selecta-experience-evidence.md) · [Historical status](selecta-experience-status-reconciliation.md).
