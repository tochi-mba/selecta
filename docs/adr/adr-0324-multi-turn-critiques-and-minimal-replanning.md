# ADR-0324 - Conversational critiques, exact locks and minimal-change proposal repair

- **Decision:** Accepted (owner approval recorded 2026-11-08; docs only, implementation pending).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Lucy agentic Make a Mix (LU); 2026-11-08; main `1b53debedc3d6ef3c8d0cf6302b561b0003e8d78`.
- **Priority / phase:** P0 / Revision. **Owner:** Unassigned. **Implementing PR/SHA:** -.
- **Related existing ADRs:** ADR-0100, ADR-0143, ADR-0219, ADR-0237, ADR-0260; statuses and scope unchanged.
- **Source touchpoints:** `src/selecta/planner/beam.py`; `src/selecta/mix.py`; `web/src/views/Mix.tsx`.

## Context and source evidence boundary

'Keep the opener, replace tracks 5–7, raise the middle energy, don't touch the ending' contains distinct exact constraints; full regenerate discards deliberate choices and often ignores user notes. Existing code is not credited as implementing new Lucy acceptance; revalidate at source SHA before work starts. This ADR defines a new feature proposal only.

## Proposed decision

Implement structured critique parsing against an exact base proposal revision and selection occurrence. Plan the smallest viable changed segment, re-evaluate affected inbound/outbound seams and preserve all unrelated hard rules. Allow repeated multi-turn revisions without hidden preference resets.

## UI/UX, interaction and truth contract

User notes stream as ordinary chat; attached current proposal updates only after validated revision persists. Locked occurrences and fixed slots are visible and can be unlocked intentionally.

**Negative cases:** 'this one' with stale selection, song appears twice, changes to current locked song, contradictory latest instructions, changed destination, renderer failure, more energetic but impossible duration.

## Alternatives and safeguards

Prefer existing Selecta authoritative models, route/worker APIs and host-controlled permissions over duplicate agent-side audio/mix state. Reject model prose as proof of a write, transition render or real music quality. No SaaS/accounts/remote music/cloud sync/telemetry scope is implied by this ADR; remote model usage requires informed consent.

## Implementation checklist - 0/8 Implemented; 0/8 independently Verified

1. **LU-324-01 - Parse critiques against revision.** **Acceptance:** Turn includes expected proposal/revision/selected occurrence and requested changes. **Required verification:** Stale-ref and ambiguity fixtures. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
2. **LU-324-02 - Distinguish kinds of locks.** **Acceptance:** Occurrence retention, exact position, relative order and segment boundary independent. **Required verification:** Duplicate/relocation lock tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
3. **LU-324-03 - Apply minimal change.** **Acceptance:** Untargeted songs retained when feasible; no wholesale replan disguised as small edit. **Required verification:** Diff-minimisation property test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
4. **LU-324-04 - Re-evaluate affected seams.** **Acceptance:** Replacing/moving a song checks both inbound and outbound and global cue continuity. **Required verification:** Transition context regression. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
5. **LU-324-05 - Preserve prior compatible notes.** **Acceptance:** Latest instruction supersedes only matching constraint, not unrelated anchors. **Required verification:** Six-turn adversarial conversation eval. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
6. **LU-324-06 - Surface conflict and trade-off.** **Acceptance:** Impossible notes show exact conflicting rules and safe user choices. **Required verification:** Infeasible solver fixtures. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
7. **LU-324-07 - Keep proposal write atomic.** **Acceptance:** No partial revision made visible if validation or persistence fails. **Required verification:** Injected failure/parallel tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
8. **LU-324-08 - Verify human edit fidelity.** **Acceptance:** Test users can critique 3 times and recognize each applied change. **Required verification:** Uncoached revision task and diff comprehension. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.

## Existing product preservation

No original music edits, autoplay or audio-focus theft; preserve current/draft separation, exact occurrence/seam/revision and Undo, consented request bridges, Studio 8 lanes/8–64 cells, honest readiness, LRCLIB disclosure, blind audio-study neutrality and frozen FLAC revision identity. Negative tests include stale/offline/failed/duplicate/multi-tab/320px/high zoom/forced-colours/Still/RTL and real audio as appropriate.

## Decision and proof governance

Decision Accepted; all tasks Not started and unverified. A later accepted decision must record owner/date; code-level implementation requires concrete PR/SHA and passing relevant tests, and independent verification requires named reviewer/date/device/real audio. [Roadmap](selecta-lucy-roadmap.md) · [checklist](selecta-lucy-implementation-checklist.md) · [evidence](selecta-lucy-implementation-evidence.md) · [verification](selecta-lucy-verification-matrix.md) · [gates](selecta-lucy-release-gates.md).
