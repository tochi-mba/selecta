# ADR-0359 — Lucy current proposal summary, constraints and verified readiness

- **Decision:** Proposed (owner review pending; this PR does not record approval).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Selecta Library + Lucy experience redesign (LX); 2026-11-08; `main` `da942863e9f57e45653cfc2fda35fe463477b8be`.
- **Priority / phase:** P0 / Lucy proposal. **Owner:** Unassigned. **Implementing PR/SHA:** —.
- **Existing ADR owners:** ADR-0317, ADR-0318, ADR-0319, ADR-0323, ADR-0328; their decisions and statuses remain unchanged.
- **Source touchpoints (inspection, not implementation):** `web/src/views/LucyProposal.tsx`; `web/src/lucy/types.ts`; `web/src/views/LucyApprove.tsx`.

## Context and source/evidence boundary

The current proposal pane already exposes exact revision, song count, K−1 seam count and a real readiness ledger. It distinguishes proposed from saved/playing, but stronger visual hierarchy and human comprehension are not independently established. Current features observed at the planning baseline must be revalidated at the later implementing SHA. These are proposed new design acceptance requirements, not evidence of a defect, missing feature, user-study result or completed implementation.

## Proposed decision

Make proposal title, current revision, not-built lifecycle, real duration range, constraints and seam readiness a single comprehensible header. Never equate historical seam success with on-disk playable media.

## User outcome and interaction contract

People know precisely what would be saved and whether every required transition is ready before approval.

**Required negative cases:** One-song zero seams, stale ledger, evaporated cache, unknown duration, older revision, blocked commit and sparse ready-only graph.

**Preservation and trade-offs:** Preserve original local audio files, a single authoritative player/audio-focus owner and intentional Pause; exact recording IDs and mix/draft/revision/occurrence/seam identity, scoped Undo and guarded commits; explicit permission and consented atomic request bridges; eight-lane Studio with 8–64 cells; canonical Library readiness and LRCLIB disclosure; unbiased human listening studies; frozen-revision decodable FLAC. Never imply readiness from historical memory, fabricated artwork or AI prose. No SaaS, accounts, launcher, native folder bridge, telemetry, unsolicited remote upload or audio-engine rewrite in this redesign.

## Implementation checklist — 0/8 Implemented; 0/8 independently Verified

1. **LX-0359-01 — Present truthful lifecycle.** **Acceptance:** Proposed, approved, saved draft, rendering, ready and playing use distinct wording and semantics. **Required verification:** State machine and copy comprehension tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
2. **LX-0359-02 — Promote current revision identity.** **Acceptance:** Revision number/hash scope and historical viewing state are unambiguous. **Required verification:** Older/current snapshot fixture. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
3. **LX-0359-03 — Summarise song and duration facts.** **Acceptance:** N songs and actual low/high duration use source-backed estimates, no invented precision. **Required verification:** 1/2/long route and unknown-length tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
4. **LX-0359-04 — Count verified seams correctly.** **Acceptance:** K songs require max(0,K−1) directed transitions, and only verified clips count ready. **Required verification:** 0/1/K seams + cache proof E2E. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
5. **LX-0359-05 — Expose required versus preferred rules.** **Acceptance:** Hard ready-only and soft preferences cannot be visually conflated. **Required verification:** Constraint change and AT status tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
6. **LX-0359-06 — Explain infeasible strict plans.** **Acceptance:** No-route result suggests truthful shorter or relaxed options and requires user choice. **Required verification:** Sparse graph and immovable end-song fixture. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
7. **LX-0359-07 — Refresh approval proof.** **Acceptance:** Approval revalidates exact revision, source and on-disk clips, blocking stale ready-only states. **Required verification:** Eviction and concurrent commit tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
8. **LX-0359-08 — Validate readiness understanding.** **Acceptance:** People identify whether plan is unbuilt, saved or fully playable without reading code-like labels. **Required verification:** Uncoached musical-state interview. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.

## Evidence and release boundaries

Compare baseline and candidate at the same route, data, theme, viewport, scroll, player and revision state. Record screenshots and measured DOM geometry where pertinent, plus tests for keyboard, touch, 320px, 200/400% zoom, Light/Dark/System, forced colours, Still/reduced motion, long and RTL/CJK names, offline, stale, cancelled, failed and multitab conditions. Use actual local audio and independent listening review for playback-affecting changes; screenshots or green CI alone do not prove musical quality or user comprehension.

## Status governance and cross-links

**Decision remains Proposed** until a named owner records date and rationale. Only an exact implementing source/test PR and SHA with item-specific proof can advance Not started → In progress → Implemented. Independent verification requires different named reviewer/date/device/environment and relevant visual, accessibility, performance, user or real-audio evidence. Do not reclassify overlapping older tasks or existing features because this doc was merged.

[Roadmap](selecta-library-lucy-experience-roadmap.md) · [208-task checklist](selecta-library-lucy-experience-implementation-checklist.md) · [evidence ledger](selecta-library-lucy-experience-implementation-evidence.md) · [status JSON](selecta-library-lucy-experience-code-status.json) · [overlap/parity](selecta-library-lucy-experience-overlap-and-parity.md) · [interaction contract](selecta-library-lucy-experience-interaction-contract.md) · [verification](selecta-library-lucy-experience-verification-matrix.md) · [status reconciliation](selecta-library-lucy-experience-status-reconciliation.md) · [release gates](selecta-library-lucy-experience-release-gates.md)
