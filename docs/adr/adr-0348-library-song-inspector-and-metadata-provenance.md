# ADR-0348 - Library song inspector, musical metadata and measurement provenance

- **Decision:** Proposed (owner review pending; this PR does not record approval).
- **Implementation:** 1/8 Not started; 3/8 In progress; 4/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Selecta Library + Lucy experience redesign (LX); 2026-11-08; `main` `da942863e9f57e45653cfc2fda35fe463477b8be`.
- **Priority / phase:** P1 / Library detail. **Owner:** Unassigned. **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-10, coordinator commits).
- **Existing ADR owners:** ADR-0227, ADR-0154, ADR-0291, ADR-0315; their decisions and statuses remain unchanged.
- **Source touchpoints (inspection, not implementation):** `web/src/views/SongDetails.tsx`; `web/src/styles/operations.css`; `web/src/state/readiness.ts`.

## Context and source/evidence boundary

Song Details already distinguishes measured BPM/key from user overrides and shows readiness, lyrics and technical information. Layout redesign must preserve this provenance. Current features observed at the planning baseline must be revalidated at the later implementing SHA. These are proposed new design acceptance requirements, not evidence of a defect, missing feature, user-study result or completed implementation.

## Proposed decision

Create a music-first inspector: song identity and exact recording, current musical facts, readiness and rationale, then corrections and advanced source information. Do not bury measured-vs-overridden truth.

## User outcome and interaction contract

Users understand which values Selecta measured, which values are in use and what an adjustment might cause.

**Required negative cases:** Unknown BPM, inconsistent detected/current key, long title, duplicate recording, missing file, stale correction and narrow mobile sheet.

**Preservation and trade-offs:** Preserve original local audio files, a single authoritative player/audio-focus owner and intentional Pause; exact recording IDs and mix/draft/revision/occurrence/seam identity, scoped Undo and guarded commits; explicit permission and consented atomic request bridges; eight-lane Studio with 8–64 cells; canonical Library readiness and LRCLIB disclosure; unbiased human listening studies; frozen-revision decodable FLAC. Never imply readiness from historical memory, fabricated artwork or AI prose. No SaaS, accounts, launcher, native folder bridge, telemetry, unsolicited remote upload or audio-engine rewrite in this redesign.

## Implementation checklist - 4/8 Implemented; 0/8 independently Verified

