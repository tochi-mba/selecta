# ADR-0338 - Additive migrations, feature flags, offline fallback and reversible rollout

- **Decision:** Accepted (owner approval recorded 2026-11-08; docs only, implementation pending).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Lucy agentic Make a Mix (LU); 2026-11-08; main `1b53debedc3d6ef3c8d0cf6302b561b0003e8d78`.
- **Priority / phase:** P0 / Release. **Owner:** Unassigned. **Implementing PR/SHA:** -.
- **Existing ADR owners:** ADR-0076, ADR-0113, ADR-0238, ADR-0241, ADR-0247, ADR-0299; unchanged.
- **Source touchpoints:** `src/selecta/db.py`; `src/selecta/api.py`; `web/src/App.tsx`; `web/src/state/prefs.ts`.

## Context and evidence boundary

Lucy introduces new local tables, provider settings and an agent run service. It must not force AI setup for existing users or corrupt their existing queues, drafts and audio when disabled. This ADR is a new proposal, not source implementation or independently proven usability/audio. Older implementation and verification histories remain unchanged.

## Proposed decision

Ship separately gated read-only chat, proposals/revisions, exact build, taste history and optional voice. Migrate data additively with recovery/rollback, preserve local-only shell and existing API behaviour and allow instant Lucy-off fallback.

## UI/UX and measurable acceptance contract

No provider configured means existing Quick Play still works; Lucy entry explains setup without blocking app. Disabling Lucy leaves real saved drafts and audio intact.

**Required negative cases:** Upgrade from old database, downgrade/rollback, partial migration, server older than web build, disabled provider, data-home relink, backup restore, stale plan and cross-version events.

## Rejected shortcuts and dependencies

Never prioritise chatbot animation over audio continuity or fabricated estimates over measured truth. Reuse the existing Selecta app and WeftAI typed planning. Before implementing, reconcile related accepted ADRs against current source, tests and actual audio evidence; do not retrofit their historical statuses.

## Implementation checklist - 0/8 Implemented; 0/8 independently Verified

1. **LU-338-01 - Define flag and rollout phases.** **Acceptance:** Read-only→proposal→commit→memory→optional voice independently switchable. **Required verification:** Flag matrix and rollback E2E. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
2. **LU-338-02 - Create additive migrations.** **Acceptance:** Old queue/draft/preferences unaffected; new tables verified. **Required verification:** Migration + downgrade/restore tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
3. **LU-338-03 - Protect old API compatibility.** **Acceptance:** Existing Mixes/editor/player endpoints and payloads retain semantics. **Required verification:** Current regression suite. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
4. **LU-338-04 - Handle frontend/server version skew.** **Acceptance:** Unknown routes/schema produce truthful unavailable state. **Required verification:** Mixed-version browser E2E. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
5. **LU-338-05 - Define disable and data retention.** **Acceptance:** Lucy off stops model work but does not delete committed drafts/music. **Required verification:** Kill-switch and consent tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
6. **LU-338-06 - Validate backup/recovery scope.** **Acceptance:** Conversation/proposal and approval data handled explicitly in local backup. **Required verification:** Restore fault injection. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
7. **LU-338-07 - Monitor controlled release.** **Acceptance:** Privacy-safe opt-in metrics and error monitoring with no raw audio export. **Required verification:** Telemetry consent and redaction review. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
8. **LU-338-08 - Write GO/NO-GO and rollback protocol.** **Acceptance:** Named owner can revert Lucy independently with no audio loss. **Required verification:** Dry-run rollback at pinned SHA. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.

## Preservation and release proof

Preserve originals, single audio owner/manual Pause, real current/draft/revision/seam/occurrence identity and scoped Undo, consented atomic bridges, Studio 8 lanes/8–64 cells, correct library and LRCLIB disclosure, neutral blind listening, frozen FLAC export. Test stale/offline/worker crashes, mobile/320px/400% zoom, keyboard/AT/RTL/forced colours/reduced motion and real audio as relevant.

## Governance

Decision Accepted and all eight LU tasks Not started/Not Verified. An implementing PR/test SHA and exact acceptance evidence are distinct from independent named reviewer/date/platform proof. [Roadmap](selecta-lucy-roadmap.md) · [checklist](selecta-lucy-implementation-checklist.md) · [evidence](selecta-lucy-implementation-evidence.md) · [verification](selecta-lucy-verification-matrix.md) · [release](selecta-lucy-release-gates.md).
