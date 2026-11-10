# ADR-0047: Selecta 3.0 charter, feature preservation and decision governance

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** In progress: 5 of 8 tasks implemented with automated evidence on 2026-11-10; 3 need a person; 0 still open
- **Documentation status:** Drafted in the Selecta 3.0 documentation-only proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.0 complete experience overhaul
- **Phase:** 0 - Baseline and governance
- **Extends existing decisions:** ADR-0001, ADR-0029, ADR-0030, ADR-0033
- **Dependencies:** [programme roadmap](selecta-3-roadmap.md) and verified baseline; see phase order.
- **Work item statuses:** Recorded on each item below (2026-11-10). Implemented means its automated evidence ran green; nothing here is independently Verified.

## Context and rationale

The current code has a mature local audio workflow, a historical Selecta 2.0 overhaul and an overlapping polish programme (ADR-0033–0046). A new visual direction without a traceable source baseline could repeat work or unintentionally remove important capabilities. The polish documents contain status summaries that do not consistently reflect merged PR #23; historical status must not be silently rewritten as verified.

## Decision proposed

Create a separately numbered, evidence-based experience programme. Keep the warm-black/cream/electric-lime identity, all existing backend and data behavior, routes, playback, rendering and local security. Reconsider every frontend layout and interaction, but require proof of behavioral parity before declaring any replacement complete.

## Experience and frontend architecture

- Use a pinned main-branch commit and a screen/overlay/state inventory as the implementation baseline. This ADR programme is a proposal, not an authorization to rewrite audio algorithms or database schemas. Each proposed screen design must be reviewed at realistic content sizes before reuse.

- Work in reviewable, reversible PRs and maintain a capability-to-ADR-to-test mapping. Track decision status separately from implementation and verification status. Implementation means merged code with required automated checks; Verified also requires manual assistive-tech, user-task and audible evidence wherever relevant.

- No design claim may be described as a measured finding without a recorded screenshot, trace, observation or playback measurement. Use acceptance criteria tied to observable outcomes instead of 'perfect' or 'premium' as completion definitions.

## Detailed implementation work

1. **S3-0047-01 - Implemented.** Pin the current exact commit, inventory the current app, enumerate all routes, subviews, overlays, notifications, and state transitions, and record supported OS/browser/PWA assumptions. **Evidence:** docs/adr/selecta-3-baseline.md 'Starting point' (pinned commit 84b8b5c, Windows/Chromium/Edge/PWA assumptions), 'Every place, overlay and message' and 'States by surface'; docs/adr/mp-0272-surface-inventory.json held to the source by web/src/shell/mpSurfaceInventory.test.ts 'covers every page and tab the router can produce', 'covers every overlay the source opens' and 'covers every destination and tab in the navigation manifest' (passed 2026-11-10).
2. **S3-0047-02 - Implemented.** Map each row of existing feature-parity.md and each unverified T/P task to one or more new S3 decisions; avoid duplicate completion claims. **Evidence:** docs/adr/selecta-3-parity-matrix.md maps every existing capability row of feature-parity.md to its S3 ADRs and, in 'Unverified T and P tasks -> S3 decisions', every T and P task unchecked on 2026-11-10 to the S3 decisions that own it, as a mapping only that completes nothing; tests/test_s3_parity_task_map.py 'test_every_unchecked_older_task_is_mapped_under_its_own_section' and 'test_each_task_is_mapped_once_to_real_s3_decisions_and_claims_nothing_complete' (passed 2026-11-10).
3. **S3-0047-03 - Needs a person.** Publish a signed-off feature preservation and no-regression contract covering source audio, preferences, drafts, learning/rating data, audio ownership, bridge consent, revisions, security, lyric metadata and FLAC. **Status:** Needs a person: the owner must sign off the preservation contract written in docs/adr/selecta-3-baseline.md 'What must never break' (the implementer wrote it; sign-off is not theirs to give).
4. **S3-0047-04 - Needs a person.** Create three task scripts (listener, creator, expert) and capture current first-run, everyday and failure-state experience with sanitized fixtures. **Status:** Needs a person: the listener, creator, expert and failure scripts are written in docs/adr/selecta-3-baseline.md 'Task scripts'; running them with an unbriefed participant on a real library and recording completion, time and hesitation is human work.
5. **S3-0047-05 - Implemented.** Classify defects by P0 integrity/access, P1 task/recovery and P2 presentation/detail; record affected flows and reproductions. **Evidence:** docs/adr/selecta-3-baseline.md 'How issues are judged' (P0/P1/P2) and 'Defects found while doing this' (each defect with its fix), plus docs/adr/mp-0272-defect-register.md; the recorded P0/P1 defects stay fixed under web/src/audio/focus.test.tsx 'a new preview stops the old one, and the mix waits for the last of them', web/src/ui/controls.test.tsx 'keeps older Undo blocked while the newer one runs and after it fails' and web/e2e/finishing.e2e.ts 'the mini-player and bottom bar never overlap, and the last row can always be reached' (passed 2026-11-10).
6. **S3-0047-06 - Needs a person.** Require decision review, a separate design review, implementation PR, code/test evidence, screenshot comparison, keyboard check and any needed audible evidence for each item. **Status:** Needs a person: the rule is recorded (checklist 'Required completion evidence for every S3 item', docs/adr/selecta-3-baseline.md 'How work moves and who decides'), but the separate design review, screenshot comparison and audible check for each item are reviews only a person can perform.
7. **S3-0047-07 - Implemented.** Set status rules, ownership, change control and dependency gates; unresolved risks must appear explicitly in a release disposition. **Evidence:** docs/adr/selecta-3-baseline.md 'How work moves and who decides' (status rules, ownership, owner-only decisions), docs/adr/selecta-3-roadmap.md release gates and docs/adr/selecta-3-verification-matrix.md P0/P1/P2 disposition rules; ticks are machine-checked by src/selecta/audit/checklist_evidence.py under tests/test_checklist_evidence.py (passed 2026-11-10).
8. **S3-0047-08 - Implemented.** Publish a verified no-runtime-change statement for this documentation PR; after code work starts, maintain an immutable evidence trail. **Evidence:** docs/adr/selecta-3-baseline.md 'This document's own honesty' records that the no-runtime-change statement held for PR 24 as opened and stopped holding once code was added; the evidence trail is this checklist plus docs/adr/selecta-3-evidence.md, guarded by src/selecta/audit/checklist_evidence.py and tests/test_checklist_evidence.py (passed 2026-11-10).

