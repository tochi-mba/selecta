# ADR-0259 - Explore choice comparison and truthful mix expectations

- **Decision:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation:** In progress (7/8 Implemented, 0/8 In progress, 1/8 Not started).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta gap-focused UI/UX polish; 2026-11-08; main `2956bc47fd735339e7216e03d27817fb3a31e92b`.
- **Priority / phase:** P1 / Gap-focused polish.
- **Owner:** Unassigned.
- **Related accepted ADRs:** ADR-0216, ADR-0217, ADR-0222; those implementation statuses remain unchanged.
- **Existing source touchpoints:** `web/src/views/Mixes.tsx`; `web/src/views/MixSetup.tsx`.

## Context and evidence boundary

Explore mix-feeling cards and shaping options already exist, but it remains unclear how accurately listeners anticipate a generated mix from the presented choice.

This is an added acceptance decision, not a claim that related source capabilities are absent. The supplied screenshots and source code are *hypothesis evidence*, not an independently verified usability, audio or accessibility audit.

## Novel delta versus previous ADRs

Use only supported planner attributes for side-by-side comparison, differentiate preference from guarantee and report meaningful generated deviations. Protect current playback during exploration.

The accepted predecessor ADRs remain authoritative for existing functionality. Reconcile each new acceptance condition with the current source before implementing; owner may reject or supersede genuinely redundant tasks.

## Proposed decision

Adopt the new targeted acceptance contract above only after explicit owner review. Prefer refining current source over recreating working features; scope, error/unknown states, progress and interaction semantics must remain correct.

## Visual, motion, safety and interaction contract

Primary music identity and real transport remain legible. Make source truth distinguish planned/requested/preparing/rendered/heard/unknown; never animate nonexistent musical information. Preserve keyboard/touch/assistive-tech equivalence, focus restoration, Still/reduced-motion behavior, responsive layout and explicit scope when taking actions.

**Non-negotiable preservation:** Original local music remains unchanged; one audio owner and intentional Pause; accurate song occurrence/seam identity, current/draft revision and scoped Undo; explicitly consented atomic request bridges; eight Studio lanes and 8–64 cells; truthful Library readiness and LRCLIB metadata disclosure; neutral listening studies; correct frozen-revision decodable FLAC. No SaaS, accounts, telemetry, cloud music, native folder picker or launcher is authorized.

## Implementation checklist - 7/8 Implemented, 0/8 independently Verified

