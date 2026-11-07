# ADR-0083: Make drafts, timeline editing, transition intent and export unambiguous

- **Decision status:** Proposed (owner review required)
- **Implementation status:** Not started
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.1 verification-led UI/UX finishing (documentation only)
- **Phase:** 3 — creator journeys
- **Extends:** ADR-0056, ADR-0057, ADR-0058, ADR-0065. No inherited task is automatically complete.
- **Dependencies:** ADRs 0078–0080; audio trust in ADR-0082.
- **Checklist:** S31-0083-01 through S31-0083-12 in [the 3.1 checklist](selecta-3-1-implementation-checklist.md).

## Context and verified source boundary

Relevant current repository surfaces: `web/src/views/{MyMixes,Drafts,Mix,EditorRows,EditorHeader,SeamInspector,ExportPanel,ExportJobs}.tsx`, `web/src/views/mixScope.ts`, `src/selecta/routes/{edit,exports}.py` (contract review). Source inspection and the existing 3.0 documentation establish the available controls and contracts; they do **not** establish rendered quality, human usability, screen-reader conformance or subjective audio quality. The source baseline is the 3.0 merge `3b01dc1336aab0f1cb0a4d85be5eba359de81831`. All new work is proposed.

## Proposed decision

Differentiate current and draft scopes at every destructive or playback action. Make songs and transition seams readable as one timeline, preserve exact requested versus rendered transition state and make export revision/ownership explicit.

## Non-negotiable preservation

Preserve [Selecta 3.0 invariants INV-01–INV-20](selecta-3-roadmap.md): music and metadata safety; local-first Host/Origin boundaries and accurate LRCLIB disclosure; all routes and old aliases; stable current/draft identity and guarded writes; persisted drafts, corrections and preferences; single-owner playback and previews; explicit atomic bridge consent; truthful seam/readiness; authentic revision-pinned FLAC; keyboard/AT alternatives; and complete behavioural regression assertions. This ADR does not authorize changing the audio engine, backend, schema or runtime code.

## Tasks, observable acceptance and traceable ID

1. **S31-0083-01 — Review My Mixes current/draft/render-line hierarchy.** Acceptance: Users distinguish what plays, what is saved, what is queued and what will render next.
2. **S31-0083-02 — Test new, rename, copy, delete, restore and reorder drafts.** Acceptance: Each action has clear scope, durable feedback, failure recovery and correct Undo identity.
3. **S31-0083-03 — Review creator timeline hierarchy at 2, 20 and 100 songs.** Acceptance: Track identity, seam status and contextual actions stay scannable under long metadata.
4. **S31-0083-04 — Provide predictable non-drag reorder and insertion affordances.** Acceptance: Pointer/touch/keyboard alternatives clearly indicate destination and resulting order.
5. **S31-0083-05 — Review draft versus current editor headers and action copy.** Acceptance: User knows what changes immediately affect playback and what remains a separate project.
6. **S31-0083-06 — Audit Inspector Listen/Change/Studio/Details consistency.** Acceptance: Tab semantics, pair context, focus and requested-versus-rendered outcome stay stable.
7. **S31-0083-07 — Review transition cue, style, bar count and fallback presentation.** Acceptance: User choice is not visually overwritten by a different actually rendered move.
8. **S31-0083-08 — Verify preview/rating/render failure and stale-request recovery.** Acceptance: A late render cannot trump newer intent; audio preview preserves proper owner.
9. **S31-0083-09 — Review export scope, prerequisites and exact snapshot identity.** Acceptance: Before confirm, user knows selected mix/revision and why export may be unavailable.
10. **S31-0083-10 — Review persistent export stages, errors, retries and download recovery.** Acceptance: Closing panel or modifying mix does not lose job; final output corresponds to captured revision.
11. **S31-0083-11 — Test cross-mix concurrent edits, requests and Undo.** Acceptance: Mutation/Undo only affects intended current/draft revision despite stale responses.
12. **S31-0083-12 — Verify actual FLAC decoding and authored track order.** Acceptance: Downloaded file format, duration, transition identity and source scope match intended snapshot.

## Required adverse cases and evidence

- Wrong-mix writes, stale Undo and invalid FLAC are P0 blockers.
- Do not hide unavailable actions without explaining prerequisites.
- Export cannot silently switch to a revised track order mid-job.

For each applicable task, capture a fixture/viewport/theme and observable pass/fail, plus keyboard/AT, real audio, performance, security, persistence or backend-contract evidence when relevant. A visual-only improvement cannot weaken prior behaviour. Record untested cases as pending and explicitly justify N/A. Reuse [the 3.1 verification matrix](selecta-3-1-verification-matrix.md) and [the evidence ledger](selecta-3-1-evidence.md).

## Alternatives and trade-offs

More deliberate confirmation and scope language can add one interaction to risky operations but should not burden reversible low-risk edits.

## Decision and implementation boundary

The decision remains **Proposed** pending owner approval. Every S31 task remains **Not started**. A later implementation PR must name the task ID, acceptance, real implementation commit, negative cases, linked old S3 task/parity row and evidence. **Implemented** requires merged code and required automated checks; **Verified** additionally requires the human evidence relevant to that task. This documentation-only PR neither modifies runtime nor records implementation success.

## Status history

| Date | Decision | Implementation | Evidence |
|---|---|---|---|
| 2026-11-07 | Proposed | Not started | Documentation-only finishing plan; no tests or human review executed for this programme |

## Related documents

- [Selecta 3.1 roadmap](selecta-3-1-roadmap.md)
- [3.1 implementation checklist](selecta-3-1-implementation-checklist.md)
- [3.1 verification matrix](selecta-3-1-verification-matrix.md)
- [3.1 evidence ledger](selecta-3-1-evidence.md)
- [3.0 roadmap and invariant contract](selecta-3-roadmap.md)
- [3.0 implementation status](selecta-3-evidence.md)
- [Research and confidence boundary](../research/selecta-3-1-polish.md)