## Preservation and integration constraints

This work must preserve all applicable capabilities in [the existing feature-parity ledger](feature-parity.md): original source music and library data; drafts, user corrections, ratings and preferences; correct current-versus-draft mutation isolation; original routes; honest playable/render readiness; a single audio owner with no unintended stop or overlap; explicit request bridge consent and atomic insertion; accurate revision-bound FLAC; and secure localhost/origin privacy. New dependencies, API fields or native integration require separately reviewed contracts; the design does not itself authorize backend replacement.

## Required tests and edge-case verification (not yet executed)

- Baseline 320/375/390/430/768/1024/1280/1440/1920/3840 widths, both themes, focus, zoom and realistic long/RTL metadata.
- Cross-feature scenario: edit draft B while A plays and receives a bridge request; verify no wrong-scope mutations or audio pause.
- Review rollback, CI compatibility, manual listening and screen-reader evidence independently; document gaps rather than guessing.

General test dimensions: dark and light; initial/populated/empty/partial/refreshing/busy/failed/offline/recovery; 320px–4K; zoom, pointer and keyboard; realistic long/missing/duplicate/RTL metadata; accessibility checks; stale response and race tests; representative local-audio playback where relevant. Existing tests may be adapted to accessible semantics but not deleted or weakened.

## Alternatives, risks and trade-offs

A one-shot reimplementation is faster to draw but too risky to validate. Reusing the old polish checklist alone obscures the new information architecture and workspace decisions. This additive programme keeps the old decisions historically intact.

## Acceptance and evidence

All pre-existing capabilities have an assigned preservation owner and test; every meaningful visual state has an inventory entry; no task is counted as implemented solely because this document merged.

Before marking **Implemented**, link implementing PR(s), commit(s), contract tests, component/integration/E2E tests, screenshots and rollback disposition in [the evidence ledger](selecta-3-evidence.md). Before marking **Verified**, additionally record human task testing, assistive technology and audible checks wherever the change affects them. No prospective metric is a completed observation.

## Status history

| Date | Decision | Implementation | Evidence |
|---|---|---|---|
| 2026-11-07 | Proposed | Not started | Documentation-only ADR; no application or test changes |
| 2026-11-08 | Accepted | Not started | Owner accepted all proposed ADRs ([#37](https://github.com/tochi-mba/selecta/pull/37)) |
| 2026-11-10 | Accepted | In progress (4/8) | Task-by-task evidence on each item; 3 need a person, 1 still open |

## References

- [Selecta 3.0 roadmap and ADR status index](selecta-3-roadmap.md)
- [Selecta 3.0 implementation checklist](selecta-3-implementation-checklist.md)
- [Selecta 3.0 verification matrix](selecta-3-verification-matrix.md)
- [Prior feature preservation contract](feature-parity.md)
- [Prior test coverage](test-coverage-matrix.md)
