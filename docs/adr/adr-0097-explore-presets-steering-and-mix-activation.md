# ADR-0097: Explore discovery, energy and cue customization, and safe current-mix activation

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** Not started (0/10 implemented)
- **Verification status:** Not verified (0/10)
- **Documentation status:** Drafted, documentation-only Selecta 4.0 proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 4.0 complete UI/UX overhaul
- **Phase:** 3 Listener
- **Extends, does not automatically supersede:** ADR-0010, ADR-0011, ADR-0054, ADR-0081
- **Source surfaces to reconcile:** `web/src/views/Mixes.tsx`; `web/src/views/MixSetup.tsx`; `web/src/views/Library.tsx`
- **Tasks:** S4-0097-01 through S4-0097-10 in [the Selecta 4.0 checklist](selecta-4-implementation-checklist.md)
- **Baseline:** `main` `9b663f9f10212619f27ce67ce82f602347065cbd` (after merged PRs #25 and #26)

## Context and evidence boundary

Explore's featured pick, presets and advanced steering are valuable but can scatter equal-weight actions. Library Start a mix and Explore Play currently communicate/current-mix replacement differently.

This is a **proposal**. Source inspection and earlier planning documents establish current contracts and candidate risks; they do not establish verified visual quality, human task success, real audio quality, screen-reader usability or shipped implementation of this ADR. Earlier programme status headings can be stale and are not inherited as verified work.

## Proposed decision

Make one obvious featured mix, grouped discovery cards and advanced customization. Introduce one shared current-mix replacement policy for Explore, Library and draft activation while retaining the exact backend operations and settings.

## Experience, frontend and interaction specification

- Card hierarchy: idea, example artist/musical facts, duration/readiness, Play, accessible Edit first and Save as draft.
- Customization sections: Feel, Energy, Destination, Advanced mixing; preserve backend duration and transition fields.
- Five-point energy curve with keyboard/value controls and optional presets mapping to the same schema.
- Selected final track search must disambiguate identity and never guarantee an unreachable ending.

## Detailed implementation work — all Not started

1. **S4-0097-01 — Redesign featured suggestion and category card hierarchy.** Acceptance: Listener sees one clear Play; every other action remains discoverable. Required verification: Light/dark/mobile card screenshots and task completion. **Implementation: Not started; Verified: No.**
2. **S4-0097-02 — Provide Play/Edit first/Save draft action parity.** Acceptance: Same resulting backend behaviour from all card entry points. Required verification: Generated mix and draft comparison tests. **Implementation: Not started; Verified: No.**
3. **S4-0097-03 — Define shared current-mix replacement consequence policy.** Acceptance: Explore/Library/Drafts do not silently disrupt playback inconsistently. Required verification: Cross-entry current playing/paused/empty E2E. **Implementation: Not started; Verified: No.**
4. **S4-0097-04 — Group feel/duration/stem/energy/destination controls predictably.** Acceptance: Every old control and saved preference remains available. Required verification: Feature parity audit and preference persistence tests. **Implementation: Not started; Verified: No.**
5. **S4-0097-05 — Improve five-point energy graph, sliders and option presets.** Acceptance: Visual graph matches actual stored values with keyboard alternative. Required verification: Rapid edits, keyboard, out-of-range and stale saves. **Implementation: Not started; Verified: No.**
6. **S4-0097-06 — Harden destination song autocomplete and scope wording.** Acceptance: Duplicate title/artists identified; desired end not promised as guaranteed. Required verification: Search stale-order, unavailable destination tests. **Implementation: Not started; Verified: No.**
7. **S4-0097-07 — Clarify settings affect next generation versus current mix.** Acceptance: No accidental current audio changes from preference edit. Required verification: Listen-while-customizing E2E. **Implementation: Not started; Verified: No.**
8. **S4-0097-08 — Create unavailable recommendation and partial library states.** Acceptance: Specific blocker without misleading ready label. Required verification: No matches, empty, partial-analysis and server-error fixtures. **Implementation: Not started; Verified: No.**
9. **S4-0097-09 — Protect build submission and result reconciliation.** Acceptance: Double click/failure/latest build cannot erase current mix. Required verification: Idempotency and late-result tests. **Implementation: Not started; Verified: No.**
10. **S4-0097-10 — Measure time and confidence selecting first mix.** Acceptance: Observe task errors rather than infer from screenshots. Required verification: Listener/creator usability session. **Implementation: Not started; Verified: No.**

## Required negative cases and regression strategy

- Build fails after user navigates; avoid stale notification and preserve playing mix.
- Setting destination song becomes invalid during generation.
- Backend lacks save-before-replace capability; don't promise undo without proven contract.
- Exercise light, dark and system themes; empty, loading, partial, ready, stale, failed, offline and recovering states where applicable.
- Exercise 320/375/390/430/768/1024/1280/1440/1920 CSS-pixel widths, short viewports, 200/400% zoom, keyboard, touch, reduced motion, realistic long/missing/duplicate/Unicode/RTL metadata.
- Maintain existing frontend, API, audio and Python assertions; changed markup may require selector updates but never weakened behavioural contracts.

## Preservation and dependencies

Retain the [existing Selecta 3.0 invariants INV-01–INV-20](selecta-3-roadmap.md) and [3.1 preservation contract](selecta-3-1-roadmap.md): no original-file mutation; local-first security and LRCLIB disclosure; no loss of current/draft state, preferences, corrections or ratings; stable old routes; one audio owner; exact request consent and atomic join; truthful requested-versus-rendered state; revision-pinned decodable FLAC; full keyboard alternatives and regression assertions. No backend, schema, audio-engine or dependency rewrite is authorized by this ADR. See [4.0 parity matrix](selecta-4-feature-parity.md) and [verification matrix](selecta-4-verification-matrix.md).

## Alternatives, risks and trade-offs

A centralized replacement policy adds coordination work but removes high-impact cross-screen inconsistency.

## Evidence and advancement rules

An owner must separately **Accept** this decision before it becomes policy. Each implementing PR must name the S4-0097 task IDs, actual commit(s), changed files, pre-existing regression tests, new negative/concurrency cases, theme/viewport screenshots and relevant human/audible/AT evidence. **Implemented** requires merged code and applicable automated checks; **Verified** additionally requires independent real acceptance relevant to the change. An unchecked checkbox means not Verified. A docs merge does not advance these statuses.

## Status history

| Date | Decision | Implementation | Verification | Evidence |
|---|---|---|---|---|
| 2026-11-07 | Proposed | Not started | Not verified | Documentation-only specification; no runtime, test or UI changes |
| 2026-11-08 | Accepted | Not started | Not verified | Owner accepted all proposed ADRs ([#37](https://github.com/tochi-mba/selecta/pull/37)) |

## Related documents

- [Selecta 4.0 roadmap and ADR index](selecta-4-roadmap.md)
- [4.0 implementation checklist](selecta-4-implementation-checklist.md)
- [4.0 per-task evidence ledger](selecta-4-evidence.md)
- [4.0 verification and edge-case matrix](selecta-4-verification-matrix.md)
- [4.0 release readiness criteria](selecta-4-release-gates.md)
- [Earlier 3.1 implementation checklist](selecta-3-1-implementation-checklist.md)
