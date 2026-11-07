# ADR-0150 — Arrangement timeline: tactile song movement, insertions, locks and focus

- **Decision:** Proposed; no owner acceptance is asserted.
- **Implementation:** Not started (0/8 new MI tasks).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta immersive experience and microinteractions; 2026-11-07; main `525a49cee6b0a02cae7e71dbe3f336a0141ec2d7` (after merged PR #30).
- **Priority / phase:** P0 / Editor.
- **Related earlier ADRs:** ADR-0120, ADR-0100, ADR-0132; earlier decisions and historical implementation claims remain intact.
- **Source touchpoints:** web/src/views/Mix.tsx; web/src/views/EditorRows.tsx; web/src/styles/creation.css.

## Context and evidence boundary

Editor song rows and seam rows are distinct objects. Drag and drop can make arranging musical sequences feel tactile, but cannot outpace mutation guards, break scroll or become the only usable method. This is a **new experience delta** to existing code and ADR-0114–0134, not a claim that existing implementations are missing. No proposed behavior is shipped by merging these documents. Human visual, audio, screen-reader, touch and comprehension results are not asserted.

## Proposed decision

- Maintain clear song/transition difference, stable positions and selected-object inspector continuity.
- Drag only begins from the explicit handle, never from ordinary row scroll; pointer capture and cancellation remain predictable.
- Display a single exact insertion target between tracks, not multiple competing animated gaps.
- Lock changes show persistent semantics and clearly state what the lock preserves during rebuild.
- On keyboard reorder, announce picked-up, moved and dropped positions; preserve focus after a confirmed update.
- Do not move the actual playing song unexpectedly when unrelated future songs are edited.

## Interaction choreography and visual behavior

- Picked-up row gains a non-color cue, small shadow/outline, no scale that obscures targets.
- Drop indicator follows nearest valid insertion slot; after server confirmation, rows settle within 120–180 ms.
- Invalid/rejected move returns to original position with explicit reason and no fake success.
- Locked status icon changes within 120 ms; never pulses indefinitely or implies all neighboring seams are locked.

## Alternatives, trade-offs and limits

Prefer semantic, truthful feedback over cosmetic animation; static UI is better than invented musical evidence, gratuitous movement or a delayed critical control. Where visual polish conflicts with accurate playback, scope/revision identity, accessibility or control, behavior and safety win. Do not add runtime dependencies, processing APIs, telemetry or new audio assets under this documentation decision.

## Implementation tasks — all Not started, none Verified

1. **MI-0150-01 — Define song/seam selection grammar.** Acceptance: Inspector knows selected stable ID across edits. Required verification: 100-song fixture and selection tests. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
2. **MI-0150-02 — Specify pointer drag lifecycle.** Acceptance: Handle start, drag threshold, valid drop, cancel and scroll noninterference. Required verification: Coarse-touch and pointer E2E. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
3. **MI-0150-03 — Design exact insertion affordances.** Acceptance: Add between named songs without accidental final-position ambiguity. Required verification: Long timeline task trial. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
4. **MI-0150-04 — Specify keyboard reorder parity.** Acceptance: Pick/move/drop or up/down complete same mutation as pointer. Required verification: NVDA/Edge and keyboard tests. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
5. **MI-0150-05 — Protect locks and scope.** Acceptance: Lock semantics precise, current/draft guard cannot be crossed. Required verification: Concurrent edit/rebuild assertions. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
6. **MI-0150-06 — Guard stale mutations during animation.** Acceptance: Server rejects changed order; UI restores original without ghost row. Required verification: Delayed mutation and offline test. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
7. **MI-0150-07 — Prevent long-list layout shifts.** Acceptance: Virtualized/contained rows reveal menus and keep scroll context. Required verification: 100-song and 200/400% zoom. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
8. **MI-0150-08 — Evaluate arrangement fluency.** Acceptance: Users complete move, insert, remove, lock and Undo without coaching. Required verification: Task success/error and measured effort. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**

## Shared invariants and negative cases

Preserve original audio files; current/draft and revision identities; one audio-focus owner; manual Pause authority; explicit bridge consent and atomic join; full eight-lane Studio; existing library/route/search operations; blind-study neutrality; decodable exact-revision FLAC; local-only server and truthful LRCLIB metadata disclosure. **No desktop packager, native/browser folder-picker bridge, accounts, SaaS, cloud media upload, subscriptions, remote telemetry or sound effects.**

Review idle, hovered, focused, pressed, selected, queued, rendering, ready, blocked, failed, retry, cancellation, stale response, missing metadata, long/RTL names, low-resource mode and offline recovery. Run dark/light/system, forced colors, 320–2560px, 200/400% zoom, coarse touch, keyboard, NVDA/Edge, reduced-motion and audio-continuity checks as applicable. Automated screenshots/test passes are not human validation.

## Status, dependencies and records

A later implementing PR must provide a task-specific diff, source file, test ID, exact SHA and separately recorded human evidence before advancing **Implemented** or **Verified**. Owner decision must be recorded before **Accepted**. [Immersive programme roadmap](selecta-microinteraction-roadmap.md) · [240-task checklist](selecta-microinteraction-implementation-checklist.md) · [evidence ledger](selecta-microinteraction-evidence.md) · [state and motion matrix](selecta-microinteraction-motion-matrix.md) · [release gates](selecta-microinteraction-release-gates.md).
