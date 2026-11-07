# ADR-0063: Library detail inspector, canonical readiness and protected corrections

- **Decision status:** Proposed
- **Implementation status:** Not started
- **Documentation status:** Drafted in the Selecta 3.0 documentation-only proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.0 complete experience overhaul
- **Phase:** 5 — Discovery and operations
- **Extends existing decisions:** ADR-0018, ADR-0017, ADR-0043
- **Dependencies:** [programme roadmap](selecta-3-roadmap.md) and verified baseline; see phase order.
- **Work item statuses:** Every S3-0063-XX item below is **Not started**. No runtime feature, test or UI change is claimed by this ADR.

## Context and rationale

Track details expose measured and corrected tempo/key, half/double tempo controls, analysis priority, exclusion and readiness. Background reanalysis can update measurements while preserving manual overrides; multiple sources of readiness risk inconsistent action enablement.

## Decision proposed

Create one authoritative track-detail presentation and readiness projection. Separate measured values from effective user corrections and keep all correction data stable across rescans, background analysis and UI migration.

## Experience and frontend architecture

- A responsive details panel provides identity, readiness, measured metadata, effective override and track-management actions, with low-level diagnostics deferred to an Advanced section. Show original and effective BPM/key separately.

- The readiness badge and enabled actions share a canonical selection function; BPM alone never implies mix readiness. Corrections are validated, revision-aware and revertible. 'Never play' and 'Set aside' indicate playback policy, not deletion or file moves.

- Refreshing song metadata must never silently overwrite manual correction or incorrectly invalidate unrelated draft work. Explain which derived transition data may need rerender after correction.

## Detailed implementation work (all Not started)

1. **S3-0063-01 — Not started.** Specify canonical track readiness from existing API fields and map each user-facing reason.
2. **S3-0063-02 — Not started.** Build responsive song inspector with measured/effective BPM and key provenance.
3. **S3-0063-03 — Not started.** Retain Double, Half, manual tempo, key override, reset, exclusions, priority and classification operations.
4. **S3-0063-04 — Not started.** Validate inputs, preserve edit focus and never turn a stale measurement into a successful correction.
5. **S3-0063-05 — Not started.** Protect user overrides during concurrent reanalysis, watcher updates and duplicate-title results.
6. **S3-0063-06 — Not started.** Keep library and mix availability actions consistent with a single readiness computation.
7. **S3-0063-07 — Not started.** Describe reversible overrides and possible downstream rerender effects.
8. **S3-0063-08 — Not started.** Verify persistence, correct song identity, long metadata and missing-field fallbacks.

## Preservation and integration constraints

This work must preserve all applicable capabilities in [the existing feature-parity ledger](feature-parity.md): original source music and library data; drafts, user corrections, ratings and preferences; correct current-versus-draft mutation isolation; original routes; honest playable/render readiness; a single audio owner with no unintended stop or overlap; explicit request bridge consent and atomic insertion; accurate revision-bound FLAC; and secure localhost/origin privacy. New dependencies, API fields or native integration require separately reviewed contracts; the design does not itself authorize backend replacement.

## Required tests and edge-case verification (not yet executed)

- Half/double BPM then background reanalysis; corrected value stays effective and rederived content updates.
- Invalid key/BPM, no beat grid, stale panel, duplicate name and missing source file.
- Set aside versus Never play, priority edits under server loss and restoration of original value.

General test dimensions: dark and light; initial/populated/empty/partial/refreshing/busy/failed/offline/recovery; 320px–4K; zoom, pointer and keyboard; realistic long/missing/duplicate/RTL metadata; accessibility checks; stale response and race tests; representative local-audio playback where relevant. Existing tests may be adapted to accessible semantics but not deleted or weakened.

## Alternatives, risks and trade-offs

Show only corrected values: clean but hides provenance. Use local-only UI overrides: quick but loses canonical state. Preserve authoritative server correction semantics.

## Acceptance and evidence

Users can see and safely change exactly the metadata used for the intended song, with truthful mix readiness and preserved correction persistence.

Before marking **Implemented**, link implementing PR(s), commit(s), contract tests, component/integration/E2E tests, screenshots and rollback disposition in [the evidence ledger](selecta-3-evidence.md). Before marking **Verified**, additionally record human task testing, assistive technology and audible checks wherever the change affects them. No prospective metric is a completed observation.

## Status history

| Date | Decision | Implementation | Evidence |
|---|---|---|---|
| 2026-11-07 | Proposed | Not started | Documentation-only ADR; no application or test changes |

## References

- [Selecta 3.0 roadmap and ADR status index](selecta-3-roadmap.md)
- [Selecta 3.0 implementation checklist](selecta-3-implementation-checklist.md)
- [Selecta 3.0 verification matrix](selecta-3-verification-matrix.md)
- [Prior feature preservation contract](feature-parity.md)
- [Prior test coverage](test-coverage-matrix.md)
