# Selecta 3.1 — finishing implementation and independent verification ledger

- **Date:** 2026-11-07.
- **Programme decisions:** 11 Proposed (ADR-0078–0088); none accepted as part of this proposal.
- **Implementation:** Not started; **0/116 Implemented, 0/116 Verified**.
- **Scope of this PR:** Documentation only, against `main` `3b01dc1336aab0f1cb0a4d85be5eba359de81831`.
- **Important historical distinction:** PR #24 is **merged**. The earlier 3.0 ledger still records it as in progress/open and 0 merged; that is a stale planning snapshot requiring item-by-item reconciliation, **not** a basis for retroactively marking any S3 item complete.
- **Evidence presently available:** repository source inspection, original 3.0 docs and existence of prior automated tests. This docs PR has **not** run actual browser screenshots, human AT, independent usability research, real audio auditions or performance tests.

## Individual ADR status

| ADR | Decision | Implementation | Verified | Workstream |
|---|---|---|---:|---|
| [ADR-0078](adr-0078-baseline-evidence-and-governance.md) | Proposed | Not started | 0/10 | Reconcile the shipped 3.0 baseline and govern finishing work |
| [ADR-0079](adr-0079-visual-system-and-css-ownership.md) | Proposed | Not started | 0/10 | Unify typography, themes, visual rhythm and CSS ownership |
| [ADR-0080](adr-0080-interaction-state-recovery-and-undo.md) | Proposed | Not started | 0/10 | Make controls, asynchronous states, recovery and Undo dependable |
| [ADR-0081](adr-0081-first-run-explore-and-mix-choice.md) | Proposed | Not started | 0/10 | Reduce friction from first music folder to a confident first mix |
| [ADR-0082](adr-0082-listen-shell-stage-and-audio-trust.md) | Proposed | Not started | 0/11 | Polish Listen, navigation, mini-player and Stage without audio regressions |
| [ADR-0083](adr-0083-mixes-editor-inspector-and-export.md) | Proposed | Not started | 0/12 | Make drafts, timeline editing, transition intent and export unambiguous |
| [ADR-0084](adr-0084-stem-studio-workstation-polish.md) | Proposed | Not started | 0/9 | Refine Stem Studio's expert controls without reducing capability |
| [ADR-0085](adr-0085-requests-and-music-discovery.md) | Proposed | Not started | 0/10 | Clarify Requests, consented bridges and discovery auditions |
| [ADR-0086](adr-0086-library-workspace-study-and-operational-trust.md) | Proposed | Not started | 0/11 | Polish Library, Workspace, studies and operational status |
| [ADR-0087](adr-0087-accessibility-responsive-and-performance-gates.md) | Proposed | Not started | 0/11 | Verify WCAG, device reflow, audio latency and scale |
| [ADR-0088](adr-0088-research-visual-regression-and-release.md) | Proposed | Not started | 0/12 | Require observable user, visual and product acceptance before release |
| **Total** | 11 proposed | 0 implemented | **0/116** | |

## Evidence schema required for each S31 ID

1. **Identity:** S31 ID, related ADR, inherited S3/T/P/parity IDs, product surface, issue priority.
2. **Decision:** owner, date, Accepted/Rejected/Superseded rationale and dependencies.
3. **Implementation:** PR, exact commit, merged status and file scope; partial implementation clearly described.
4. **Acceptance:** expected observable outcome, adverse test, actual result, supported browser/OS.
5. **Automated:** exact commands/CI link, named assertions, fixture and failure result. A green build alone is insufficient.
6. **Visual:** screenshot/test reference, approved baseline, dark/light, viewport, font, clock and source-safe synthetic metadata.
7. **Manual:** keyboard, supported screen reader with OS/AT version, touch, 200/400% zoom, user-task outcomes, as applicable.
8. **Music and data:** real audio continuity/revision-accurate FLAC/bridge or draft provenance as applicable; unrelated data unchanged.
9. **Scale/security:** hardware, production build, timings, external network observation and unsupported platforms where applicable.
10. **Release:** P0/P1/P2 disposition, owner review, rollback confirmation, open limitations and final Verified sign-off.

## Status advancement

- **Not started:** planning only; no runtime work or proven acceptance outcome.
- **In progress:** approved implementing PR with task IDs and actual code/test changes.
- **Implemented:** code merged and appropriate automated test evidence recorded.
- **Verified:** implemented *and* relevant human visual, accessibility, music, usability and performance acceptance independently recorded.
- **Blocked / N/A:** recorded reason with owner and impact. Neither counts as Verified.

Every check in [the 116-item tracker](selecta-3-1-implementation-checklist.md) remains unchecked until Verified. Do not rewrite historical 3.0 data; reconcile via evidence and link the old items.

## Current disposition

**Proposed documentation package, zero runtime changes and zero task verification.** No release approval is implied by a PR, merged documentation or a CI badge.
