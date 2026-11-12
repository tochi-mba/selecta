# ADR-0118 - Recommendations: clear music-first cards and authentic previews

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** Implemented (2026-11-12: EX-0118-01 to -05 Implemented, -05 as its code part only, the study tool; evidence in the checklist). **Verified (automated):** EX-0118-02, -03 and -04 by 2026-11-11; -01 and -05 need a person.
- **Independent verification:** No (0/5).
- **Programme/date:** Experience-first UI/UX; 2026-11-07; baseline `main` `6638ec2313ce53843adfaf363306f8e79c4c8c7e` (merged PR #29).
- **Priority / phase:** P1 / Make a Mix.
- **Related:** ADR-0097, ADR-0104; no automatic supersession or inherited task completion.
- **Code touchpoints:** `web/src/views/Mixes.tsx`, `web/src/views/Links.tsx`, `web/src/views/MixSetup.tsx`.

## Context and evidence boundary

Existing cards can give Play, Edit first and Save draft similar visual weight. Showing many music ideas with detailed status and metadata may weaken the first choice; this is a design hypothesis, not a measured failure. Source inspection is not proof of a rendered UI problem, human task failure or real-audio quality. Existing functionality does not count as implementation of this newly proposed behavior.

## Proposed decision

- Establish one dominant card action supported by precise readiness, mood description and real artist examples.
- Preserve Edit first and Save as draft through visible, accessible secondary actions-not hover-only.
- Show a curated first selection while all existing categories and unavailable explanations remain reachable.
- Prototype short audio previews only when actual fitting, rendered audio exists and single-owner playback can be proven; otherwise do not show preview.
- Never fabricate album artwork, duration, confidence, musical links or perceived mix quality.

## Alternatives considered and rationale

Making all three actions equal simplifies implementation but adds scanning cost. Large decorative album art may be inauthentic. Choose concise music-specific information architecture and validate with users.

## Consequences, risks and preservation

No preview API/audio generator is approved by this proposal. Feasibility and consent to render must be decided separately. Preserve original audio, routes, preferences, local security, current/draft/revision identity, scoped Undo, consented atomic bridges, full Stem Studio controls, blind study and decodable frozen-revision FLAC. No backend/audio/schema changes are implicitly approved.

## Implementation tasks (status per task below, 2026-11-11)

1. **EX-0118-01 - Create feature and category card variants.** Acceptance: Main action and musical identity clear in both themes. Verification: Responsive screenshots plus comprehension test. **Implementation: Implemented (2026-11-10); Verified: No. Needs a person: comprehension test and named visual review.**
2. **EX-0118-02 - Check secondary action parity.** Acceptance: Play/Edit/Save accessible to keyboard and touch. Verification: Backend result and E2E mapping. **Implementation: Implemented (2026-11-10); Verified: Yes (automated, 2026-11-11).**
3. **EX-0118-03 - Handle partial/unknown metadata.** Acceptance: Cards truthful on missing artists, no-ready suggestions and timing. Verification: Fixture and error-state review. **Implementation: Implemented (2026-11-10); Verified: Yes (automated, 2026-11-10).**
4. **EX-0118-04 - Document preview feasibility gate.** Acceptance: Source audio and revision exact, or preview rejected. Verification: Code inspection and audio focus proof. **Implementation: Implemented (2026-11-10, gate rejects card previews; see below); Verified: Yes (automated, 2026-11-10).**
5. **EX-0118-05 - Measure choice confidence.** Acceptance: Better task outcome than baseline, not just prettier layout. Verification: Counterbalanced uncoached selection study. **Implementation: Implemented (2026-11-12; code part); Verified: No. Evidence: counterbalanced orders and raw-count scoring against the baseline in `src/selecta/audit/ex_study.py` (`tests/test_ex_study.py` 13/13 passed 2026-11-12). Needs a person: run the counterbalanced uncoached selection study against the baseline cards with real participants, record the sessions and score them with `python -m selecta.audit.ex_study score`, at one exact SHA**

## Preview feasibility gate (EX-0118-04, decided 2026-11-10)

A recommendation card is a planning preference: no mix, render or revision exists until the listener chooses Play, Shape first or Save draft. There is therefore no exact source audio and revision to preview, so card audio previews are **rejected**. Cards say "planning preferences, not previews" and carry no audio control (`web/src/views/ex-0118-metadata.test.tsx`). Revisit only if a rendered, revision-pinned preview exists and plays through the single audio owner in `web/src/audio/focus.ts`.

## Required negative cases and references

Check empty/loading/partial/failed/stale/recovering states, long/RTL/duplicate names, dark/light/system themes, 320–2560px widths, 200/400% zoom, touch, keyboard, reduced motion and real audio where relevant. Preserve tests rather than weakening expectations. [NN/g disclosure](https://www.nngroup.com/articles/progressive-disclosure/) · [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/) · [Microsoft human-AI guidance](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/) are pattern references, not evidence of Selecta outcomes. Status: [new checklist](selecta-experience-implementation-checklist.md), [ledger](selecta-experience-evidence.md), [historical reconciliation](selecta-experience-status-reconciliation.md).
