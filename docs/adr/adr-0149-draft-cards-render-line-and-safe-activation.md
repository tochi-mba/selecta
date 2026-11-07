# ADR-0149 — My Mixes: draft identities, render-line motion and safe activation

- **Decision:** Proposed; no owner acceptance is asserted.
- **Implementation:** Not started (0/8 new MI tasks).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta immersive experience and microinteractions; 2026-11-07; main `525a49cee6b0a02cae7e71dbe3f336a0141ec2d7` (after merged PR #30).
- **Priority / phase:** P1 / My Mixes.
- **Related earlier ADRs:** ADR-0119, ADR-0099, ADR-0131; earlier decisions and historical implementation claims remain intact.
- **Source touchpoints:** web/src/views/Drafts.tsx; web/src/views/MyMixes.tsx; web/src/views/CurrentMix.tsx.

## Context and evidence boundary

Current mix, drafts and the render line represent different things. Visual changes must keep source identity and processing priority clear, even when drafts are renamed, deleted, restored or activated. This is a **new experience delta** to existing code and ADR-0114–0134, not a claim that existing implementations are missing. No proposed behavior is shipped by merging these documents. Human visual, audio, screen-reader, touch and comprehension results are not asserted.

## Proposed decision

- Treat the current mix as a live object and drafts as independent saved artifacts; visibly distinguish scope before destructive actions.
- Present readiness as transitions prepared out of total, not a false percentage of music quality.
- A draft Play action confirms what happens to current playback and that previous playing material is preserved.
- Render-line reorder only changes preparation priority, never song order or the playing queue.
- Rename, duplicate, delete and restore must provide precise feedback and not reorder other cards unexpectedly.
- Keep new and empty states inviting without fabricated playlists or unrelated call-to-action noise.

## Interaction choreography and visual behavior

- Draft-card hover/focus ≤120 ms; expansion doesn't cause nearby action targets to jump.
- Render-line drag/move communicates placeholder position and settles ≤180 ms after confirmed change; no movement until the server's result is reconciled.
- Delete uses short ≤160 ms collapse only after confirmed deletion, with Undo remaining visible in Activity.
- Readiness counters change on authoritative job updates, no indeterminate pulse for a blocked job.

## Alternatives, trade-offs and limits

Prefer semantic, truthful feedback over cosmetic animation; static UI is better than invented musical evidence, gratuitous movement or a delayed critical control. Where visual polish conflicts with accurate playback, scope/revision identity, accessibility or control, behavior and safety win. Do not add runtime dependencies, processing APIs, telemetry or new audio assets under this documentation decision.

## Implementation tasks — all Not started, none Verified

1. **MI-0149-01 — Define current/draft visual identity.** Acceptance: Scope is legible before Play/Edit/Delete and in breadcrumbs. Required verification: Current/draft comprehension tests. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
2. **MI-0149-02 — Choreograph safe Play activation.** Acceptance: Explicit replacement consent and preservation of previous mix. Required verification: Cancel, stale-revision and live audio tests. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
3. **MI-0149-03 — Specify draft card actions.** Acceptance: Rename/copy/delete/restore are stable, keyboard-reachable and scoped. Required verification: Draft workflow E2E. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
4. **MI-0149-04 — Design render-line sorting feedback.** Acceptance: Reorder changes processing priority only and keeps keyboard alternatives. Required verification: Server queue vs song-order assertions. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
5. **MI-0149-05 — Implementable readiness microstates.** Acceptance: Queued/rendering/ready/failed counts and errors truthful. Required verification: Job fixture and delayed status test. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
6. **MI-0149-06 — Handle list transitions at scale.** Acceptance: Large draft list scroll stable during sort, search and removal. Required verification: 50+ draft and mobile tests. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
7. **MI-0149-07 — Keep Undo durable enough for task.** Acceptance: Toast loss does not erase in-session Activity restoration. Required verification: Toast expiry/recovery tests. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
8. **MI-0149-08 — Validate typography and density.** Acceptance: Long names, duplicate names and compact rows retain actionable labels. Required verification: RTL/zoom/forced-color screenshots. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**

## Shared invariants and negative cases

Preserve original audio files; current/draft and revision identities; one audio-focus owner; manual Pause authority; explicit bridge consent and atomic join; full eight-lane Studio; existing library/route/search operations; blind-study neutrality; decodable exact-revision FLAC; local-only server and truthful LRCLIB metadata disclosure. **No desktop packager, native/browser folder-picker bridge, accounts, SaaS, cloud media upload, subscriptions, remote telemetry or sound effects.**

Review idle, hovered, focused, pressed, selected, queued, rendering, ready, blocked, failed, retry, cancellation, stale response, missing metadata, long/RTL names, low-resource mode and offline recovery. Run dark/light/system, forced colors, 320–2560px, 200/400% zoom, coarse touch, keyboard, NVDA/Edge, reduced-motion and audio-continuity checks as applicable. Automated screenshots/test passes are not human validation.

## Status, dependencies and records

A later implementing PR must provide a task-specific diff, source file, test ID, exact SHA and separately recorded human evidence before advancing **Implemented** or **Verified**. Owner decision must be recorded before **Accepted**. [Immersive programme roadmap](selecta-microinteraction-roadmap.md) · [240-task checklist](selecta-microinteraction-implementation-checklist.md) · [evidence ledger](selecta-microinteraction-evidence.md) · [state and motion matrix](selecta-microinteraction-motion-matrix.md) · [release gates](selecta-microinteraction-release-gates.md).
