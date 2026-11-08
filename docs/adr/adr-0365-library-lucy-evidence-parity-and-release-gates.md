# ADR-0365 — Library + Lucy redesign governance, evidence parity and independent GO/NO-GO

- **Decision:** Proposed (owner review pending; this PR does not record approval).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Selecta Library + Lucy experience redesign (LX); 2026-11-08; `main` `da942863e9f57e45653cfc2fda35fe463477b8be`.
- **Priority / phase:** P0 / Verification. **Owner:** Unassigned. **Implementing PR/SHA:** —.
- **Existing ADR owners:** ADR-0239, ADR-0240, ADR-0271, ADR-0299, ADR-0336, ADR-0339; their decisions and statuses remain unchanged.
- **Source touchpoints (inspection, not implementation):** `docs/adr/README.md`; `web/src/views/Library.test.tsx`; `web/src/views/Lucy.test.tsx`; `web/e2e/pages.e2e.ts`.

## Context and source/evidence boundary

Existing ADR programmes distinguish owner decision, source implementation and independent verification. Some earlier source-present features coexist with unstarted design checklist entries; this new programme must not rewrite their histories. Current features observed at the planning baseline must be revalidated at the later implementing SHA. These are proposed new design acceptance requirements, not evidence of a defect, missing feature, user-study result or completed implementation.

## Proposed decision

Track every new redesign task in ADR, checklist, evidence ledger and JSON; reconcile exact source reuse before implementation. Require matched visual, accessibility, real-audio, large-library and human acceptance before GO.

## User outcome and interaction contract

A reviewer can follow all 208 acceptance items to a future implementing SHA, evidence, independent reviewer and release decision without treating docs-only work as shipped code.

**Required negative cases:** Duplicated IDs, missing links, task marked implemented without SHA, source-present capability called missing, synthetic screenshots treated as human proof, audio regression and incomplete independent review.

**Preservation and trade-offs:** Preserve original local audio files, a single authoritative player/audio-focus owner and intentional Pause; exact recording IDs and mix/draft/revision/occurrence/seam identity, scoped Undo and guarded commits; explicit permission and consented atomic request bridges; eight-lane Studio with 8–64 cells; canonical Library readiness and LRCLIB disclosure; unbiased human listening studies; frozen-revision decodable FLAC. Never imply readiness from historical memory, fabricated artwork or AI prose. No SaaS, accounts, launcher, native folder bridge, telemetry, unsolicited remote upload or audio-engine rewrite in this redesign.

## Implementation checklist — 0/8 Implemented; 0/8 independently Verified

1. **LX-0365-01 — Record decision status correctly.** **Acceptance:** All new ADRs start Proposed and require dated owner rationale to Accept/Reject/Supersede. **Required verification:** Decision-status consistency audit. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
2. **LX-0365-02 — Publish complete task catalogue.** **Acceptance:** Each ADR owns eight unique LX items with acceptance and verification; links resolve. **Required verification:** 208-ID and link integrity script. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
3. **LX-0365-03 — Keep per-task evidence fields.** **Acceptance:** Every item has owner, source PR/SHA, proof and reviewer/date/platform columns. **Required verification:** Ledger row and ID count audit. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
4. **LX-0365-04 — Keep machine status in parity.** **Acceptance:** JSON status matches ADR/checklist/ledger and never auto-promotes on docs merge. **Required verification:** JSON schema and reconciliation check. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
5. **LX-0365-05 — Crosswalk historical owners.** **Acceptance:** Relevant LU/SF/FP/GP/MP decisions and existing code are not silently overridden. **Required verification:** Source-owner overlap review. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
6. **LX-0365-06 — Require independent visual and AT proof.** **Acceptance:** Both themes, 320px/400% zoom, real users, screen readers and device screenshots are signed. **Required verification:** Named independent review manifest. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
7. **LX-0365-07 — Require audio and performance proof.** **Acceptance:** No unsolicited player mutation; 20k results and real ready-only clips are measured on named devices. **Required verification:** Real-player and scale benchmark evidence. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
8. **LX-0365-08 — Record independent release decision.** **Acceptance:** No unresolved P0, rollback plan, signed owner and independent GO/NO-GO before release. **Required verification:** Gate dry run with refusal cases. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.

## Evidence and release boundaries

Compare baseline and candidate at the same route, data, theme, viewport, scroll, player and revision state. Record screenshots and measured DOM geometry where pertinent, plus tests for keyboard, touch, 320px, 200/400% zoom, Light/Dark/System, forced colours, Still/reduced motion, long and RTL/CJK names, offline, stale, cancelled, failed and multitab conditions. Use actual local audio and independent listening review for playback-affecting changes; screenshots or green CI alone do not prove musical quality or user comprehension.

## Status governance and cross-links

**Decision remains Proposed** until a named owner records date and rationale. Only an exact implementing source/test PR and SHA with item-specific proof can advance Not started → In progress → Implemented. Independent verification requires different named reviewer/date/device/environment and relevant visual, accessibility, performance, user or real-audio evidence. Do not reclassify overlapping older tasks or existing features because this doc was merged.

[Roadmap](selecta-library-lucy-experience-roadmap.md) · [208-task checklist](selecta-library-lucy-experience-implementation-checklist.md) · [evidence ledger](selecta-library-lucy-experience-implementation-evidence.md) · [status JSON](selecta-library-lucy-experience-code-status.json) · [overlap/parity](selecta-library-lucy-experience-overlap-and-parity.md) · [interaction contract](selecta-library-lucy-experience-interaction-contract.md) · [verification](selecta-library-lucy-experience-verification-matrix.md) · [status reconciliation](selecta-library-lucy-experience-status-reconciliation.md) · [release gates](selecta-library-lucy-experience-release-gates.md)
