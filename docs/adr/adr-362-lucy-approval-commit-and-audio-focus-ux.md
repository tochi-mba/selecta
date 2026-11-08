# ADR-362 — Lucy approval, draft commit, save-and-play confirmation and audio ownership

- **Decision:** Proposed (owner review pending; this PR does not record approval).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Selecta Library + Lucy experience redesign (LX); 2026-11-08; `main` `da942863e9f57e45653cfc2fda35fe463477b8be`.
- **Priority / phase:** P0 / Lucy approval. **Owner:** Unassigned. **Implementing PR/SHA:** —.
- **Existing ADR owners:** ADR-0326, ADR-0328, ADR-0300, ADR-0270; their decisions and statuses remain unchanged.
- **Source touchpoints (inspection, not implementation):** `web/src/views/LucyApprove.tsx`; `web/src/views/Lucy.tsx`; `src/selecta/lucy/commit.py`.

## Context and source/evidence boundary

Lucy already has preflight approval, idempotency-keyed commit reconciliation and explicit save-vs-play choices. UI redesign must protect those guarantees and must not let a model start playback. Current features observed at the planning baseline must be revalidated at the later implementing SHA. These are proposed new design acceptance requirements, not evidence of a defect, missing feature, user-study result or completed implementation.

## Proposed decision

Design one comprehensible approval area with Save as draft as the non-disruptive default and Save and play as separately confirmed, exact-revision action. Failed/unknown outcomes must never be presented as successful.

## User outcome and interaction contract

People can save safely or intentionally replace playback, understand what is actually ready, and recover without duplicate commits.

**Required negative cases:** Stale proposal, one-song ready-only, cache eviction, timeout after server commit, offline, two tabs, currently playing, modal escape and interrupted playback.

**Preservation and trade-offs:** Preserve original local audio files, a single authoritative player/audio-focus owner and intentional Pause; exact recording IDs and mix/draft/revision/occurrence/seam identity, scoped Undo and guarded commits; explicit permission and consented atomic request bridges; eight-lane Studio with 8–64 cells; canonical Library readiness and LRCLIB disclosure; unbiased human listening studies; frozen-revision decodable FLAC. Never imply readiness from historical memory, fabricated artwork or AI prose. No SaaS, accounts, launcher, native folder bridge, telemetry, unsolicited remote upload or audio-engine rewrite in this redesign.

## Implementation checklist — 0/8 Implemented; 0/8 independently Verified

1. **LX-362-01 — Distinguish approval actions.** **Acceptance:** Save draft versus Save and play visually communicate consequences and retain equal accessibility. **Required verification:** Before-action comprehension task. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
2. **LX-362-02 — Show exact preflight facts.** **Acceptance:** Confirmation lists current revision/title, song count, K−1 readiness and strict rule. **Required verification:** Approval snapshot and stale revision test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
3. **LX-362-03 — Guard active playback.** **Acceptance:** Save and play requires explicit replacement confirmation and direct user action. **Required verification:** Real-player audio-focus E2E. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
4. **LX-362-04 — Preserve idempotent commit.** **Acceptance:** Retry or lost reply reconciles existing operation rather than submitting duplicate draft. **Required verification:** Timeout and commit lookup test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
5. **LX-362-05 — Explain uncertain outcomes.** **Acceptance:** Saved, not received, unknown and failed are separate actionable states. **Required verification:** Network-fault state matrix. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
6. **LX-362-06 — Block invalid ready-only approval.** **Acceptance:** No silent missing-seam rendering or mismatched order at commit. **Required verification:** Eviction and directed-seam fixtures. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
7. **LX-362-07 — Link to existing editor/drafts.** **Acceptance:** Successful save opens the exact existing draft/editor, no duplicate workspace. **Required verification:** Draft ID navigation and scoped Undo tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
8. **LX-362-08 — Validate informed consent.** **Acceptance:** Users predict save versus play effects and stop/cancel without side effects. **Required verification:** Uncoached active-player approval study. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.

## Evidence and release boundaries

Compare baseline and candidate at the same route, data, theme, viewport, scroll, player and revision state. Record screenshots and measured DOM geometry where pertinent, plus tests for keyboard, touch, 320px, 200/400% zoom, Light/Dark/System, forced colours, Still/reduced motion, long and RTL/CJK names, offline, stale, cancelled, failed and multitab conditions. Use actual local audio and independent listening review for playback-affecting changes; screenshots or green CI alone do not prove musical quality or user comprehension.

## Status governance and cross-links

**Decision remains Proposed** until a named owner records date and rationale. Only an exact implementing source/test PR and SHA with item-specific proof can advance Not started → In progress → Implemented. Independent verification requires different named reviewer/date/device/environment and relevant visual, accessibility, performance, user or real-audio evidence. Do not reclassify overlapping older tasks or existing features because this doc was merged.

[Roadmap](selecta-library-lucy-experience-roadmap.md) · [208-task checklist](selecta-library-lucy-experience-implementation-checklist.md) · [evidence ledger](selecta-library-lucy-experience-implementation-evidence.md) · [status JSON](selecta-library-lucy-experience-code-status.json) · [overlap/parity](selecta-library-lucy-experience-overlap-and-parity.md) · [interaction contract](selecta-library-lucy-experience-interaction-contract.md) · [verification](selecta-library-lucy-experience-verification-matrix.md) · [status reconciliation](selecta-library-lucy-experience-status-reconciliation.md) · [release gates](selecta-library-lucy-experience-release-gates.md)
