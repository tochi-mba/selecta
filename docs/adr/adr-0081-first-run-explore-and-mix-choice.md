# ADR-0081: Reduce friction from first music folder to a confident first mix

- **Decision status:** Proposed (owner review required)
- **Implementation status:** Not started
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.1 verification-led UI/UX finishing (documentation only)
- **Phase:** 2 — listener journeys
- **Extends:** ADR-0053, ADR-0054, ADR-0064, ADR-0072. No inherited task is automatically complete.
- **Dependencies:** ADRs 0078–0080 foundations.
- **Checklist:** S31-0081-01 through S31-0081-10 in [the 3.1 checklist](selecta-3-1-implementation-checklist.md).

## Context and verified source boundary

Relevant current repository surfaces: `web/src/views/{Start,Setup,Mixes,MixSetup}.tsx`, `web/src/state/readiness.ts`, `web/src/views/WorkshopPanels.tsx`, `src/selecta/routes/library.py` (read-only contract review). Source inspection and the existing 3.0 documentation establish the available controls and contracts; they do **not** establish rendered quality, human usability, screen-reader conformance or subjective audio quality. The source baseline is the 3.0 merge `3b01dc1336aab0f1cb0a4d85be5eba359de81831`. All new work is proposed.

## Proposed decision

Make first-run and Explore explain readiness and next actions in ordinary language. Separate source read, scan, analysis, lyrics and mix readiness. Make Play primary and edit/save alternatives explicit without hiding expert customization.

## Non-negotiable preservation

Preserve [Selecta 3.0 invariants INV-01–INV-20](selecta-3-roadmap.md): music and metadata safety; local-first Host/Origin boundaries and accurate LRCLIB disclosure; all routes and old aliases; stable current/draft identity and guarded writes; persisted drafts, corrections and preferences; single-owner playback and previews; explicit atomic bridge consent; truthful seam/readiness; authentic revision-pinned FLAC; keyboard/AT alternatives; and complete behavioural regression assertions. This ADR does not authorize changing the audio engine, backend, schema or runtime code.

## Tasks, observable acceptance and traceable ID

1. **S31-0081-01 — Review new-user entry and folder path guidance.** Acceptance: User knows where to find a path, what stays local, what metadata can leave, and why a path can be rejected.
2. **S31-0081-02 — Design distinct source-check, scan, analysis and mix-ready states.** Acceptance: Every stage has accurate progress or uncertainty, separate failures, and useful next action.
3. **S31-0081-03 — Test invalid, absent, empty, permission-denied and unplugged folder outcomes.** Acceptance: Error does not imply music was lost; recovery is possible without a full restart.
4. **S31-0081-04 — Establish a first-play call to action as soon as genuinely possible.** Acceptance: User can start a valid mix without waiting for unrelated full-library processing.
5. **S31-0081-05 — Review featured mix hierarchy and mood card choice.** Acceptance: Recommendation, artist context and outcomes are understandable without DJ terminology or excessive competing actions.
6. **S31-0081-06 — Clarify Play, Edit first, Save as draft and replacing the current mix.** Acceptance: Each action explains whether current audio changes and how to avoid replacing it.
7. **S31-0081-07 — Review mix length, feel, stems, energy and destination customization.** Acceptance: Frequent options are simple; advanced options are discoverable and persisted truthfully.
8. **S31-0081-08 — Review unavailable preset reasons and recovery paths.** Acceptance: Each unavailable card states the specific prerequisite and relevant analysis progress.
9. **S31-0081-09 — Test long/unicode/missing metadata and small/zoomed devices.** Acceptance: Choices remain understandable and actionable without horizontal overflow or off-screen controls.
10. **S31-0081-10 — Measure unassisted time-to-first-valid-play in representative tasks.** Acceptance: Record actual success, critical errors, hesitation and any misleading disclosure.

## Required adverse cases and evidence

- Do not promise the browser folder picker gives a server-readable native path.
- LRCLIB sends artist/title/album/duration; local-first messaging must disclose this accurately.
- Never label a not-ready song or preset playable.

For each applicable task, capture a fixture/viewport/theme and observable pass/fail, plus keyboard/AT, real audio, performance, security, persistence or backend-contract evidence when relevant. A visual-only improvement cannot weaken prior behaviour. Record untested cases as pending and explicitly justify N/A. Reuse [the 3.1 verification matrix](selecta-3-1-verification-matrix.md) and [the evidence ledger](selecta-3-1-evidence.md).

## Alternatives and trade-offs

A guided default path is simpler, but complete progress details and customized mix parameters must remain discoverable.

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
