# ADR-0044: Consistent product vocabulary, truthful explanations and restrained motion

- **Decision status:** Accepted (owner requested implementation in PR #23)
- **Implementation status:** In progress ([#23](https://github.com/tochi-mba/selecta/pull/23))
- **Proposed:** 2026-11-06
- **Programme:** UI/UX polish
- **Delivery phase:** 1 - Visual foundations and language
- **Extends:** [ADR-0003](adr-0003-design-tokens-and-brand.md), [ADR-0004](adr-0004-interaction-primitives-and-notifications.md), [ADR-0027](adr-0027-explanations-and-feedback.md), [ADR-0032](adr-0032-diagnostics-and-operations.md); does not silently supersede their behavioural contracts.
- **Dependencies:** ADR-0033 baseline and inventory.
- **Checklist:** P0112–P0120 in [polish implementation checklist](polish-implementation-checklist.md).

> The owner requested implementation in PR #23 after the planning review. Functionality is written first; verification follows. Checkboxes require actual evidence, including any remaining human checks.

## Context and evidence boundary

The UI mixes transition, seam, hand-off, queue and line, and uses several local motion declarations alongside tokenized timing. The product should retain its conversational voice while making actions and processing states precise.

## Proposed decision and rationale

Create a shared vocabulary and motion specification. Explain consequences and delayed effects locally, expose deeper evidence on demand, and never present technical audio checks as proof of musical quality.

## Compatibility and product invariants

Preserve the existing feature and route inventory, local-first privacy, source files, drafts and ratings, explicit current/draft mutation scope, single audio ownership, bridge approval and atomic joining, and truthful export identity. Do not remove capability or weaken behavioural tests to obtain a cleaner screenshot. New API, schema, engine or platform work requires an explicitly scoped implementing change; this proposal alone does not authorize it.

## Implementation sequence and acceptance details

1. **P0112:** Define everyday transition terminology and explicitly distinguish current mix, draft, playback order and processing queue.
2. **P0113:** Audit every action label, tooltip, empty/error/loading message and notification for specific outcome and consistent voice.
3. **P0114:** Standardize sentence case, punctuation, pluralization, durations, counts, keyboard hints and units.
4. **P0115:** Give errors appropriate what-happened/what-remains-safe/next-action content without unsupported reassurance.
5. **P0116:** Explain when steering takes effect and distinguish requested, estimated and confirmed outcomes.
6. **P0117:** Keep explanations factual and on demand; retain a clear distinction between automated checks and human musical judgment.
7. **P0118:** Specify duration/easing/property roles for hover, press, overlays, skeletons, lyrics and playback motion; avoid decorative movement that shifts targets.
8. **P0119:** Respect reduced motion for all CSS and canvas effects, including changes to the preference while the app is open.
9. **P0120:** Review announcement frequency, truncation, mixed-language text and missing metadata with the same copy/motion rules.

## Required tests and edge cases

Use the applicable cases in [the polish verification matrix](polish-verification-matrix.md), plus the task-specific cases above. Review both themes, loading-to-content transitions, narrow and wide layouts, keyboard/focus, long or missing metadata and failed/retried operations. For audio-affecting surfaces, include real audio ownership and continuity checks; for data-affecting actions, include current/draft identity and stale-response checks. Mark a case not applicable only with a recorded reason.

## Alternatives and trade-offs

Formal technical copy everywhere would undermine approachable listening. Overly casual vague verbs hide consequences; use concise outcome-specific language with optional technical detail.

## Acceptance and status update

The same concept and action have the same meaning everywhere, and animation supports feedback without misleading progress or disrupting control.

The owner accepted proceeding with implementation in PR #23. Implementation progresses Not started → In progress → Implemented → Verified using linked evidence. Only implemented and verified work can satisfy runtime tasks. Record partial work and unperformed human checks in [the polish evidence ledger](polish-implementation-evidence.md); do not infer success from a checkbox in the previous programme.

| Date | Decision status | Implementation status | Evidence |
|---|---|---|---|
| 2026-11-06 | Proposed | Not started | Original documentation-only proposal |
| 2026-11-06 | Accepted | In progress | Owner requested full implementation and merge after green CI in PR #23; verification pending |

## References

- [Polish programme and roadmap](polish-roadmap.md)
- [Polish implementation checklist](polish-implementation-checklist.md)
- [Research and source-inspection notes](../research/ui-ux-polish.md)
- [Existing feature parity](feature-parity.md)
- [Existing test coverage](test-coverage-matrix.md)
