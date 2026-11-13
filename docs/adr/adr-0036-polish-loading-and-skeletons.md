# ADR-0036: Content-shaped skeletons and truthful asynchronous state transitions

- **Decision status:** Accepted (owner requested implementation in PR #23)
- **Implementation status:** Implemented: 12/12 tasks with evidence (P0039-P0041 on 2026-11-10, P0042 on 2026-11-11; P0033, P0035, P0037, P0038 and P0043 on 2026-11-12 after their Edge specs passed, with the Library placeholder rebuilt to match every layout mode; P0032, P0034 and P0036 on 2026-11-12 after `polish-p0032-p0036-skeleton-geometry.e2e.ts` passed in Edge). Independent review pending. See [the polish evidence ledger](polish-implementation-evidence.md).
- **Proposed:** 2026-11-06
- **Programme:** UI/UX polish
- **Delivery phase:** 2 - Shared components and loading
- **Extends:** [ADR-0004](adr-0004-interaction-primitives-and-notifications.md), [ADR-0028](adr-0028-recovery-and-multitab.md), [ADR-0032](adr-0032-diagnostics-and-operations.md); does not silently supersede their behavioural contracts.
- **Dependencies:** ADR-0033 inventory; ADR-0034 visual roles; ADR-0044 language and motion.
- **Checklist:** P0032–P0043 in [polish implementation checklist](polish-implementation-checklist.md).

> The owner requested implementation in PR #23 after the planning review. Functionality is written first; verification follows. Checkboxes require actual evidence, including any remaining human checks.

## Context and evidence boundary

Skeleton currently renders repeated 18px bars with alternating widths. Reduced-motion CSS already disables its breathing animation. Several views reuse this generic shape; Now's song-detail failure is swallowed, which can leave its loading presentation unresolved.

## Proposed decision and rationale

Create content-shaped skeleton variants for first retrieval and reserve geometry. Retain content during background refresh, use local busy indicators for actions, and show real stages for long analysis/rendering. Define slow, failed and recovery exits for every loader.

## Compatibility and product invariants

Preserve the existing feature and route inventory, local-first privacy, source files, drafts and ratings, explicit current/draft mutation scope, single audio ownership, bridge approval and atomic joining, and truthful export identity. Do not remove capability or weaken behavioural tests to obtain a cleaner screenshot. New API, schema, engine or platform work requires an explicitly scoped implementing change; this proposal alone does not authorize it.

## Implementation sequence and acceptance details

1. **P0032:** Design Mix card skeletons with the same title, description, metadata and reserved action geometry as populated cards.
2. **P0033:** Design Library row skeletons matching song/artist, facts and readiness columns at every layout mode.
3. **P0034:** Design Listen placeholders for title, waveform region and lyrics without drawing fake audio-derived waveform data.
4. **P0035:** Design Edit track/transition and inspector-content skeletons that preserve timeline and panel geometry.
5. **P0036:** Design Discover pair and Workshop information skeletons; keep modal chrome and known labels real.
6. **P0037:** Specify first-load versus background-refresh behaviour; preserve usable content, navigation, selection and playback during refresh.
7. **P0038:** Measure and choose a short-load reveal policy that avoids flicker; do not impose artificial minimum waits on already-ready content.
8. **P0039:** Use subtle theme-aware motion and a static reduced-motion variant; keep decorative bars out of the accessibility tree and announce each loading region once.
9. **P0040:** Provide actual job stages and labelled estimates for scanning, analysis, stem preparation, rendering and export; never fabricate percentages.
10. **P0041:** Replace failed or overdue retrieval with honest slow/error/retry states, including failed Listen details and inspector capability checks.
11. **P0042:** Test immediate, delayed, partial, failed, retried, stale and out-of-order responses without duplicate announcements or skeleton/content flashes.
12. **P0043:** Measure loading-to-content layout stability and verify focus/scroll position and action targets do not jump.

## Required tests and edge cases

Use the applicable cases in [the polish verification matrix](polish-verification-matrix.md), plus the task-specific cases above. Review both themes, loading-to-content transitions, narrow and wide layouts, keyboard/focus, long or missing metadata and failed/retried operations. For audio-affecting surfaces, include real audio ownership and continuity checks; for data-affecting actions, include current/draft identity and stale-response checks. Mark a case not applicable only with a recorded reason.

## Alternatives and trade-offs

A universal spinner loses structural context, while skeletons on every control add noise and misrepresent long jobs. Shape-specific skeletons cost more initial design work but make loading predictable without pretending progress.

## Acceptance and status update

Each loader has specified entry, geometry, motion, completion, slow-response, error and retry behaviour; long jobs never remain anonymous skeletons.

The owner accepted proceeding with implementation in PR #23. Implementation progresses Not started → In progress → Implemented → Verified using linked evidence. Only implemented and verified work can satisfy runtime tasks. Record partial work and unperformed human checks in [the polish evidence ledger](polish-implementation-evidence.md); do not infer success from a checkbox in the previous programme.

| Date | Decision status | Implementation status | Evidence |
|---|---|---|---|
| 2026-11-06 | Proposed | Not started | Original documentation-only proposal |
| 2026-11-06 | Accepted | In progress | Owner requested full implementation and merge after green CI in PR #23; verification pending |
| 2026-11-10 | Accepted | In progress (3/12) | Reconciled against current code; P0039-P0041 ticked with tests run that day; independent verification still pending |
| 2026-11-11 | Accepted | In progress (4/12) | P0042 ticked (`web/src/ui/polishReveal.test.tsx`); timeline skeleton (P0035) and reveal delay (P0038) built, browser specs written but not run |
| 2026-11-12 | Accepted | In progress (9/12) | P0033, P0035, P0037, P0038, P0043 ticked: `polish-p0033-library-skeleton-modes.e2e.ts`, `polish-p0035-timeline-skeleton.e2e.ts`, `polish-p0038-reveal.e2e.ts`, MP-0297-01..05 passed in Edge; Library placeholder grid fixed in `polish.css` |
| 2026-11-12 | Accepted | Implemented (12/12) | P0032, P0034, P0036 ticked: Mix feeling card, Listen waveform/lyrics and Discover/Workshop placeholders rebuilt to the loaded geometry; `polish-p0032-p0036-skeleton-geometry.e2e.ts` 4/4 passed in Edge, `polishSkeletonShapes.test.tsx` 3/3 |

## References

- [Polish programme and roadmap](polish-roadmap.md)
- [Polish implementation checklist](polish-implementation-checklist.md)
- [Research and source-inspection notes](../research/ui-ux-polish.md)
- [Existing feature parity](feature-parity.md)
- [Existing test coverage](test-coverage-matrix.md)
