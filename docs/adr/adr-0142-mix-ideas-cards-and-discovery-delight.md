# ADR-0142 — Mix-idea cards, meaningful recommendation reveals and selection confidence

- **Decision:** Accepted by the repository owner on 2026-11-07; implementation and independent verification remain separately evidenced.
- **Implementation:** 7/8 Implemented, 0/8 In progress, 1 Not started (source-level, PR #31).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta immersive experience and microinteractions; 2026-11-07; main `525a49cee6b0a02cae7e71dbe3f336a0141ec2d7` (after merged PR #30).
- **Priority / phase:** P1 / Make a Mix.
- **Related earlier ADRs:** ADR-0117, ADR-0118, ADR-0125; earlier decisions and historical implementation claims remain intact.
- **Source touchpoints:** web/src/views/Mixes.tsx; web/src/views/Links.tsx; web/src/styles/listening.css.

## Context and evidence boundary

Make a Mix presents Selecta's pick, categories and Play/Edit/Save. The experience should feel like a DJ making a confident invitation rather than a spreadsheet of settings and unproven suggestions. This is a **new experience delta** to existing code and ADR-0114–0134, not a claim that existing implementations are missing. PR #31 includes source-level implementation and tests, but this proposal remains owner-unaccepted and independently unverified. Human visual, audio, screen-reader, touch and comprehension results are not asserted.

## Proposed decision

- Lead with one high-confidence, grounded musical idea and a Play-first action; keep Edit first and Save draft clearly accessible.
- Reveal supporting artist examples and authentic readiness only after the musical proposition is understandable.
- Cards may show lightweight hover/focus feedback, but never autoplay music, animate arbitrary BPM indicators or fabricate artwork.
- Loading cards should preserve eventual layout and include explicit unavailable, sparse-library and stale-data states.
- Treat short audio preview as feasibility gated: only actually rendered, correctly scoped audio, with the shared audio owner and no fake preview.
- Let card selection feel reversible: before consequential activation, choices remain safe to explore; replacement asks for explicit confirmation.

## Interaction choreography and visual behavior

- Hero enters once with ≤220 ms opacity/translate after genuine content load; offscreen cards need not animate.
- Card hover/focus uses 100–140 ms border/emphasis; no lift >2 px and no moving target during click.
- Category filtering/selection uses ≤180 ms local reveal while preserving scroll and focus.
- Selected mix preview control, when real, immediately marks ownership and switches to Stop without autoplay.

## Alternatives, trade-offs and limits

Prefer semantic, truthful feedback over cosmetic animation; static UI is better than invented musical evidence, gratuitous movement or a delayed critical control. Where visual polish conflicts with accurate playback, scope/revision identity, accessibility or control, behavior and safety win. Do not add runtime dependencies, processing APIs, telemetry or new audio assets under this documentation decision.

## Implementation tasks — 1 source-level Implemented, 0 independently Verified

1. **MI-0142-01 — Define featured-card hierarchy.** Acceptance: Music identity/mood, duration and primary action are visually obvious. Required verification: Uncoached choice confidence and screenshot study. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: Mix ideas hierarchy/outcomes/loading/category/audition/density mapped in `selecta-microinteraction-surface-contracts.md` to `Mixes.tsx`, `MixSetup.tsx` and fixtures.**
2. **MI-0142-02 — Preserve three action outcomes.** Acceptance: Play/Edit/Save remain keyboard- and touch-accessible with accurate consequences. Required verification: Current/draft E2E assertions. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: Mix ideas hierarchy/outcomes/loading/category/audition/density mapped in `selecta-microinteraction-surface-contracts.md` to `Mixes.tsx`, `MixSetup.tsx` and fixtures.**
3. **MI-0142-03 — Specify loading and missing metadata.** Acceptance: No invented artists, durations, score, artwork or stale ready status. Required verification: Empty/partial/error fixture. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: Mix ideas hierarchy/outcomes/loading/category/audition/density mapped in `selecta-microinteraction-surface-contracts.md` to `Mixes.tsx`, `MixSetup.tsx` and fixtures.**
4. **MI-0142-04 — Define category transition behavior.** Acceptance: Switching category retains location and never changes playback. Required verification: Back/Forward and focus tests. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: Mix ideas hierarchy/outcomes/loading/category/audition/density mapped in `selecta-microinteraction-surface-contracts.md` to `Mixes.tsx`, `MixSetup.tsx` and fixtures.**
5. **MI-0142-05 — Gate authentic audition.** Acceptance: Preview requires real rendered revision and one audio owner; otherwise absent. Required verification: Audio provenance and focus test. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: Mix ideas hierarchy/outcomes/loading/category/audition/density mapped in `selecta-microinteraction-surface-contracts.md` to `Mixes.tsx`, `MixSetup.tsx` and fixtures.**
6. **MI-0142-06 — Design replacement confirmation.** Acceptance: Existing mix preserved on cancel or failure, no double activation. Required verification: Delayed API and rollback test. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31 @ `89641b6a1b81`; evidence: `web/src/views/Mixes.tsx`; `web/src/views/Mixes.test.tsx`; independent checks pending.**
7. **MI-0142-07 — Verify contrast and density.** Acceptance: Cards remain readable across both themes and narrow screens. Required verification: 320–2560 and zoom gallery. **Implementation: Implemented; Verified: No; owner: Unassigned; PR/SHA: PR #31; evidence: Mix ideas hierarchy/outcomes/loading/category/audition/density mapped in `selecta-microinteraction-surface-contracts.md` to `Mixes.tsx`, `MixSetup.tsx` and fixtures.**
8. **MI-0142-08 — Measure recommendation understanding.** Acceptance: Record whether users can predict what Play, Edit first and Save do. Required verification: Counterbalanced task study with raw counts. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**

## Shared invariants and negative cases

Preserve original audio files; current/draft and revision identities; one audio-focus owner; manual Pause authority; explicit bridge consent and atomic join; full eight-lane Studio; existing library/route/search operations; blind-study neutrality; decodable exact-revision FLAC; local-only server and truthful LRCLIB metadata disclosure. **No desktop packager, native/browser folder-picker bridge, accounts, SaaS, cloud media upload, subscriptions, remote telemetry or sound effects.**

Review idle, hovered, focused, pressed, selected, queued, rendering, ready, blocked, failed, retry, cancellation, stale response, missing metadata, long/RTL names, low-resource mode and offline recovery. Run dark/light/system, forced colors, 320–2560px, 200/400% zoom, coarse touch, keyboard, NVDA/Edge, reduced-motion and audio-continuity checks as applicable. Automated screenshots/test passes are not human validation.

## Status, dependencies and records

PR #31 records code implementation with referenced source and automation. **Implemented is not independently Verified**; a named reviewer must still record all required real-world theme, accessibility, audio, performance and user results before Yes or owner Acceptance. [Immersive programme roadmap](selecta-microinteraction-roadmap.md) · [240-task checklist](selecta-microinteraction-implementation-checklist.md) · [evidence ledger](selecta-microinteraction-evidence.md) · [state and motion matrix](selecta-microinteraction-motion-matrix.md) · [release gates](selecta-microinteraction-release-gates.md).
