# ADR-0363 — Lucy history, recovery, optional provider notices and conversation continuity

- **Decision:** Proposed (owner review pending; this PR does not record approval).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Selecta Library + Lucy experience redesign (LX); 2026-11-08; `main` `da942863e9f57e45653cfc2fda35fe463477b8be`.
- **Priority / phase:** P1 / Lucy recovery. **Owner:** Unassigned. **Implementing PR/SHA:** —.
- **Existing ADR owners:** ADR-0302, ADR-0331, ADR-0334, ADR-0330; their decisions and statuses remain unchanged.
- **Source touchpoints (inspection, not implementation):** `web/src/views/LucyHistory.tsx`; `web/src/views/LucyGate.tsx`; `web/src/views/LucySettings.tsx`.

## Context and source/evidence boundary

Lucy has durable conversations, searchable history, rename/archive/delete, built-in provider and consent notices. A refined surface must not hide provider/privacy facts or confuse deleting a thread with deleting a saved draft. Current features observed at the planning baseline must be revalidated at the later implementing SHA. These are proposed new design acceptance requirements, not evidence of a defect, missing feature, user-study result or completed implementation.

## Proposed decision

Provide human-readable conversation history, clear lifecycle controls and low-noise recovery. Keep privacy/remote-provider consent explicit at the right moment and never disable ordinary Make a Mix.

## User outcome and interaction contract

People resume work after reload or outage, understand what remains locally stored, and can delete a conversation without assuming saved mixes vanish.

**Required negative cases:** No provider, disabled Lucy, offline, interrupted stream, thread deleted elsewhere, stale proposal, multiple tabs, restored backup and unknown conversation link.

**Preservation and trade-offs:** Preserve original local audio files, a single authoritative player/audio-focus owner and intentional Pause; exact recording IDs and mix/draft/revision/occurrence/seam identity, scoped Undo and guarded commits; explicit permission and consented atomic request bridges; eight-lane Studio with 8–64 cells; canonical Library readiness and LRCLIB disclosure; unbiased human listening studies; frozen-revision decodable FLAC. Never imply readiness from historical memory, fabricated artwork or AI prose. No SaaS, accounts, launcher, native folder bridge, telemetry, unsolicited remote upload or audio-engine rewrite in this redesign.

## Implementation checklist — 0/8 Implemented; 0/8 independently Verified

1. **LX-0363-01 — Improve conversation discovery.** **Acceptance:** History is searchable, names and current thread are readable and clear. **Required verification:** History search and route task. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
2. **LX-0363-02 — Separate archive and delete.** **Acceptance:** Archive, branch, rename and delete have distinguishable consequences. **Required verification:** Destructive-action comprehension test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
3. **LX-0363-03 — Protect committed drafts.** **Acceptance:** Deleting a conversation never implies deleting already saved drafts or source music. **Required verification:** Delete semantics E2E. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
4. **LX-0363-04 — Persist per-thread context.** **Acceptance:** History, latest proposal pointer and unsent composer draft survive reload with no leakage. **Required verification:** Reload/multi-tab persistence test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
5. **LX-0363-05 — Show offline recovery paths.** **Acceptance:** Streaming gap, interrupted run and stale results offer explicit catch-up or retry. **Required verification:** Server restart and network loss E2E. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
6. **LX-0363-06 — Keep provider facts honest.** **Acceptance:** Built-in versus remote provider and precise consented data classes are visible before sending. **Required verification:** Privacy settings and consent review. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
7. **LX-0363-07 — Preserve Quick Mix fallback.** **Acceptance:** Unavailable Lucy never blocks standard Make a Mix or modifies active playback. **Required verification:** Provider-off/old server regression. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
8. **LX-0363-08 — Validate recovery confidence.** **Acceptance:** Users locate last proposal and know what was saved after an interrupted session. **Required verification:** Uncoached resume-and-explain study. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.

## Evidence and release boundaries

Compare baseline and candidate at the same route, data, theme, viewport, scroll, player and revision state. Record screenshots and measured DOM geometry where pertinent, plus tests for keyboard, touch, 320px, 200/400% zoom, Light/Dark/System, forced colours, Still/reduced motion, long and RTL/CJK names, offline, stale, cancelled, failed and multitab conditions. Use actual local audio and independent listening review for playback-affecting changes; screenshots or green CI alone do not prove musical quality or user comprehension.

## Status governance and cross-links

**Decision remains Proposed** until a named owner records date and rationale. Only an exact implementing source/test PR and SHA with item-specific proof can advance Not started → In progress → Implemented. Independent verification requires different named reviewer/date/device/environment and relevant visual, accessibility, performance, user or real-audio evidence. Do not reclassify overlapping older tasks or existing features because this doc was merged.

[Roadmap](selecta-library-lucy-experience-roadmap.md) · [208-task checklist](selecta-library-lucy-experience-implementation-checklist.md) · [evidence ledger](selecta-library-lucy-experience-implementation-evidence.md) · [status JSON](selecta-library-lucy-experience-code-status.json) · [overlap/parity](selecta-library-lucy-experience-overlap-and-parity.md) · [interaction contract](selecta-library-lucy-experience-interaction-contract.md) · [verification](selecta-library-lucy-experience-verification-matrix.md) · [status reconciliation](selecta-library-lucy-experience-status-reconciliation.md) · [release gates](selecta-library-lucy-experience-release-gates.md)
