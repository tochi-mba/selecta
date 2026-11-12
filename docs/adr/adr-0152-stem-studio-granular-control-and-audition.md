# ADR-0152 - Stem Studio: physical grid feel, audible preview, precision and recovery

- **Decision:** Accepted by the repository owner on 2026-11-07; implementation and independent verification remain separately evidenced.
- **Implementation:** 7/8 Implemented, 1/8 In progress, 0 Not started (source-level, PR #31).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta immersive experience and microinteractions; 2026-11-07; main `525a49cee6b0a02cae7e71dbe3f336a0141ec2d7` (after merged PR #30).
- **Priority / phase:** P0 / Studio.
- **Related earlier ADRs:** ADR-0122, ADR-0102, ADR-0132; earlier decisions and historical implementation claims remain intact.
- **Source touchpoints:** web/src/views/Studio.tsx; web/src/ui/primitives.tsx; web/src/styles/creation.css.

## Context and evidence boundary

Studio exposes up to eight lanes with 8–64 time cells, Shape, Detailed Grid, Detailed List and AI assistance. It needs instrument-like responsiveness without representing discrete on/off cells as continuous audio automation. This is a **new experience delta** to existing code and ADR-0114–0134, not a claim that existing implementations are missing. PR #31 includes source-level implementation and tests, but this proposal remains owner-unaccepted and independently unverified. Human visual, audio, screen-reader, touch and comprehension results are not asserted.

## Proposed decision

- Preserve all eight lanes for outgoing/incoming voice, drums, bass and melody; keep Shape and detailed representations losslessly synchronized.
- Every cell operation has immediate local feedback and visible unsaved status while actual rendered result is pending.
- Separate Solo Preview, preview the full seam, Apply and AI-assisted arrangement; labels reflect the exact affected artifact.
- A user may ask Selecta to arrange a blank idea or refine their changes without the UI silently discarding authored cells.
- Grid drag/paint behavior must be explicit and reversible, with keyboard and list alternatives on all viewports.
- Audio previews never fabricate an audible result, and no preview interrupts intentional manual Pause.

## Interaction choreography and visual behavior

- Cell toggles ≤100 ms on press; rows never ripple automatically in imitation of a beat.
- While auditioning, a thin time cursor tracks real preview time; it stops immediately on Stop, pause or audio failure.
- Selecting an AI arrangement shows an exact pending operation, not a made-up growing waveform; changed grid appears only from returned data.
- When switching Shape/Grid/List, preserve logical cell focus or announce target mapping; no animated transformation that loses controls.

## Alternatives, trade-offs and limits

Prefer semantic, truthful feedback over cosmetic animation; static UI is better than invented musical evidence, gratuitous movement or a delayed critical control. Where visual polish conflicts with accurate playback, scope/revision identity, accessibility or control, behavior and safety win. Do not add runtime dependencies, processing APIs, telemetry or new audio assets under this documentation decision.

## Implementation tasks - 5 source-level Implemented, 0 independently Verified

1. **MI-0152-01 - Define eight-lane cell feedback.** Acceptance: On/off/solo/muted/failed/loading/unsaved states separately marked. Required verification: 64-cell accessibility and visual fixture. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: named eight-lane cell states and audio-clock-owned preview mapped in the surface contract to Studio/studio/audio-focus fixtures; real-audio review remains open.**
2. **MI-0152-02 - Specify grid painting and keyboard parity.** Acceptance: Each operation reproducible without drag and retains row/column identity. Required verification: Touch, keyboard and NVDA/Edge tests. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `web/src/views/Studio.tsx`, `web/src/styles/creation.css`; `web/src/views/Studio.test.tsx`; independent checks pending.**
3. **MI-0152-03 - Design preview and timeline cursor.** Acceptance: Cursor derived from actual rendered audio/clock and stops reliably. Required verification: Audio focus and timing tests. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: named eight-lane cell states and audio-clock-owned preview mapped in the surface contract to Studio/studio/audio-focus fixtures; real-audio review remains open.**
4. **MI-0152-04 - Preserve mode-switch data.** Acceptance: Shape/Grid/List round trip does not modify unrepresented cells. Required verification: Property-based state roundtrip tests. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `web/src/views/Studio.tsx`, `web/src/styles/creation.css`; `web/src/views/Studio.test.tsx`; independent checks pending.**
5. **MI-0152-05 - Protect AI-assist intent.** Acceptance: Arrange and fine tune operate on exact snapshot and never discard later edits. Required verification: Stale generation/revision race. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `web/src/views/Studio.tsx`, `web/src/styles/creation.css`; `web/src/views/Studio.test.tsx`; independent checks pending.**
6. **MI-0152-06 - Clarify apply and browser recovery.** Acceptance: Unsaved, recovered, applied and rendered are distinct; rollback safe. Required verification: Local storage failure and retry fixtures. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `web/src/views/Studio.tsx`, `web/src/styles/creation.css`; `web/src/views/Studio.test.tsx`; independent checks pending.**
7. **MI-0152-07 - Handle small screens without loss.** Acceptance: Sticky lane labels and horizontal scroll with meaningful context. Required verification: 320px, coarse-pointer and 400% zoom. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `web/src/views/Studio.tsx`, `web/src/styles/creation.css`; `web/src/views/Studio.test.tsx`; independent checks pending.**
8. **MI-0152-08 - Measure creator prediction.** Acceptance: Users can anticipate sound from changed cells and improve a seam. Required verification: Before/after listening and task study. **Implementation: In progress; Verified: No; owner: Unassigned; PR/SHA: feat/finish-checklists-2 @ \779bd3c\ (WIP, 2026-11-12); evidence: code part built on 2026-11-12: a Studio sheet recording the predicted sound and the before and after 1 to 5 ratings for each seam change, in `src/selecta/audit/mi_study_kit.py` (`python -m selecta.audit.mi_study_kit sheet|check|summary MI-0152-08`) and the study kit section of `docs/adr/selecta-microinteraction-verification-protocols.md`; `tests/test_mi_study_kit.py` 33/33 passed on 2026-11-12. Left In progress and unticked: the acceptance is the people's result, which code cannot produce, and ticking would drop the task from the owner runbook. Needs a person: run a before and after listening task where users predict the sound of changed Studio cells and improve a seam, recorded in a kit record that passes `check`.**

## Shared invariants and negative cases

Preserve original audio files; current/draft and revision identities; one audio-focus owner; manual Pause authority; explicit bridge consent and atomic join; full eight-lane Studio; existing library/route/search operations; blind-study neutrality; decodable exact-revision FLAC; local-only server and truthful LRCLIB metadata disclosure. **No desktop packager, native/browser folder-picker bridge, accounts, SaaS, cloud media upload, subscriptions, remote telemetry or sound effects.**

Review idle, hovered, focused, pressed, selected, queued, rendering, ready, blocked, failed, retry, cancellation, stale response, missing metadata, long/RTL names, low-resource mode and offline recovery. Run dark/light/system, forced colors, 320–2560px, 200/400% zoom, coarse touch, keyboard, NVDA/Edge, reduced-motion and audio-continuity checks as applicable. Automated screenshots/test passes are not human validation.

## Status, dependencies and records

PR #31 records code implementation with referenced source and automation. **Implemented is not independently Verified**; a named reviewer must still record all required real-world theme, accessibility, audio, performance and user results before Yes or owner Acceptance. [Immersive programme roadmap](selecta-microinteraction-roadmap.md) · [240-task checklist](selecta-microinteraction-implementation-checklist.md) · [evidence ledger](selecta-microinteraction-evidence.md) · [state and motion matrix](selecta-microinteraction-motion-matrix.md) · [release gates](selecta-microinteraction-release-gates.md).
