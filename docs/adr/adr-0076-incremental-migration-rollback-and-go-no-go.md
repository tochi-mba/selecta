# ADR-0076: Incremental migration, rollout controls, rollback and delivery order

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** Not started
- **Documentation status:** Drafted in the Selecta 3.0 documentation-only proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.0 complete experience overhaul
- **Phase:** 7 — Verification
- **Extends existing decisions:** ADR-0030, ADR-0033, ADR-0046
- **Dependencies:** [programme roadmap](selecta-3-roadmap.md) and verified baseline; see phase order.
- **Work item statuses:** Every S3-0076-XX item below is **Not started**. No runtime feature, test or UI change is claimed by this ADR.

## Context and rationale

A massive all-at-once frontend rewrite risks long-lived divergence and large regression surfaces. The current app and its data need to keep working while a different navigation system, component library and workspaces are introduced.

## Decision proposed

Deliver Selecta 3.0 through dependency-gated, reviewable PRs with reversible frontend rollouts and no destructive data migrations. Merge only when applicable preservation checks pass, and require an explicit release decision distinct from code merge.

## Experience and frontend architecture

- Proposed order: baseline and acceptance; route/shell/API contracts; tokens/primitives/state; onboarding/Explore/Listen/My Mixes; Editor/Inspector/Studio; Requests/Discover/Library/Workspace/Export/Studies; accessibility/scale/security; integrated verification. Cross-cutting tests run during every phase, not only at the end.

- Keep old/new route compatibility; use feature-scoped migration and reversible presentation flags where complexity warrants it. Avoid simultaneous engine changes. Update documentation statuses only when an implementing PR and evidence are linked.

- Rollback must preserve original songs, metadata overrides, drafts, ratings, settings, request state and exports. Release candidates demonstrate no loss of data or audio fidelity and are validated on actual supported installed-app workflows.

## Detailed implementation work (all Not started)

1. **S3-0076-01 — Not started.** Establish dependency graph, implementation PR boundaries and minimum reviewable migration slices.
2. **S3-0076-02 — Not started.** Assign ownership of each ADR and exact feature-parity/test mapping.
3. **S3-0076-03 — Not started.** Define old/new navigation coexistence, feature flags and required kill-switch conditions.
4. **S3-0076-04 — Not started.** Enforce zero unapproved backend schema, engine or privacy change as part of visual-only PRs.
5. **S3-0076-05 — Not started.** Implement rollback rehearsal with realistic local data, drafts, request jobs and long mixes.
6. **S3-0076-06 — Not started.** Reconcile existing polish programme tasks without rewriting historical completion.
7. **S3-0076-07 — Not started.** Require build/unit/Python/E2E/visual/security/a11y/audio gates appropriate to each slice.
8. **S3-0076-08 — Not started.** Record manual release sign-off, accepted limitations and go/no-go for integrated release.
9. **S3-0076-09 — Not started.** Update all S3 statuses, roadmap and evidence after actual implementation rather than pre-emptively.

## Preservation and integration constraints

This work must preserve all applicable capabilities in [the existing feature-parity ledger](feature-parity.md): original source music and library data; drafts, user corrections, ratings and preferences; correct current-versus-draft mutation isolation; original routes; honest playable/render readiness; a single audio owner with no unintended stop or overlap; explicit request bridge consent and atomic insertion; accurate revision-bound FLAC; and secure localhost/origin privacy. New dependencies, API fields or native integration require separately reviewed contracts; the design does not itself authorize backend replacement.

## Required tests and edge-case verification (not yet executed)

- Rollback after an editor upgrade with unsaved recovered Studio draft and active audio.
- Upgrade then downgrade without data migration; existing routes and song IDs remain valid.
- Kill-switch any broken new surface while active player and backend continue unaffected.

General test dimensions: dark and light; initial/populated/empty/partial/refreshing/busy/failed/offline/recovery; 320px–4K; zoom, pointer and keyboard; realistic long/missing/duplicate/RTL metadata; accessibility checks; stale response and race tests; representative local-audio playback where relevant. Existing tests may be adapted to accessible semantics but not deleted or weakened.

## Alternatives, risks and trade-offs

One giant UI PR provides a dramatic diff but cannot be safely reviewed and validated. Incremental integration costs coordination but preserves continuous product function.

## Acceptance and evidence

Every slice has a known rollback; the integrated release is explicitly approved only after full feature and quality verification.

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
