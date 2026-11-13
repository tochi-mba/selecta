# LF status reconciliation and supersession policy

**As of 2026-11-13:** ADR-0455 through ADR-0484 are **Accepted architecture** at the owner's direction. Their corresponding **120 implementation tasks are all Not started**, with no independently verified evidence. This PR edits documents only.

- Historical existing ADRs (0391-0454 and earlier) retain their recorded Accepted/Proposed/Implemented/In progress/Verified fields and original evidence. Their hosted-audio assumptions are **superseded for future architecture** by ADR-0455 and topic-specific LF ADRs.
- Do not make an earlier checklist line "Superseded" without product owner/source parity and an explicit implementation decision. A formerly implemented R2 pipeline can still accurately be marked implemented as a historical fact while being scheduled for retirement.
- No UI or source code changes, no migrations, no removal of customer uploads, no service tear-down, no automatic billing or feature-flag changes are performed by this documentation pull request.
- `docs/saas/README.md` and chapters 01-19 remain a historical accepted *hosted-audio* plan, with new top-level supersession notes and links to authoritative LF chapters. Avoid describing those old figures as live future plan benefits.
- New LF checklist is generated in normal task-ID style, status must be counted by `src/selecta/audit/checklist_summary.py`; `checklist_evidence.py` must reject checked tasks without proof. Run both in implementation PRs.
- First implementation step is `LF-0455-01`: source/test/feature inventory. Every subsequent change records old and new route/storage/UX owners and rollback.

## What Accepted means

The product/architecture decisions are approved **to implement and validate**. It does not certify the legality of a particular customer's recordings, approve specific third-party model licences, guarantee hardware works, or authorise paid business sale. Such evidence is required separately at gates.

## Known source gaps and assumptions to verify

- `web/src/kiosk/audio.ts` is a stub; future real audio output must not claim to be implemented.
- Cloud `cloud_mixes.py` stores immutable metadata revisions but not all local musical rendering parity.
- R2 originals and account export may have live data; actual production inventory is not verified.
- Legal rights for source copies, commercial playback, stem processing and model weights are unresolved.
- Current versioned plans include real hosted-storage/DSP quotas; they need migration/notice rather than instant replacement.
- No real-device six-hour venue soak or two-agent 5/8 media proof has been performed for the LF architecture.

## Source of truth

[Roadmap](selecta-local-first-roadmap.md) · [Owners and prior ADRs](selecta-local-first-overlap-and-parity.md) · [Source map](selecta-local-first-source-map.md) · [UX matrix](selecta-local-first-ui-state-matrix.md) · [Checklist](selecta-local-first-implementation-checklist.md) · [Release gates](selecta-local-first-release-gates.md).
