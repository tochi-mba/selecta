# ADR-0037: First-run setup, truthful readiness and local privacy explanations

- **Decision status:** Accepted (owner requested implementation in PR #23)
- **Implementation status:** In progress: P0044-P0049 and P0051 implemented with evidence (2026-11-10/11); P0050 superseded by ADR-0126
- **Proposed:** 2026-11-06
- **Programme:** UI/UX polish
- **Delivery phase:** 3 - Core listening, mixes and requests
- **Extends:** [ADR-0017](adr-0017-library-scale-and-readiness.md), [ADR-0018](adr-0018-library-corrections-and-folders.md), [ADR-0025](adr-0025-local-privacy.md), [ADR-0032](adr-0032-diagnostics-and-operations.md); does not silently supersede their behavioural contracts.
- **Dependencies:** ADR-0034 and ADR-0044 foundations, ADR-0035 shared controls and ADR-0036 asynchronous states. Apply ADR-0045 accessibility requirements during implementation.
- **Checklist:** P0044–P0051 in [polish implementation checklist](polish-implementation-checklist.md).

> The owner requested implementation in PR #23 after the planning review. Functionality is written first; verification follows. Checkboxes require actual evidence, including any remaining human checks.

## Context and evidence boundary

Start asks for a typed music path; Mixes gates normal browsing below six ready songs. The scan route launches lyric lookup, whereas README privacy wording describes an explicitly invoked lyrics command. This discrepancy needs verification and consistent disclosure.

## Proposed decision and rationale

Explain folder selection and processing stages with accurate backend-derived readiness and privacy copy. Retain the safe typed-path path; treat a native picker as optional work requiring host-local binding, not a prerequisite or permission to broaden filesystem access.

## Compatibility and product invariants

Preserve the existing feature and route inventory, local-first privacy, source files, drafts and ratings, explicit current/draft mutation scope, single audio ownership, bridge approval and atomic joining, and truthful export identity. Do not remove capability or weaken behavioural tests to obtain a cleaner screenshot. New API, schema, engine or platform work requires an explicitly scoped implementing change; this proposal alone does not authorize it.

## Implementation sequence and acceptance details

1. **P0044:** Specify first-run composition, folder-path help, supported-content guidance and one clear primary action.
2. **P0045:** Distinguish invalid path, unavailable folder, empty folder, no supported music, scan in progress and scan failure.
3. **P0046:** Show finding songs, audio analysis, cue/lyric preparation and mix readiness as distinct facts using available backend information.
4. **P0047:** Explain the six-ready-song threshold and give an actionable reason when analysis is complete but too few songs can mix.
5. **P0048:** Let users inspect available Library/progress information while preparation continues where supported; identify any needed navigation work explicitly.
6. **P0049:** Verify actual lyric-network triggers and metadata fields and reconcile onboarding, README and privacy wording without claiming all operations are offline.
7. **P0050:** Specify optional native folder selection separately with safe local-path binding and typed fallback; no remote path upload or expanded server exposure.
8. **P0051:** Test retry, restart, copied-in files, Unicode paths, removed sources and return visits without losing setup progress.

## Required tests and edge cases

Use the applicable cases in [the polish verification matrix](polish-verification-matrix.md), plus the task-specific cases above. Review both themes, loading-to-content transitions, narrow and wide layouts, keyboard/focus, long or missing metadata and failed/retried operations. For audio-affecting surfaces, include real audio ownership and continuity checks; for data-affecting actions, include current/draft identity and stale-response checks. Mark a case not applicable only with a recorded reason.

## Alternatives and trade-offs

A forced native picker introduces platform work and can imply unsupported browser access. A single generic progress message is simpler but hides the difference between analysed and mix-ready songs.

## Acceptance and status update

A new user can identify the folder, understand what leaves the PC, see why preparation is blocked and reach the first playable mix without guessing.

The owner accepted proceeding with implementation in PR #23. Implementation progresses Not started → In progress → Implemented → Verified using linked evidence. Only implemented and verified work can satisfy runtime tasks. Record partial work and unperformed human checks in [the polish evidence ledger](polish-implementation-evidence.md); do not infer success from a checkbox in the previous programme.

| Date | Decision status | Implementation status | Evidence |
|---|---|---|---|
| 2026-11-06 | Proposed | Not started | Original documentation-only proposal |
| 2026-11-06 | Accepted | In progress | Owner requested full implementation and merge after green CI in PR #23; verification pending |
| 2026-11-10 | Accepted | In progress | In progress: P0044-P0049 and P0051 implemented with evidence (2026-11-10/11); P0050 superseded by ADR-0126 |

## References

- [Polish programme and roadmap](polish-roadmap.md)
- [Polish implementation checklist](polish-implementation-checklist.md)
- [Research and source-inspection notes](../research/ui-ux-polish.md)
- [Existing feature parity](feature-parity.md)
- [Existing test coverage](test-coverage-matrix.md)
