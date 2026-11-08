# ADR-354 — Make a Mix mood discovery, preset choices and natural-language handoff

- **Decision:** Proposed (owner review pending; this PR does not record approval).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Selecta Library + Lucy experience redesign (LX); 2026-11-08; `main` `da942863e9f57e45653cfc2fda35fe463477b8be`.
- **Priority / phase:** P1 / Make a Mix entry. **Owner:** Unassigned. **Implementing PR/SHA:** —.
- **Existing ADR owners:** ADR-0216, ADR-0259, ADR-0283, ADR-0321; their decisions and statuses remain unchanged.
- **Source touchpoints (inspection, not implementation):** `web/src/views/Mixes.tsx`; `web/src/views/MixSetup.tsx`; `web/src/lucy/words.ts`.

## Context and source/evidence boundary

Current vibe suggestions are grounded in server-returned candidates; their counts and descriptions refer to matching material, not a prebuilt playable sequence. Current features observed at the planning baseline must be revalidated at the later implementing SHA. These are proposed new design acceptance requirements, not evidence of a defect, missing feature, user-study result or completed implementation.

## Proposed decision

Keep mood discovery enjoyable but clearly secondary to the two creation paths. Define action and copy distinctions among Play, Shape first, Save draft and asking Lucy with the user's own words.

## User outcome and interaction contract

People can choose a mood without confusing a suggestion with an already-built sequence, or carry an idea to Lucy without accidental submission.

**Required negative cases:** Zero matching songs, unavailable mood, stale candidate, missing art, length estimate versus actual and current mix replacement.

**Preservation and trade-offs:** Preserve original local audio files, a single authoritative player/audio-focus owner and intentional Pause; exact recording IDs and mix/draft/revision/occurrence/seam identity, scoped Undo and guarded commits; explicit permission and consented atomic request bridges; eight-lane Studio with 8–64 cells; canonical Library readiness and LRCLIB disclosure; unbiased human listening studies; frozen-revision decodable FLAC. Never imply readiness from historical memory, fabricated artwork or AI prose. No SaaS, accounts, launcher, native folder bridge, telemetry, unsolicited remote upload or audio-engine rewrite in this redesign.

## Implementation checklist — 0/8 Implemented; 0/8 independently Verified

1. **LX-354-01 — Redesign mood-card hierarchy.** **Acceptance:** Cards prioritise name, feeling, real supporting facts and one action. **Required verification:** Card comprehension and visual hierarchy study. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
2. **LX-354-02 — Keep suggestion provenance.** **Acceptance:** Matching counts and audio durations are never labelled full mix or transition readiness. **Required verification:** Live candidate versus actual build fixture. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
3. **LX-354-03 — Clarify three action paths.** **Acceptance:** Play, Shape first and Save draft have distinct concise outcomes. **Required verification:** Before-action prediction study. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
4. **LX-354-04 — Retain flexible durations.** **Acceptance:** Approximate lengths indicate source material rather than guaranteed rendered runtime. **Required verification:** Duration/transition copy tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
5. **LX-354-05 — Enable Lucy handoff safely.** **Acceptance:** Selected mood can suggest editable prompt wording but does not send automatically. **Required verification:** Route/prefill and no-commit E2E. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
6. **LX-354-06 — Handle insufficient candidates.** **Acceptance:** Unavailable mood ideas show why and a supported next option. **Required verification:** No-ready and sparse-match fixtures. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
7. **LX-354-07 — Reduce optional clutter.** **Acceptance:** Advanced shaping stays accessible without overwhelming core mood discovery. **Required verification:** Progressive-disclosure task test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.
8. **LX-354-08 — Validate creation continuity.** **Acceptance:** User moves from mood selection to Lucy or editor without lost context or surprise audio. **Required verification:** Cross-route session task with playback. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** —; **Evidence/reviewer:** —.

## Evidence and release boundaries

Compare baseline and candidate at the same route, data, theme, viewport, scroll, player and revision state. Record screenshots and measured DOM geometry where pertinent, plus tests for keyboard, touch, 320px, 200/400% zoom, Light/Dark/System, forced colours, Still/reduced motion, long and RTL/CJK names, offline, stale, cancelled, failed and multitab conditions. Use actual local audio and independent listening review for playback-affecting changes; screenshots or green CI alone do not prove musical quality or user comprehension.

## Status governance and cross-links

**Decision remains Proposed** until a named owner records date and rationale. Only an exact implementing source/test PR and SHA with item-specific proof can advance Not started → In progress → Implemented. Independent verification requires different named reviewer/date/device/environment and relevant visual, accessibility, performance, user or real-audio evidence. Do not reclassify overlapping older tasks or existing features because this doc was merged.

[Roadmap](selecta-library-lucy-experience-roadmap.md) · [208-task checklist](selecta-library-lucy-experience-implementation-checklist.md) · [evidence ledger](selecta-library-lucy-experience-implementation-evidence.md) · [status JSON](selecta-library-lucy-experience-code-status.json) · [overlap/parity](selecta-library-lucy-experience-overlap-and-parity.md) · [interaction contract](selecta-library-lucy-experience-interaction-contract.md) · [verification](selecta-library-lucy-experience-verification-matrix.md) · [status reconciliation](selecta-library-lucy-experience-status-reconciliation.md) · [release gates](selecta-library-lucy-experience-release-gates.md)
