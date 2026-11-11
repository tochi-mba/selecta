# ADR-0117 - Three-stage mix creation: choose, shape and commit

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** Implemented (5/5 on 2026-11-10; EX-0117-02 adds the `mixes.shaping.remember_length` flag; evidence in the checklist). **Verified (automated):** EX-0117-02 to -05 by 2026-11-11; EX-0117-01 needs a person.
- **Independent verification:** No (0/5).
- **Programme/date:** Experience-first UI/UX; 2026-11-07; baseline `main` `6638ec2313ce53843adfaf363306f8e79c4c8c7e` (merged PR #29).
- **Priority / phase:** P0 / Make a Mix.
- **Related:** ADR-0096, ADR-0097, ADR-0054; no automatic supersession or inherited task completion.
- **Code touchpoints:** `web/src/views/Mixes.tsx`, `web/src/views/MixSetup.tsx`, `web/src/views/Start.tsx`.

## Context and evidence boundary

Mixes supplies a featured mix and categorized ideas. The current customization dialog combines feel, stem assistance, destination and five-stop energy; users need an obvious creative path without being forced through settings. Source inspection is not proof of a rendered UI problem, human task failure or real-audio quality. Existing functionality does not count as implementation of this newly proposed behavior.

## Proposed decision

- Create a progressive Choose (musical idea) / Shape (optional journey) / Commit (Play, Edit first or Save draft) interaction.
- Retain a genuine one-press Play path for ready mix suggestions; the stages are conceptual, not a compulsory wizard.
- Offer legible energy presets with exact reversible editing of the existing five stored stops and a keyboard alternative.
- Put feel, stem frequency, length and destination in predictable disclosure; visibly separate next-generation settings from the currently playing mix.
- Protect existing current-mix replacement confirmation and preserve untouched playback when the user cancels.

## Alternatives considered and rationale

A giant all-options form supports experts but slows first value. A strict wizard blocks one-tap Play. Progressive shaping gives both paths without changing the engine.

## Consequences, risks and preservation

Visual shapes are intent, not proof of the finished track curve or a guaranteed destination. No new DSP or backend promise is authorized. Preserve original audio, routes, preferences, local security, current/draft/revision identity, scoped Undo, consented atomic bridges, full Stem Studio controls, blind study and decodable frozen-revision FLAC. No backend/audio/schema changes are implicitly approved.

## Implementation tasks (status per task below, 2026-11-11)

1. **EX-0117-01 - Prototype fast Play vs optional shape.** Acceptance: First valid mix can start without configuration. Verification: First-user uncoached completion test. **Implementation: Implemented (2026-11-10); Verified: No. Needs a person: uncoached first-user completion test.**
2. **EX-0117-02 - Map all existing configuration.** Acceptance: Duration, feel, stems, energy and destination remain persistent. Verification: State/data contract parity and edit tests. **Implementation: Implemented (2026-11-10); Verified: Yes (automated, 2026-11-10).**
3. **EX-0117-03 - Specify accurate curve display.** Acceptance: Five values/presets equal server intent and stay keyboard editable. Verification: Rapid change/stale save tests. **Implementation: Implemented (2026-11-10); Verified: Yes (automated, 2026-11-10).**
4. **EX-0117-04 - Unify Play/Edit/Save consequences.** Acceptance: Users know whether music is replaced or a draft created. Verification: Playing/paused/idle E2E. **Implementation: Implemented (2026-11-10); Verified: Yes (automated, 2026-11-11).**
5. **EX-0117-05 - Harden pending/failed generation.** Acceptance: Double submits and late requests cannot mutate wrong scope. Verification: Async race and failure injection. **Implementation: Implemented (2026-11-10); Verified: Yes (automated, 2026-11-10).**

## Required negative cases and references

Check empty/loading/partial/failed/stale/recovering states, long/RTL/duplicate names, dark/light/system themes, 320–2560px widths, 200/400% zoom, touch, keyboard, reduced motion and real audio where relevant. Preserve tests rather than weakening expectations. [NN/g disclosure](https://www.nngroup.com/articles/progressive-disclosure/) · [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/) · [Microsoft human-AI guidance](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/) are pattern references, not evidence of Selecta outcomes. Status: [new checklist](selecta-experience-implementation-checklist.md), [ledger](selecta-experience-evidence.md), [historical reconciliation](selecta-experience-status-reconciliation.md).
