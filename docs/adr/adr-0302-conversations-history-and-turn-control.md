# ADR-0302 — Durable conversations, multi-turn continuity and user controls

- **Decision:** Accepted (owner approval recorded 2026-11-08; docs only, implementation pending).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Lucy agentic Make a Mix (LU); 2026-11-08; main `1b53debedc3d6ef3c8d0cf6302b561b0003e8d78`.
- **Priority / phase:** P0 / Agent. **Owner:** Unassigned. **Implementing PR/SHA:** —.
- **Existing ADR owners:** ADR-0228, ADR-0232, ADR-0238, ADR-0255, ADR-0270; their decisions and statuses remain unchanged.
- **Source touchpoints:** `web/src/App.tsx`; `src/selecta/db.py`; `web/src/state/prefs.ts`.

## Context and evidence boundary

An AI chat must survive route changes, reloads and server restarts, unlike ephemeral view state. The message timeline and current proposal are different durable objects. This is an accepted **new Lucy feature contract** (not yet implemented), not evidence that Lucy exists, that the current UI is defective, or that any new task is implemented. Source observations require revalidation at the implementation SHA.

## Proposed decision

Persist conversations, messages, message roles, turn/run identifiers, current proposal pointer and historical references. Expose New, Rename, History, Continue, Branch, Delete and locally persisted unsent drafts. Separate deleting a conversation from deleting committed mixes.

## Interaction, provenance and data contract

On desktop history is a secondary disclosure; on mobile it is a compact history surface. Unsent composer text persists per conversation and never bleeds into another thread.

**Failure and negative scope:** Concurrent tabs, split turns, message reorder, duplicate sends, archived/deleted conversations, deleted source drafts, storage-disabled PWA, and restored backups.

## Alternatives and trade-offs

Prefer integrating the existing Selecta source-of-truth over duplicating music state or adding a detached chatbot. Reject fabricated analysis, unsupported audio effects, model-authorised playback, and generic animation that does not explain real work. Any remote AI provider requires a separate explicit privacy/consent decision.

## Implementation checklist — 0/8 Implemented; 0/8 independently Verified

1. **LU-302-01 — Define conversation entities.** **Acceptance:** Conversation, message, turn, run and proposal references have independent immutable identifiers. **Required verification:** Schema/migration and identity tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
2. **LU-302-02 — Implement turn ordering contract.** **Acceptance:** Server sequence controls ordering; simultaneous submissions are serialised or explicitly superseded. **Required verification:** Concurrency stress and duplication tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
3. **LU-302-03 — Preserve transcripts durably.** **Acceptance:** All completed and interrupted turns survive reload and process restart. **Required verification:** Restart/fault-injection test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
4. **LU-302-04 — Design conversation history.** **Acceptance:** Searchable, renameable and reopenable threads retain exact current proposal pointer. **Required verification:** Desktop/mobile history task tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
5. **LU-302-05 — Persist unsent text.** **Acceptance:** Unsent per-thread text survives interruption without leaking between conversations. **Required verification:** PWA reload and tab-switch E2E. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
6. **LU-302-06 — Handle branch and restoration.** **Acceptance:** Branching does not rewrite ancestor messages or proposal snapshots. **Required verification:** History immutability and branch fixtures. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
7. **LU-302-07 — Specify deletion semantics.** **Acceptance:** Clear chat, delete proposal and delete draft have distinct consequences and confirmations. **Required verification:** Retention, backup and consent tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
8. **LU-302-08 — Audit storage isolation.** **Acceptance:** All conversations isolated by active Selecta data-home and relevant session identity. **Required verification:** Cross-home and cross-thread negative tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.

## Non-negotiable regression and release boundaries

Original local music unchanged; one player/audio-focus owner and intentional Pause; exact current/draft/revision/occurrence/seam identity and scoped Undo; explicitly consented atomic request bridges; all eight Studio lanes and 8–64 cells; truthful library readiness and LRCLIB metadata disclosure; neutral listening studies; frozen-revision decodable FLAC. Run relevant offline, stale, partial, cancelled, parallel, multi-tab, long/RTL/CJK, both themes, Still/reduced motion, 320px/400% zoom, keyboard, touch and real-audio tests. A model-generated explanation cannot substitute for actual source evidence.

## Status governance and cross-links

Decision **Accepted** (owner direction recorded 2026-11-08); future revision/supersession requires a dated decision. Implementation only advances with a source/test PR and specific acceptance proof; independent verification requires different named evidence and reviewer. No legacy task gets reclassified by this docs PR. [Lucy roadmap](selecta-lucy-roadmap.md) · [320-task checklist](selecta-lucy-implementation-checklist.md) · [evidence](selecta-lucy-implementation-evidence.md) · [verification](selecta-lucy-verification-matrix.md) · [release gates](selecta-lucy-release-gates.md).
