# ADR-0045: Responsive workspace finish and complete accessible task journeys

- **Decision status:** Accepted (owner requested implementation in PR #23)
- **Implementation status:** In progress ([#23](https://github.com/tochi-mba/selecta/pull/23)); 2026-11-10/11 reconciliation: 3 of 11 tasks ticked (P0124, P0125, P0127; P0125 on 2026-11-12 after MP-0298-05, both forced-colour tests and MP-0287-04 passed); P0129 and P0130 implemented but their browser checks failed; P0131 open; P0121-P0123, P0126 and P0128 need a person. See the [evidence ledger](polish-implementation-evidence.md).
- **Proposed:** 2026-11-06
- **Programme:** UI/UX polish
- **Delivery phase:** 6 - Responsive and accessibility verification
- **Extends:** [ADR-0023](adr-0023-accessibility.md), [ADR-0024](adr-0024-responsive-workspaces.md), [ADR-0031](adr-0031-pwa-and-browsers.md); does not silently supersede their behavioural contracts.
- **Dependencies:** All migrated surfaces from phases 1–5; accessibility requirements apply from phase 1, not only at this gate.
- **Checklist:** P0121–P0131 in [polish implementation checklist](polish-implementation-checklist.md).

> The owner requested implementation in PR #23 after the planning review. Functionality is written first; verification follows. Checkboxes require actual evidence, including any remaining human checks.

## Context and evidence boundary

Existing tests check overflow from 320px to 4K and run axe in both themes. The evidence ledger explicitly leaves manual screen-reader and several full keyboard journeys incomplete. Simulated narrow viewports are not proof of actual zoom or touch usability.

## Proposed decision and rationale

Treat accessibility and responsive behaviour as design inputs throughout all phases and as manual release gates. Preserve every essential operation at supported sizes rather than treating no horizontal overflow as sufficient.

## Compatibility and product invariants

Preserve the existing feature and route inventory, local-first privacy, source files, drafts and ratings, explicit current/draft mutation scope, single audio ownership, bridge approval and atomic joining, and truthful export identity. Do not remove capability or weaken behavioural tests to obtain a cleaner screenshot. New API, schema, engine or platform work requires an explicitly scoped implementing change; this proposal alone does not authorize it.

## Implementation sequence and acceptance details

1. **P0121:** Agree supported browser/OS/assistive-technology and installed-app matrix, with real-device versus simulated evidence labelled.
2. **P0122:** Review 320/375/390/430/768/1024/1440/1920/3840 widths, short windows, landscape, safe areas and virtual keyboards.
3. **P0123:** Verify actual 200% and 400% browser zoom, text resizing, focus visibility and scroll behaviour in addition to viewport simulations.
4. **P0124:** Target generous 44px touch controls where practical and verify WCAG 2.2 AA 24px minimum/spacing exceptions accurately.
5. **P0125:** Measure text contrast (4.5:1 normal, 3:1 large) and applicable non-text contrast (3:1), focus visibility and non-colour status information.
6. **P0126:** Complete keyboard-only setup, listening, requests, mixes, editing, Studio, Library, discovery, export and study journeys.
7. **P0127:** Test custom sliders, waveform seeking, energy curves, tabs and grids against their documented keyboard and accessible-value behaviour.
8. **P0128:** Complete NVDA and supported VoiceOver journeys with human evidence; automated axe success is not a substitute.
9. **P0129:** Check sticky navigation/player/notifications/sheets never fully obscure focused controls and provide reachable close/recovery actions.
10. **P0130:** Review dynamic announcements, reduced motion, forced-colour presentation and long mixed-direction metadata.
11. **P0131:** Record and resolve failures per surface/state; keep unperformed human checks explicitly pending.

## Required tests and edge cases

Use the applicable cases in [the polish verification matrix](polish-verification-matrix.md), plus the task-specific cases above. Review both themes, loading-to-content transitions, narrow and wide layouts, keyboard/focus, long or missing metadata and failed/retried operations. For audio-affecting surfaces, include real audio ownership and continuity checks; for data-affecting actions, include current/draft identity and stale-response checks. Mark a case not applicable only with a recorded reason.

## Alternatives and trade-offs

Automated scans alone cannot establish screen-reader or task usability. Restricting expert work to desktop would remove existing supported access; define usable narrow-screen adaptations and explicitly document any genuine limits.

## Acceptance and status update

All supported essential journeys are usable with keyboard and applicable assistive technology at documented sizes, with measured contrast and human evidence.

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