1. **LX-0348-01 - Design inspector identity.** **Acceptance:** Exact recording title, artist and meaningful visual anchor lead the sheet. **Required verification:** Duplicate recording and long-title review. **Implementation:** In progress; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** web/e2e/lx-library.e2e.ts 'LX-0348-01 the sheet leads with the exact recording, whole long titles included' (2026-11-10); Needs a person: nothing; browser run of web/e2e/lx-library.e2e.ts queued for a slot, record pending. Independent reviewer -.
2. **LX-0348-02 - Separate facts from controls.** **Acceptance:** BPM, key, length, lyrics and readiness are scan-friendly before edit fields. **Required verification:** First-glance provenance task. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-10, coordinator commits); **Evidence/reviewer:** web/src/views/LibraryLxMore.test.tsx 'LX-0348-02, LX-0348-06, LX-0349-01 ... facts come before any edit field, and advanced facts are folded away but reachable' (2026-11-10); Needs a person: first-glance provenance task. Independent reviewer -.
3. **LX-0348-03 - Distinguish origin of values.** **Acceptance:** Measured data, user correction and unknown are visibly and semantically separate. **Required verification:** Override/unknown fixture and AT labels. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-10, coordinator commits); **Evidence:** web/src/views/LibraryLx.test.tsx 'LX-0348-03, LX-0348-04 ... a correction, the measurement and an unknown are labelled apart' (2026-11-10); **Evidence/reviewer:** independent reviewer -.
4. **LX-0348-04 - Explain readiness reason.** **Acceptance:** Known failure or missing source leads to a useful, truthful next step. **Required verification:** Failed/missing/queued detail-state tests. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-10, coordinator commits); **Evidence:** web/src/views/LibraryLx.test.tsx 'LX-0348-03, LX-0348-04 ... has a truthful next step' (6 states) and 'a missing file says where to look, and offers nothing that would play it' (2026-11-10); **Evidence/reviewer:** independent reviewer -.
5. **LX-0348-05 - Organise corrections.** **Acceptance:** Tempo/key form groups clear affordances, validation and rollback without form overload. **Required verification:** Error focus and form completion E2E. **Implementation:** In progress; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** web/e2e/lx-library.e2e.ts 'LX-0348-05 LX-0348-07 the song sheet corrects with focus on errors, and closing returns to the exact row, scroll and address' (2026-11-10); Needs a person: nothing; browser run of web/e2e/lx-library.e2e.ts queued for a slot, record pending. Independent reviewer -.
6. **LX-0348-06 - Keep source and advanced facts.** **Acceptance:** Advanced details remain reachable without presenting raw diagnostic data as the default. **Required verification:** Expert discoverability task. **Implementation:** Implemented; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** branch `feat/finish-checklists` (2026-11-10, coordinator commits); **Evidence/reviewer:** web/src/views/LibraryLxMore.test.tsx 'LX-0348-02, LX-0348-06, LX-0349-01 ... advanced facts are folded away but reachable' (2026-11-10); Needs a person: expert discoverability task. Independent reviewer -.
7. **LX-0348-07 - Preserve sheet focus and history.** **Acceptance:** Opening/closing details restores exact Library row, scroll and deep-link state. **Required verification:** Back/Forward and keyboard focus tests. **Implementation:** In progress; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** web/e2e/lx-library.e2e.ts 'LX-0348-05 LX-0348-07 ... closing returns to the exact row, scroll and address' (2026-11-10); Needs a person: nothing; browser run of web/e2e/lx-library.e2e.ts queued for a slot, record pending. Independent reviewer -.
8. **LX-0348-08 - Validate inspector confidence.** **Acceptance:** Users can explain active versus measured metadata before applying a correction. **Required verification:** Uncoached correction-and-restore study. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementing PR/SHA:** -; **Evidence/reviewer:** Needs a person: uncoached correction-and-restore study. Independent reviewer -.

## Evidence and release boundaries

Compare baseline and candidate at the same route, data, theme, viewport, scroll, player and revision state. Record screenshots and measured DOM geometry where pertinent, plus tests for keyboard, touch, 320px, 200/400% zoom, Light/Dark/System, forced colours, Still/reduced motion, long and RTL/CJK names, offline, stale, cancelled, failed and multitab conditions. Use actual local audio and independent listening review for playback-affecting changes; screenshots or green CI alone do not prove musical quality or user comprehension.

## Status governance and cross-links

**Decision remains Proposed** until a named owner records date and rationale. Only an exact implementing source/test PR and SHA with item-specific proof can advance Not started → In progress → Implemented. Independent verification requires different named reviewer/date/device/environment and relevant visual, accessibility, performance, user or real-audio evidence. Do not reclassify overlapping older tasks or existing features because this doc was merged.

[Roadmap](selecta-library-lucy-experience-roadmap.md) · [208-task checklist](selecta-library-lucy-experience-implementation-checklist.md) · [evidence ledger](selecta-library-lucy-experience-implementation-evidence.md) · [status JSON](selecta-library-lucy-experience-code-status.json) · [overlap/parity](selecta-library-lucy-experience-overlap-and-parity.md) · [interaction contract](selecta-library-lucy-experience-interaction-contract.md) · [verification](selecta-library-lucy-experience-verification-matrix.md) · [status reconciliation](selecta-library-lucy-experience-status-reconciliation.md) · [release gates](selecta-library-lucy-experience-release-gates.md)
