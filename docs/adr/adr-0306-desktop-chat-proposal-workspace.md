# ADR-0306 - Desktop conversation and persistent live proposal workspace

- **Decision:** Accepted (owner approval recorded 2026-11-08; docs only, implementation pending).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Lucy agentic Make a Mix (LU); 2026-11-08; main `1b53debedc3d6ef3c8d0cf6302b561b0003e8d78`.
- **Priority / phase:** P0 / Experience. **Owner:** Unassigned. **Implementing PR/SHA:** -.
- **Existing ADR owners:** ADR-0219, ADR-0220, ADR-0228, ADR-0233, ADR-0269; their decisions and statuses remain unchanged.
- **Source touchpoints:** `web/src/views/Mixes.tsx`; `web/src/views/Mix.tsx`; `web/src/styles/creation.css`.

## Context and evidence boundary

Streaming chat and the current proposed song order need simultaneous but distinct workspaces. The user should never scroll old conversation history to locate the current musical artifact. This is an accepted **new Lucy feature contract** (not yet implemented), not evidence that Lucy exists, that the current UI is defective, or that any new task is implemented. Source observations require revalidation at the implementation SHA.

## Proposed decision

At spacious widths offer split conversation/proposal panes with independent scroll, exact selection identity, visible revision scope and actionable song/transition details. At intermediate widths switch to one primary pane with an accessible proposal inspector; do not cram fixed split widths.

## Interaction, provenance and data contract

Chat conveys discussion; proposal displays title, actual songs, approximate duration, energy shape, constraints and exact approval status. New revisions update the proposal pane without stealing focus or scrolling an unrelated track into view.

**Failure and negative scope:** Empty proposal, long chat, long mix, expanded tool group, resizing, inspector present, sticky header/player, short landscape, duplicate titles, 200/400% zoom.

## Alternatives and trade-offs

Prefer integrating the existing Selecta source-of-truth over duplicating music state or adding a detached chatbot. Reject fabricated analysis, unsupported audio effects, model-authorised playback, and generic animation that does not explain real work. Any remote AI provider requires a separate explicit privacy/consent decision.

## Implementation checklist - 0/8 Implemented; 0/8 independently Verified

1. **LU-306-01 - Define adaptive pane contract.** **Acceptance:** Split only when measured content space supports full readable song and chat controls. **Required verification:** Width/height/zoom geometry matrix. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
2. **LU-306-02 - Design conversation column.** **Acceptance:** Stable transcript, streaming status and composer have clear hierarchy. **Required verification:** First-user reading/order study. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
3. **LU-306-03 - Design proposal column.** **Acceptance:** Current revision, exact song order, warnings, locks, duration and actions are visible. **Required verification:** Proposal comprehension E2E. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
4. **LU-306-04 - Preserve selection identity.** **Acceptance:** Selected occurrence/seam follows revisions or explicitly declares removal. **Required verification:** Duplicate and reorder interaction tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
5. **LU-306-05 - Preserve independent scrolling.** **Acceptance:** Neither stream updates nor revision changes force unrelated scroll/focus. **Required verification:** Long transcript automated scroll test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
6. **LU-306-06 - Avoid editor duplication.** **Acceptance:** Deep-link to Story/Arrange/Detail for precision editing on committed drafts. **Required verification:** Editor feature-parity and return tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
7. **LU-306-07 - Handle empty and failure states.** **Acceptance:** No proposal, stale proposal, planner failed or offline show useful recovery. **Required verification:** Empty/skeleton/error screenshots. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
8. **LU-306-08 - Review visual hierarchy.** **Acceptance:** Music object outranks AI chrome across themes and density preferences. **Required verification:** Paired themes, human critique and AT acceptance. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.

## Non-negotiable regression and release boundaries

Original local music unchanged; one player/audio-focus owner and intentional Pause; exact current/draft/revision/occurrence/seam identity and scoped Undo; explicitly consented atomic request bridges; all eight Studio lanes and 8–64 cells; truthful library readiness and LRCLIB metadata disclosure; neutral listening studies; frozen-revision decodable FLAC. Run relevant offline, stale, partial, cancelled, parallel, multi-tab, long/RTL/CJK, both themes, Still/reduced motion, 320px/400% zoom, keyboard, touch and real-audio tests. A model-generated explanation cannot substitute for actual source evidence.

## Status governance and cross-links

Decision **Accepted** (owner direction recorded 2026-11-08); future revision/supersession requires a dated decision. Implementation only advances with a source/test PR and specific acceptance proof; independent verification requires different named evidence and reviewer. No legacy task gets reclassified by this docs PR. [Lucy roadmap](selecta-lucy-roadmap.md) · [320-task checklist](selecta-lucy-implementation-checklist.md) · [evidence](selecta-lucy-implementation-evidence.md) · [verification](selecta-lucy-verification-matrix.md) · [release gates](selecta-lucy-release-gates.md).
