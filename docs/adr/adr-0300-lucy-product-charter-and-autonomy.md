# ADR-0300 — Lucy product charter, boundaries and graduated autonomy

- **Decision:** Accepted (owner approval recorded 2026-11-08; docs only, implementation pending).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Lucy agentic Make a Mix (LU); 2026-11-08; main `1b53debedc3d6ef3c8d0cf6302b561b0003e8d78`.
- **Priority / phase:** P0 / Foundations. **Owner:** Unassigned. **Implementing PR/SHA:** —.
- **Existing ADR owners:** ADR-0117, ADR-0216, ADR-0219, ADR-0237, ADR-0238; their decisions and statuses remain unchanged.
- **Source touchpoints:** `web/src/views/Mixes.tsx`; `src/selecta/routes/mixes.py`; `web/src/shell/manifest.ts`.

## Context and evidence boundary

Make a Mix already provides one-tap recommendations, optional shaping and save-as-draft. Lucy is an optional agentic creation route, not a replacement for existing Play, Edit, Library or the local audio engine. This is an accepted **new Lucy feature contract** (not yet implemented), not evidence that Lucy exists, that the current UI is defective, or that any new task is implemented. Source observations require revalidation at the implementation SHA.

## Proposed decision

Establish Describe → Investigate → Propose → Critique → Revise → Approve → Build → Listen as Lucy's nonmandatory journey. Separate conversational reasoning from actual user consent; allow autonomous read/planning/repair only inside bounded capabilities. User-initiated playback and exact approval remain outside the model's authority.

## Interaction, provenance and data contract

A first-user can choose Quick Play without chatting or choose Lucy without learning music terminology. Every proposal says Not built; subsequent states truthfully distinguish saved draft, rendering and playing.

**Failure and negative scope:** A normal question must not create a mix; ambiguous 'make one' does not replace active playback; provider failure never disables conventional Make a Mix.

## Alternatives and trade-offs

Prefer integrating the existing Selecta source-of-truth over duplicating music state or adding a detached chatbot. Reject fabricated analysis, unsupported audio effects, model-authorised playback, and generic animation that does not explain real work. Any remote AI provider requires a separate explicit privacy/consent decision.

## Implementation checklist — 0/8 Implemented; 0/8 independently Verified

1. **LU-300-01 — Freeze scope and invariants.** **Acceptance:** Lucy augments existing paths, with no mandatory AI gate or loss of one-tap Play. **Required verification:** Uncoached Quick Play versus Lucy tasks; regression routes. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
2. **LU-300-02 — Model lifecycle.** **Acceptance:** Document explicit intent, proposal, critique, approval, commit and playback state transitions. **Required verification:** Model-based exhaustive transition test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
3. **LU-300-03 — Define autonomy levels.** **Acceptance:** Read/planning may self-iterate; expensive compute and writes need specified host permissions. **Required verification:** Adversarial permission and capability fixtures. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
4. **LU-300-04 — Guard existing playback.** **Acceptance:** No tool-induced play, pause or replacement before direct user act and required confirmation. **Required verification:** Real-player audio-focus E2E. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
5. **LU-300-05 — Define conversation questions.** **Acceptance:** Read-only explanation never generates a new revision or triggers a build. **Required verification:** Conversation intent contract tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
6. **LU-300-06 — Specify default outcome.** **Acceptance:** Approved Build draft creates new independent draft; Build & play is separate explicit action. **Required verification:** Playing/paused/idle E2E with independent scope. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
7. **LU-300-07 — Specify honest language.** **Acceptance:** Idea/proposal/approved/draft/rendering/ready/playing are visually and semantically distinct. **Required verification:** Microcopy comprehension and ARIA review. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
8. **LU-300-08 — Approve charter with human evidence.** **Acceptance:** Owner accepts journey and autonomy limits against existing Make a Mix. **Required verification:** Named owner decision, novice/expert study and dated evidence. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.

## Non-negotiable regression and release boundaries

Original local music unchanged; one player/audio-focus owner and intentional Pause; exact current/draft/revision/occurrence/seam identity and scoped Undo; explicitly consented atomic request bridges; all eight Studio lanes and 8–64 cells; truthful library readiness and LRCLIB metadata disclosure; neutral listening studies; frozen-revision decodable FLAC. Run relevant offline, stale, partial, cancelled, parallel, multi-tab, long/RTL/CJK, both themes, Still/reduced motion, 320px/400% zoom, keyboard, touch and real-audio tests. A model-generated explanation cannot substitute for actual source evidence.

## Status governance and cross-links

Decision **Accepted** (owner direction recorded 2026-11-08); future revision/supersession requires a dated decision. Implementation only advances with a source/test PR and specific acceptance proof; independent verification requires different named evidence and reviewer. No legacy task gets reclassified by this docs PR. [Lucy roadmap](selecta-lucy-roadmap.md) · [320-task checklist](selecta-lucy-implementation-checklist.md) · [evidence](selecta-lucy-implementation-evidence.md) · [verification](selecta-lucy-verification-matrix.md) · [release gates](selecta-lucy-release-gates.md).
