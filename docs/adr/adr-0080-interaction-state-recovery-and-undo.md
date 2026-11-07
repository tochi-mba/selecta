# ADR-0080: Make controls, asynchronous states, recovery and Undo dependable

- **Decision status:** Proposed (owner review required)
- **Implementation status:** Not started
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.1 verification-led UI/UX finishing (documentation only)
- **Phase:** 1 — cross-cutting interaction foundations
- **Extends:** ADR-0051, ADR-0052, ADR-0068, ADR-0070. No inherited task is automatically complete.
- **Dependencies:** ADR-0078 baseline; coordinate with ADR-0079 design primitives.
- **Checklist:** S31-0080-01 through S31-0080-10 in [the 3.1 checklist](selecta-3-1-implementation-checklist.md).

## Context and verified source boundary

Relevant current repository surfaces: `web/src/ui/{controls,primitives,toasts,ActivityPanel,Skeleton,CommandPalette}.tsx`, `web/src/state/{async,activity,shortcuts}.ts`, `web/src/App.tsx`. Source inspection and the existing 3.0 documentation establish the available controls and contracts; they do **not** establish rendered quality, human usability, screen-reader conformance or subjective audio quality. The source baseline is the 3.0 merge `3b01dc1336aab0f1cb0a4d85be5eba359de81831`. All new work is proposed.

## Proposed decision

Use one consistent interaction contract for busy actions, errors, announcements, queued work, stale data, optimistic reconciliation, Activity and scoped Undo. Preserve content and user intent through failures; never fake completion.

## Non-negotiable preservation

Preserve [Selecta 3.0 invariants INV-01–INV-20](selecta-3-roadmap.md): music and metadata safety; local-first Host/Origin boundaries and accurate LRCLIB disclosure; all routes and old aliases; stable current/draft identity and guarded writes; persisted drafts, corrections and preferences; single-owner playback and previews; explicit atomic bridge consent; truthful seam/readiness; authentic revision-pinned FLAC; keyboard/AT alternatives; and complete behavioural regression assertions. This ADR does not authorize changing the audio engine, backend, schema or runtime code.

## Tasks, observable acceptance and traceable ID

1. **S31-0080-01 — Define shared initial/empty/partial/refresh/error/offline/recovery presentation rules.** Acceptance: Each state includes visible facts, allowed actions, focus/announcement behaviour and next step.
2. **S31-0080-02 — Review skeleton geometry for every high-traffic content surface.** Acceptance: Placeholders match real content structure and do not cause large avoidable layout jumps.
3. **S31-0080-03 — Unify busy and duplicate-submit behaviour.** Acceptance: One action has immediate feedback, prevents duplicate mutations, and remains recoverable after timeout or failure.
4. **S31-0080-04 — Audit global toast, Activity and scoped Undo lifetimes.** Acceptance: Burst messages never make the only undo inaccessible; undo never targets a newer or different mix.
5. **S31-0080-05 — Review all dialog, drawer, sheet, menu and tooltip focus paths.** Acceptance: Escape, Tab, trigger-return, focus restore, outside click and stacked overlay behaviour match expected patterns.
6. **S31-0080-06 — Audit stale-response reconciliation and persistent data survival.** Acceptance: Late search, poll, request, render or edit response cannot overwrite the latest user action.
7. **S31-0080-07 — Make error text specific and actionable.** Acceptance: Every meaningful failure states what failed, what remains safe and how to retry or recover.
8. **S31-0080-08 — Review command palette and shortcut discoverability.** Acceptance: Disabled commands explain why; typed search, pointer selection, arrow keys and keyboard shortcut opt-out work.
9. **S31-0080-09 — Review accessible announcements for non-chattering progress.** Acceptance: Song/page/action outcome is announced once; clocks, polling and repeated progress do not flood live regions.
10. **S31-0080-10 — Test rapid user input while the server is slow or disconnected.** Acceptance: No silent lost clicks, fabricated success, duplicate request, or focus reset during reconnect.

## Required adverse cases and evidence

- A button can look busy without an actual backend operation; status must be truthful.
- Toast dismissal must not destroy the sole durable recovery path.
- Controls cannot become inaccessible due to custom menu/combobox implementations.

For each applicable task, capture a fixture/viewport/theme and observable pass/fail, plus keyboard/AT, real audio, performance, security, persistence or backend-contract evidence when relevant. A visual-only improvement cannot weaken prior behaviour. Record untested cases as pending and explicitly justify N/A. Reuse [the 3.1 verification matrix](selecta-3-1-verification-matrix.md) and [the evidence ledger](selecta-3-1-evidence.md).

## Alternatives and trade-offs

More explicit statuses use screen space but lower uncertainty, especially when requests, renders and analysis run for minutes.

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
