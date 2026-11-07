# ADR-0145 — Transport precision: play, pause, seeking, jump and honest progress

- **Decision:** Proposed; no owner acceptance is asserted.
- **Implementation:** Not started (0/8 new MI tasks).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta immersive experience and microinteractions; 2026-11-07; main `525a49cee6b0a02cae7e71dbe3f336a0141ec2d7` (after merged PR #30).
- **Priority / phase:** P0 / Listen.
- **Related earlier ADRs:** ADR-0116, ADR-0093, ADR-0137; earlier decisions and historical implementation claims remain intact.
- **Source touchpoints:** web/src/views/Now.tsx; web/src/player.ts; web/src/shell/Shell.tsx.

## Context and evidence boundary

The Web Audio player manages source buffers, seam scheduling and fallback. Progress and transport controls should look alive without masking a blocked seek, a changing track or an unrendered transition. This is a **new experience delta** to existing code and ADR-0114–0134, not a claim that existing implementations are missing. No proposed behavior is shipped by merging these documents. Human visual, audio, screen-reader, touch and comprehension results are not asserted.

## Proposed decision

- Play/Pause always responds to immediate user intent, with loading distinct from silence, error and paused.
- Scrub preview shows an accurately formatted target time before seeking; seek confirmation follows actual player state, not pointer position alone.
- Prevent invalid seeks into transition-only, not-yet-prepared or unsupported regions, with a reason and an alternate reachable action.
- Keep skip-to-transition separate from Next song, with a clear description of the different outcomes.
- Provide visible progress and volume without moving transport targets as titles, times or player phases change.
- Never visually show an accurate beat or bar countdown when the analysis or rendered seam is unavailable.

## Interaction choreography and visual behavior

- Play/Pause glyph changes in 80–120 ms, but semantic phase changes immediately; no celebratory bounce.
- Progress follows the actual clock; no CSS ease causing the indicator to run past real audio. Scrub ghost marker follows the input directly.
- Seeking may show a local ≤160 ms confirmation; if rejected, marker returns to actual time without falsely changing song identity.
- For bars remaining, number transitions are quiet and only derived from verified timing; no sweeping pulse synced to guessed beats.

## Alternatives, trade-offs and limits

Prefer semantic, truthful feedback over cosmetic animation; static UI is better than invented musical evidence, gratuitous movement or a delayed critical control. Where visual polish conflicts with accurate playback, scope/revision identity, accessibility or control, behavior and safety win. Do not add runtime dependencies, processing APIs, telemetry or new audio assets under this documentation decision.

## Implementation tasks — all Not started, none Verified

1. **MI-0145-01 — Audit transport state labels.** Acceptance: Loading, playing, paused, idle, buffering, seam and blocked distinguishable. Required verification: Web Audio fixtures and screen-reader names. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
2. **MI-0145-02 — Design scrubbing preview.** Acceptance: Target time and allowed region clear before commit, with reversible cancel. Required verification: Pointer, keyboard and touch seek tests. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
3. **MI-0145-03 — Handle blocked seek honestly.** Acceptance: No false time jump, warning names why and suggests a valid action. Required verification: Seam-loading/fallback fixtures. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
4. **MI-0145-04 — Differentiate Next and jump-to-seam.** Acceptance: Labels and icons predict distinct behavior uncoached. Required verification: Listener task study and actual player test. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
5. **MI-0145-05 — Preserve geometry across states.** Acceptance: Play/skip/time controls do not move when phase or labels update. Required verification: 320–1440 visual diff. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
6. **MI-0145-06 — Specify timeline accuracy.** Acceptance: Displayed progress does not get ahead of the Web Audio clock. Required verification: Clock synchronization tests. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
7. **MI-0145-07 — Guard high-frequency updates.** Acceptance: No repeated aria-live time chatter or >200ms interaction lag. Required verification: AT review and performance trace. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
8. **MI-0145-08 — Verify multi-tab/media key parity.** Acceptance: Headphone, media-session and keyboard actions obey same authority. Required verification: Cross-tab/browser and real audio test. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**

## Shared invariants and negative cases

Preserve original audio files; current/draft and revision identities; one audio-focus owner; manual Pause authority; explicit bridge consent and atomic join; full eight-lane Studio; existing library/route/search operations; blind-study neutrality; decodable exact-revision FLAC; local-only server and truthful LRCLIB metadata disclosure. **No desktop packager, native/browser folder-picker bridge, accounts, SaaS, cloud media upload, subscriptions, remote telemetry or sound effects.**

Review idle, hovered, focused, pressed, selected, queued, rendering, ready, blocked, failed, retry, cancellation, stale response, missing metadata, long/RTL names, low-resource mode and offline recovery. Run dark/light/system, forced colors, 320–2560px, 200/400% zoom, coarse touch, keyboard, NVDA/Edge, reduced-motion and audio-continuity checks as applicable. Automated screenshots/test passes are not human validation.

## Status, dependencies and records

A later implementing PR must provide a task-specific diff, source file, test ID, exact SHA and separately recorded human evidence before advancing **Implemented** or **Verified**. Owner decision must be recorded before **Accepted**. [Immersive programme roadmap](selecta-microinteraction-roadmap.md) · [240-task checklist](selecta-microinteraction-implementation-checklist.md) · [evidence ledger](selecta-microinteraction-evidence.md) · [state and motion matrix](selecta-microinteraction-motion-matrix.md) · [release gates](selecta-microinteraction-release-gates.md).