1. **GP-0259-01 - Audit every mix card promise against planner behavior.** **Acceptance:** Audit every mix card promise against planner behavior is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** seeded planner fixtures and uncoached expectation study; relevant negative-case and exact-SHA source tests. **Implementation:** Implemented; **Verified:** No; **Owner:** Checklist agent (2026-11-10); **Implementing PR/SHA:** 22ea910 (wip, feat/finish-checklists); **Evidence:** src/selecta/planner/vibes.py; tests/test_gp0259_explore_expectations.py test_gp0259_01_every_card_promise_holds_in_a_seeded_build, test_gp0259_01_moves_line_follows_the_listeners_saved_transition_feel and test_gp0259_01_the_vibes_route_describes_the_saved_transition_feel (pytest passed 2026-11-10).
2. **GP-0259-02 - Choose brief comparable supported music attributes.** **Acceptance:** Choose brief comparable supported music attributes is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** seeded planner fixtures and uncoached expectation study; relevant negative-case and exact-SHA source tests. **Implementation:** Implemented; **Verified:** No; **Owner:** Checklist agent (2026-11-10); **Implementing PR/SHA:** 22ea910 and e9e333c (wip, feat/finish-checklists); **Evidence:** tests/test_gp0259_explore_expectations.py test_gp0259_02_cards_share_the_same_comparable_fields (pytest) and web/src/views/gp-0259-expectations.test.tsx 'GP-0259-02 every available card shows the same brief comparable facts' (vitest), passed 2026-11-10.
3. **GP-0259-03 - Explain sparse-library eligibility and alternatives.** **Acceptance:** Explain sparse-library eligibility and alternatives is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** seeded planner fixtures and uncoached expectation study; relevant negative-case and exact-SHA source tests. **Implementation:** Implemented; **Verified:** No; **Owner:** Checklist agent (2026-11-10); **Implementing PR/SHA:** 22ea910 and e9e333c (wip, feat/finish-checklists); **Evidence:** tests/test_gp0259_explore_expectations.py test_gp0259_03_a_six_song_one_genre_library_says_what_is_eligible_and_what_is_not and test_gp0259_03_an_unavailable_idea_is_refused_by_the_build_route (pytest) and web/src/views/gp-0259-expectations.test.tsx 'GP-0259-03 a sparse library says which ideas are unavailable, why, and what to do instead' (vitest), passed 2026-11-10.
4. **GP-0259-04 - Differentiate Play, Shape and Save consequences.** **Acceptance:** Differentiate Play, Shape and Save consequences is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** seeded planner fixtures and uncoached expectation study; relevant negative-case and exact-SHA source tests. **Implementation:** Implemented; **Verified:** No; **Owner:** Checklist agent (2026-11-10); **Implementing PR/SHA:** e9e333c (wip, feat/finish-checklists); **Evidence:** web/src/views/gp-0259-expectations.test.tsx 'GP-0259-04 Play, Shape first and Save draft each say their own consequence' (vitest, passed 2026-11-10).
5. **GP-0259-05 - Show actual generated result versus initial intention.** **Acceptance:** Show actual generated result versus initial intention is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** seeded planner fixtures and uncoached expectation study; relevant negative-case and exact-SHA source tests. **Implementation:** Implemented; **Verified:** No; **Owner:** Checklist agent (2026-11-10); **Implementing PR/SHA:** e9e333c (wip, feat/finish-checklists); **Evidence:** web/src/views/gp-0259-expectations.test.tsx 'GP-0259-05 says what was actually generated next to what was asked for' (vitest, passed 2026-11-10).
6. **GP-0259-06 - Make trying another option reversible without playback loss.** **Acceptance:** Make trying another option reversible without playback loss is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** seeded planner fixtures and uncoached expectation study; relevant negative-case and exact-SHA source tests. **Implementation:** Implemented; **Verified:** No; **Owner:** Checklist agent (2026-11-10); **Implementing PR/SHA:** e9e333c (wip, feat/finish-checklists); **Evidence:** web/src/views/gp-0259-expectations.test.tsx 'GP-0259-06 trying another idea keeps what is playing: Cancel builds nothing, Save draft never touches playback' (vitest, passed 2026-11-10).
7. **GP-0259-07 - Avoid unsupported claims about genre or mood evidence.** **Acceptance:** Avoid unsupported claims about genre or mood evidence is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** seeded planner fixtures and uncoached expectation study; relevant negative-case and exact-SHA source tests. **Implementation:** Implemented; **Verified:** No; **Owner:** Checklist agent (2026-11-10); **Implementing PR/SHA:** 22ea910 and e9e333c (wip, feat/finish-checklists); **Evidence:** src/selecta/planner/vibes.py card basis; tests/test_gp0259_explore_expectations.py test_gp0259_07_cards_name_only_the_evidence_their_songs_were_measured_for and test_gp0259_07_card_basis_is_in_the_payload (3 cases, pytest) and web/src/views/gp-0259-expectations.test.tsx 'GP-0259-07 names only the measured evidence a card was chosen by, and says nothing when the server does not' (vitest), passed 2026-11-10.
8. **GP-0259-08 - Measure predicted versus actual listener satisfaction.** **Acceptance:** Measure predicted versus actual listener satisfaction is demonstrably satisfied for all relevant current states without loss of existing capabilities. **Required verification:** seeded planner fixtures and uncoached expectation study; relevant negative-case and exact-SHA source tests. **Implementation:** Not started; **Verified:** No; **Owner:** Checklist agent (2026-11-10); **Implementing PR/SHA:** -; **Evidence:** Needs a person: predicted versus actual listener satisfaction study.

## Negative cases and required evidence

**Area-specific:** six-ready library, one genre, sparse metadata, unavailable songs, failed build

**Common matrix:** Offline/stale/failed/cancel, multitab, duplicate titles, long/RTL/Unicode metadata, 320–2560px widths, short landscape, 400% zoom, dark/light/forced colors, keyboard/touch/NVDA, reduced motion and real audio where applicable.

Required verification is *independent* of code completion: named reviewer, date, exact source SHA, device/OS/browser, representative songs when audio-related, task outcome denominators, accessibility observations and failure/rollback evidence. CI screenshots are candidates, not owner-approved goldens; muted synthetic browser tests do not certify real audible behavior.

## Dependencies, provenance and status

- **Depends on:** ADR-0216, ADR-0217, ADR-0222, ADR-0199 (status reconciliation), ADR-0237 (source truth), ADR-0239/0240 (tests and research), ADR-0247 (GO/NO-GO).
- **Sequence:** decision review → design specimens → narrow implementing PR with tests → independent audio/AT/human review → evidence and release verdict.
- **Now:** Accepted; 7/8 Implemented, 0/8 In progress, 1/8 Not started (2026-11-10); 0 Verified; implementation in the feat/finish-checklists working tree and wip commits, cited per task. Historical T/P/S3/S31/S4/EX/MI/CI/SF statuses unchanged.
- [Roadmap](selecta-gap-polish-roadmap.md) · [Checklist](selecta-gap-polish-implementation-checklist.md) · [Evidence](selecta-gap-polish-implementation-evidence.md) · [Parity](selecta-gap-polish-overlap-and-parity.md) · [Verification](selecta-gap-polish-verification-matrix.md) · [Gates](selecta-gap-polish-release-gates.md).
