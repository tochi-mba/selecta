# ADR-0076: Incremental migration, rollout controls, rollback and delivery order

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** In progress: 7 of 9 tasks implemented with automated evidence on 2026-11-11; 2 need a person; 0 still open
- **Documentation status:** Drafted in the Selecta 3.0 documentation-only proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.0 complete experience overhaul
- **Phase:** 7 - Verification
- **Extends existing decisions:** ADR-0030, ADR-0033, ADR-0046
- **Dependencies:** [programme roadmap](selecta-3-roadmap.md) and verified baseline; see phase order.
- **Work item statuses:** Recorded on each item below (2026-11-11). Implemented means its automated evidence ran green; nothing here is independently Verified.

## Context and rationale

A massive all-at-once frontend rewrite risks long-lived divergence and large regression surfaces. The current app and its data need to keep working while a different navigation system, component library and workspaces are introduced.

## Decision proposed

Deliver Selecta 3.0 through dependency-gated, reviewable PRs with reversible frontend rollouts and no destructive data migrations. Merge only when applicable preservation checks pass, and require an explicit release decision distinct from code merge.

## Experience and frontend architecture

- Proposed order: baseline and acceptance; route/shell/API contracts; tokens/primitives/state; onboarding/Explore/Listen/My Mixes; Editor/Inspector/Studio; Requests/Discover/Library/Workspace/Export/Studies; accessibility/scale/security; integrated verification. Cross-cutting tests run during every phase, not only at the end.

- Keep old/new route compatibility; use feature-scoped migration and reversible presentation flags where complexity warrants it. Avoid simultaneous engine changes. Update documentation statuses only when an implementing PR and evidence are linked.

- Rollback must preserve original songs, metadata overrides, drafts, ratings, settings, request state and exports. Release candidates demonstrate no loss of data or audio fidelity and are validated on actual supported installed-app workflows.

## Detailed implementation work

1. **S3-0076-01 - Implemented.** Establish dependency graph, implementation PR boundaries and minimum reviewable migration slices. **Evidence:** docs/adr/selecta-3-roadmap.md 'Dependency gates and staged delivery' (phases 0 to 7 with their gates); tests/test_s3_docs_contracts.py test_severity_delivery_order_and_gates_are_written_down (passed 2026-11-11).
2. **S3-0076-02 - Implemented.** Assign ownership of each ADR and exact feature-parity/test mapping. **Evidence:** docs/adr/selecta-3-parity-matrix.md (each feature-parity row and each unverified T and P task mapped to its S3 decisions) held by tests/test_s3_parity_task_map.py test_every_unchecked_older_task_is_mapped_under_its_own_section; ownership rules in docs/adr/selecta-3-baseline.md 'How work moves and who decides' (passed 2026-11-11).
3. **S3-0076-03 - Implemented.** Define old/new navigation coexistence, feature flags and required kill-switch conditions. **Evidence:** docs/adr/selecta-3-routes.md 'Going back: the kill switch' (?ui=classic and the Workspace switch over the same pages); src/selecta/flags/*.json kill switches held by tests/test_flags.py; web/src/flags.test.tsx 'sends classic Discover to whichever of its pages is there'; web/src/sfCompat.test.ts (passed 2026-11-11).
4. **S3-0076-04 - Needs a person.** Enforce zero unapproved backend schema, engine or privacy change as part of visual-only PRs. **Status:** Needs a person: checking that each visual-only PR carries no unapproved backend schema, engine or privacy change is a reviewer's call on that PR
5. **S3-0076-05 - Implemented.** Implement rollback rehearsal with realistic local data, drafts, request jobs and long mixes. **Evidence:** tests/rollback_check.py run against the Selecta 3.0 merge (3b01dc1, exported with git archive) on 2026-11-11: a home made by this checkout with a draft, a tempo correction, mix settings, two ratings, a request and a finished export record was read by the older build and then by this one again, reporting 'this checkout again sees exactly the same' and 'nothing lost' (passed 2026-11-11).
6. **S3-0076-06 - Implemented.** Reconcile existing polish programme tasks without rewriting historical completion. **Evidence:** older T and P ticks are left as they were and mapped, not rewritten, by docs/adr/selecta-3-parity-matrix.md, held by tests/test_s3_parity_task_map.py test_each_task_is_mapped_once_to_real_s3_decisions_and_claims_nothing_complete; src/selecta/audit/checklist_evidence.py keeps every checked task's evidence (passed 2026-11-11).
7. **S3-0076-07 - Implemented.** Require build/unit/Python/E2E/visual/security/a11y/audio gates appropriate to each slice. **Evidence:** docs/adr/selecta-3-verification-matrix.md 'Quality gates by implementation PR'; .github/workflows/test.yml runs the build, unit, Python, browser, every-feature-off, contrast and evidence gates; tests/test_s3_docs_contracts.py test_severity_delivery_order_and_gates_are_written_down (passed 2026-11-11).
8. **S3-0076-08 - Needs a person.** Record manual release sign-off, accepted limitations and go/no-go for integrated release. **Status:** Needs a person: the owner's release sign-off, accepted limitations and go or no-go for the integrated release
9. **S3-0076-09 - Implemented.** Update all S3 statuses, roadmap and evidence after actual implementation rather than pre-emptively. **Evidence:** statuses for ADR-0063 to ADR-0077 recorded from tests run on 2026-11-11, with person-only work left open; src/selecta/audit/checklist_evidence.py passes over this checklist (passed 2026-11-11).

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
