# ADR-0065: Persistent FLAC export jobs, exact revisions and download recovery

- **Decision status:** Accepted (owner accepted all proposed ADRs on 2026-11-08, [#37](https://github.com/tochi-mba/selecta/pull/37)).
- **Implementation status:** Not started
- **Documentation status:** Drafted in the Selecta 3.0 documentation-only proposal
- **Proposed:** 2026-11-07
- **Programme:** Selecta 3.0 complete experience overhaul
- **Phase:** 5 - Discovery and operations
- **Extends existing decisions:** ADR-0022, ADR-0026, ADR-0043
- **Dependencies:** [programme roadmap](selecta-3-roadmap.md) and verified baseline; see phase order.
- **Work item statuses:** Every S3-0065-XX item below is **Not started**. No runtime feature, test or UI change is claimed by this ADR.

## Context and rationale

Export currently prepares seams, renders FLAC and exposes a download through an overlay. Closing the overlay should not make the result hard to recover. Changing a mix mid-export risks reporting a file as belonging to the wrong revision.

## Decision proposed

Treat export as an explicitly revision-bound job visible independently of its initiating dialog. Preserve existing FLAC encoding and prereq rendering, introduce additive job/status API only if verified necessary, and never claim persistence beyond actual backend retention.

## Experience and frontend architecture

- Before launch, show mix identity, scope, readiness, approximate duration and any required renders. Associate the export with a snapshot including track instances, seam settings and playable render references (not just a count or order).

- An activity/job surface shows real stages: prepare seams, encode file, ready for download. Completion provides a durable download link only for the actual file-retention interval. If no existing durable job ID exists, document and review the minimum compatible extension before UI coding.

- An invalid or changed snapshot either uses its original immutable data or fails/requests a deliberate new export. Retrying never silently exports a different set.

## Detailed implementation work (all Not started)

1. **S3-0065-01 - Not started.** Inspect existing FLAC export API, file retention, content identity and active job mechanisms.
2. **S3-0065-02 - Not started.** Define immutable mix-snapshot/revision contract including seam intent and render provenance.
3. **S3-0065-03 - Not started.** Design export initiation with prerequisites, exact target scope, error conditions and truthful progress.
4. **S3-0065-04 - Not started.** Provide persistent in-app job entry to recover progress and download after overlay dismissal.
5. **S3-0065-05 - Not started.** Preserve rendering and download semantics; never auto-replace source mix during export.
6. **S3-0065-06 - Not started.** Handle cancel/retry where supported, expired files and disk-space failures with explicit messages.
7. **S3-0065-07 - Not started.** Test actual FLAC decoding and rendered sequence/revision identity.
8. **S3-0065-08 - Not started.** Run audible comparisons for seam continuity, seek and end-of-file correctness.

## Preservation and integration constraints

This work must preserve all applicable capabilities in [the existing feature-parity ledger](feature-parity.md): original source music and library data; drafts, user corrections, ratings and preferences; correct current-versus-draft mutation isolation; original routes; honest playable/render readiness; a single audio owner with no unintended stop or overlap; explicit request bridge consent and atomic insertion; accurate revision-bound FLAC; and secure localhost/origin privacy. New dependencies, API fields or native integration require separately reviewed contracts; the design does not itself authorize backend replacement.

## Required tests and edge-case verification (not yet executed)

- Export draft B while A plays; reorder B and switch current mix during render; ensure exact revision.
- Close/reopen dialog, reload page, backend restart or download expiry; do not fabricate a ready link.
- Stalled seam, failed encode, disk full, stale result and repeated Export clicks; no wrong file.

General test dimensions: dark and light; initial/populated/empty/partial/refreshing/busy/failed/offline/recovery; 320px–4K; zoom, pointer and keyboard; realistic long/missing/duplicate/RTL metadata; accessibility checks; stale response and race tests; representative local-audio playback where relevant. Existing tests may be adapted to accessible semantics but not deleted or weakened.

## Alternatives, risks and trade-offs

Keep the modal open through completion: simpler but fragile for long jobs. Force a backend job-system rewrite: unnecessary unless existing contracts lack durable identity. Start with compatible additions.

## Acceptance and evidence

Any completed download corresponds to the declared mix revision and remains recoverable for the actual supported retention period.

Before marking **Implemented**, link implementing PR(s), commit(s), contract tests, component/integration/E2E tests, screenshots and rollback disposition in [the evidence ledger](selecta-3-evidence.md). Before marking **Verified**, additionally record human task testing, assistive technology and audible checks wherever the change affects them. No prospective metric is a completed observation.

## Status history

| Date | Decision | Implementation | Evidence |
|---|---|---|---|
| 2026-11-07 | Proposed | Not started | Documentation-only ADR; no application or test changes |
| 2026-11-08 | Accepted | Not started | Owner accepted all proposed ADRs ([#37](https://github.com/tochi-mba/selecta/pull/37)) |

## References

- [Selecta 3.0 roadmap and ADR status index](selecta-3-roadmap.md)
- [Selecta 3.0 implementation checklist](selecta-3-implementation-checklist.md)
- [Selecta 3.0 verification matrix](selecta-3-verification-matrix.md)
- [Prior feature preservation contract](feature-parity.md)
- [Prior test coverage](test-coverage-matrix.md)
