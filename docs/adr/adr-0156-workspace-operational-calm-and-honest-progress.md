# ADR-0156 - Workspace calm: background progress, storage capacity and action-first status

- **Decision:** Accepted by the repository owner on 2026-11-07; implementation and independent verification remain separately evidenced.
- **Implementation:** 7/8 Implemented, 0/8 In progress, 1 Not started (source-level, PR #31).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta immersive experience and microinteractions; 2026-11-07; main `525a49cee6b0a02cae7e71dbe3f336a0141ec2d7` (after merged PR #30).
- **Priority / phase:** P1 / Workspace.
- **Related earlier ADRs:** ADR-0128, ADR-0107, ADR-0131; earlier decisions and historical implementation claims remain intact.
- **Source touchpoints:** web/src/views/Workshop.tsx; web/src/views/WorkshopPanels.tsx; web/src/views/ExportJobs.tsx.

## Context and evidence boundary

Source watching, analysis, rendered seams, storage and diagnostics are required for a local-first DJ. The best operational UX is quiet until a human decision is needed, with no fake progress or unnecessary alerts. This is a **new experience delta** to existing code and ADR-0114–0134, not a claim that existing implementations are missing. PR #31 includes source-level implementation and tests, but this proposal remains owner-unaccepted and independently unverified. Human visual, audio, screen-reader, touch and comprehension results are not asserted.

## Proposed decision

- Show 'What needs you' before detailed metrics and distinguish a harmless queue from a blocker.
- Render and analysis estimates must be approximate and based on actual measurements; no artificially smooth progress bar.
- Preserve the priority order: current mix, draft rendering, analysis, spare-time discoveries, with clear reasons for waiting.
- Storage shows actual generated assets, protected priority windows, free capacity and original music exclusion.
- Folder monitor states distinguish watching, missing, stopped, scanning and canceling; never imply source file deletion.
- Diagnostics remain privacy-safe and available only on deliberate access, with clear retry if server is gone.

## Interaction choreography and visual behavior

- Progress bars update when authoritative job counts change; use restrained width transitions ≤180 ms only for genuinely monotonic signals.
- A blocker appears with persistent orange/text icon, no repeated shaking or flashing; when resolved, transition to ready ≤160 ms.
- Disclosure of job details uses ≤180 ms reveal and retains scroll/focus; low-priority work does not animate continuously.
- Storage meter changes only from real values and has a text equivalent, including over-budget protected assets.

## Alternatives, trade-offs and limits

Prefer semantic, truthful feedback over cosmetic animation; static UI is better than invented musical evidence, gratuitous movement or a delayed critical control. Where visual polish conflicts with accurate playback, scope/revision identity, accessibility or control, behavior and safety win. Do not add runtime dependencies, processing APIs, telemetry or new audio assets under this documentation decision.

## Implementation tasks - 2 source-level Implemented, 0 independently Verified

1. **MI-0156-01 - Define operations information priority.** Acceptance: What needs action first; routine work is secondary. Required verification: User triage comprehension test. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: runtime/source contract and mapped implementation evidence in `docs/adr/selecta-microinteraction-final-contracts.md`; applicable independent human/device/audio review remains open.**
2. **MI-0156-02 - Specify honest job states.** Acceptance: Queued/working/paused/blocked/failed and estimates never conflated. Required verification: Job fixture matrix and late-status checks. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: runtime/source contract and mapped implementation evidence in `docs/adr/selecta-microinteraction-final-contracts.md`; applicable independent human/device/audio review remains open.**
3. **MI-0156-03 - Visualize resource priority.** Acceptance: Current mix/draft/analysis/spare order explained when delayed. Required verification: Worker scheduling and status E2E. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: runtime/source contract and mapped implementation evidence in `docs/adr/selecta-microinteraction-final-contracts.md`; applicable independent human/device/audio review remains open.**
4. **MI-0156-04 - Design storage budget interactions.** Acceptance: Slider reports actual GB, protection and safe-free-space consequences. Required verification: Boundary and low-disk tests. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: runtime/source contract and mapped implementation evidence in `docs/adr/selecta-microinteraction-final-contracts.md`; applicable independent human/device/audio review remains open.**
5. **MI-0156-05 - Protect source-watch semantics.** Acceptance: Missing/unwatched folders never imply original file deletion. Required verification: Folder disconnect and re-add tests. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `web/src/views/WorkshopPanels.tsx`; `web/src/views/Workshop.test.tsx`; independent checks pending.**
6. **MI-0156-06 - Specify diagnostics affordances.** Acceptance: Copy payload excludes names/paths and raw logs appear on demand. Required verification: Privacy allowlist and AT tests. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `web/src/views/WorkshopPanels.tsx`; `web/src/views/Workshop.test.tsx`; independent checks pending.**
7. **MI-0156-07 - Keep keyboard/mobile operations reachable.** Acceptance: Source forms and meters work under keyboard/zoom. Required verification: 320px and on-screen keyboard tests. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: runtime/source contract and mapped implementation evidence in `docs/adr/selecta-microinteraction-final-contracts.md`; applicable independent human/device/audio review remains open.**
8. **MI-0156-08 - Measure operator recovery.** Acceptance: People resolve analysis/storage/source errors without coaching. Required verification: Injected error study with success denominator. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: -; evidence: -.**

## Shared invariants and negative cases

Preserve original audio files; current/draft and revision identities; one audio-focus owner; manual Pause authority; explicit bridge consent and atomic join; full eight-lane Studio; existing library/route/search operations; blind-study neutrality; decodable exact-revision FLAC; local-only server and truthful LRCLIB metadata disclosure. **No desktop packager, native/browser folder-picker bridge, accounts, SaaS, cloud media upload, subscriptions, remote telemetry or sound effects.**

Review idle, hovered, focused, pressed, selected, queued, rendering, ready, blocked, failed, retry, cancellation, stale response, missing metadata, long/RTL names, low-resource mode and offline recovery. Run dark/light/system, forced colors, 320–2560px, 200/400% zoom, coarse touch, keyboard, NVDA/Edge, reduced-motion and audio-continuity checks as applicable. Automated screenshots/test passes are not human validation.

## Status, dependencies and records

PR #31 records code implementation with referenced source and automation. **Implemented is not independently Verified**; a named reviewer must still record all required real-world theme, accessibility, audio, performance and user results before Yes or owner Acceptance. [Immersive programme roadmap](selecta-microinteraction-roadmap.md) · [240-task checklist](selecta-microinteraction-implementation-checklist.md) · [evidence ledger](selecta-microinteraction-evidence.md) · [state and motion matrix](selecta-microinteraction-motion-matrix.md) · [release gates](selecta-microinteraction-release-gates.md).
