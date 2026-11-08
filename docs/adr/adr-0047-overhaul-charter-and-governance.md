# ADR-0047: Selecta 3.0 charter, feature preservation and decision governance

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** Not started
- **Documentation status:** Drafted in the Selecta 3.0 documentation-only proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.0 complete experience overhaul
- **Phase:** 0 — Baseline and governance
- **Extends existing decisions:** ADR-0001, ADR-0029, ADR-0030, ADR-0033
- **Dependencies:** [programme roadmap](selecta-3-roadmap.md) and verified baseline; see phase order.
- **Work item statuses:** Every S3-0047-XX item below is **Not started**. No runtime feature, test or UI change is claimed by this ADR.

## Context and rationale

The current code has a mature local audio workflow, a historical Selecta 2.0 overhaul and an overlapping polish programme (ADR-0033–0046). A new visual direction without a traceable source baseline could repeat work or unintentionally remove important capabilities. The polish documents contain status summaries that do not consistently reflect merged PR #23; historical status must not be silently rewritten as verified.

## Decision proposed

Create a separately numbered, evidence-based experience programme. Keep the warm-black/cream/electric-lime identity, all existing backend and data behavior, routes, playback, rendering and local security. Reconsider every frontend layout and interaction, but require proof of behavioral parity before declaring any replacement complete.

## Experience and frontend architecture

- Use a pinned main-branch commit and a screen/overlay/state inventory as the implementation baseline. This ADR programme is a proposal, not an authorization to rewrite audio algorithms or database schemas. Each proposed screen design must be reviewed at realistic content sizes before reuse.

- Work in reviewable, reversible PRs and maintain a capability-to-ADR-to-test mapping. Track decision status separately from implementation and verification status. Implementation means merged code with required automated checks; Verified also requires manual assistive-tech, user-task and audible evidence wherever relevant.

- No design claim may be described as a measured finding without a recorded screenshot, trace, observation or playback measurement. Use acceptance criteria tied to observable outcomes instead of 'perfect' or 'premium' as completion definitions.

## Detailed implementation work (all Not started)

1. **S3-0047-01 — Not started.** Pin the current exact commit, inventory the current app, enumerate all routes, subviews, overlays, notifications, and state transitions, and record supported OS/browser/PWA assumptions.
2. **S3-0047-02 — Not started.** Map each row of existing feature-parity.md and each unverified T/P task to one or more new S3 decisions; avoid duplicate completion claims.
3. **S3-0047-03 — Not started.** Publish a signed-off feature preservation and no-regression contract covering source audio, preferences, drafts, learning/rating data, audio ownership, bridge consent, revisions, security, lyric metadata and FLAC.
4. **S3-0047-04 — Not started.** Create three task scripts (listener, creator, expert) and capture current first-run, everyday and failure-state experience with sanitized fixtures.
5. **S3-0047-05 — Not started.** Classify defects by P0 integrity/access, P1 task/recovery and P2 presentation/detail; record affected flows and reproductions.
6. **S3-0047-06 — Not started.** Require decision review, a separate design review, implementation PR, code/test evidence, screenshot comparison, keyboard check and any needed audible evidence for each item.
7. **S3-0047-07 — Not started.** Set status rules, ownership, change control and dependency gates; unresolved risks must appear explicitly in a release disposition.
8. **S3-0047-08 — Not started.** Publish a verified no-runtime-change statement for this documentation PR; after code work starts, maintain an immutable evidence trail.

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

## References

- [Selecta 3.0 roadmap and ADR status index](selecta-3-roadmap.md)
- [Selecta 3.0 implementation checklist](selecta-3-implementation-checklist.md)
- [Selecta 3.0 verification matrix](selecta-3-verification-matrix.md)
- [Prior feature preservation contract](feature-parity.md)
- [Prior test coverage](test-coverage-matrix.md)
