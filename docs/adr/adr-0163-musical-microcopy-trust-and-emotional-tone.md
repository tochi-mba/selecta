# ADR-0163 — Musical microcopy, consent, explanations and the personality of a good DJ

- **Decision:** Proposed; no owner acceptance is asserted.
- **Implementation:** Not started (0/8 new MI tasks).
- **Independent verification:** No (0/8).
- **Programme/date/baseline:** Selecta immersive experience and microinteractions; 2026-11-07; main `525a49cee6b0a02cae7e71dbe3f336a0141ec2d7` (after merged PR #30).
- **Priority / phase:** P1 / Product language.
- **Related earlier ADRs:** ADR-0027, ADR-0044, ADR-0131; earlier decisions and historical implementation claims remain intact.
- **Source touchpoints:** web/src/views/MixSetup.tsx; web/src/views/Requests.tsx; web/src/views/Now.tsx; web/src/views/WorkshopPanels.tsx.

## Context and evidence boundary

Selecta's language can make autonomy feel helpful or make the product seem opaque. A DJ-like voice is compelling only when it remains truthful, concise and free from patronizing or inflated claims about musical quality. This is a **new experience delta** to existing code and ADR-0114–0134, not a claim that existing implementations are missing. No proposed behavior is shipped by merging these documents. Human visual, audio, screen-reader, touch and comprehension results are not asserted.

## Proposed decision

- Use intent language for listener controls: Bigger, Calmer, Something else, Take me to; explain technical effects on demand.
- Separate 'I found a candidate', 'I rendered it', 'checks passed' and 'you liked it' rather than implying an algorithm proved artistic excellence.
- Every risky action explains object and scope: current mix versus draft, add versus replace, preview versus live player, render line versus song order.
- Requests explain expected uncertainty without inventing fixed arrival time or promising compatibility.
- Offer delightful microcopy in authentic milestones (first ready mix, unexpected connection, saved file) but avoid forced personification or repetitive praise.
- Never claim complete privacy if lyric metadata is sent to LRCLIB; source safety and actual network behavior remain clearly stated.

## Interaction choreography and visual behavior

- Microcopy reveals with the status it explains; no typing animation, fake 'DJ thinking' dots or anthropomorphic idle behavior.
- Milestone copy appears once after verified event and remains readable without a timed disappearance if actionable.
- Error text stays still and specific; avoid shake effects or red flashes.
- Long-form technical explanations open on user request, with no automatic expanding under active listening.

## Alternatives, trade-offs and limits

Prefer semantic, truthful feedback over cosmetic animation; static UI is better than invented musical evidence, gratuitous movement or a delayed critical control. Where visual polish conflicts with accurate playback, scope/revision identity, accessibility or control, behavior and safety win. Do not add runtime dependencies, processing APIs, telemetry or new audio assets under this documentation decision.

## Implementation tasks — all Not started, none Verified

1. **MI-0163-01 — Define controlled product lexicon.** Acceptance: Seam/handoff/transition, request/queue/render line and source/draft distinctions documented. Required verification: Content inventory review. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
2. **MI-0163-02 — Write action consequence templates.** Acceptance: Every destructive and playback-affecting action names its scope. Required verification: Cross-surface string audit. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
3. **MI-0163-03 — Define AI truth-language tiers.** Acceptance: Candidate, prepared, checked and human-rated never conflated. Required verification: Rendered/fallback and discovery fixtures. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
4. **MI-0163-04 — Specify request uncertainty copy.** Acceptance: No guaranteed placement or ETA without actual evidence. Required verification: Waiting/bridge/failed route study. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
5. **MI-0163-05 — Write milestone copy only for real events.** Acceptance: First playable mix, confirmed handoff and completed file earned. Required verification: Event-log correlation test. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
6. **MI-0163-06 — Audit privacy claims.** Acceptance: LRCLIB metadata, local files, diagnostics and export statements accurate. Required verification: Backend/privacy crosscheck. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
7. **MI-0163-07 — Localize-ready language review.** Acceptance: Pluralization, units, RTL and translated text expansion remain accessible. Required verification: Internationalized fixtures. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**
8. **MI-0163-08 — Measure confidence and tone.** Acceptance: Users understand actions and find copy respectful, not robotic or noisy. Required verification: Uncoached comprehension and preference review. **Implementation: Not started; Verified: No; owner: Unassigned; PR/SHA: —; evidence: —.**

## Shared invariants and negative cases

Preserve original audio files; current/draft and revision identities; one audio-focus owner; manual Pause authority; explicit bridge consent and atomic join; full eight-lane Studio; existing library/route/search operations; blind-study neutrality; decodable exact-revision FLAC; local-only server and truthful LRCLIB metadata disclosure. **No desktop packager, native/browser folder-picker bridge, accounts, SaaS, cloud media upload, subscriptions, remote telemetry or sound effects.**

Review idle, hovered, focused, pressed, selected, queued, rendering, ready, blocked, failed, retry, cancellation, stale response, missing metadata, long/RTL names, low-resource mode and offline recovery. Run dark/light/system, forced colors, 320–2560px, 200/400% zoom, coarse touch, keyboard, NVDA/Edge, reduced-motion and audio-continuity checks as applicable. Automated screenshots/test passes are not human validation.

## Status, dependencies and records

A later implementing PR must provide a task-specific diff, source file, test ID, exact SHA and separately recorded human evidence before advancing **Implemented** or **Verified**. Owner decision must be recorded before **Accepted**. [Immersive programme roadmap](selecta-microinteraction-roadmap.md) · [240-task checklist](selecta-microinteraction-implementation-checklist.md) · [evidence ledger](selecta-microinteraction-evidence.md) · [state and motion matrix](selecta-microinteraction-motion-matrix.md) · [release gates](selecta-microinteraction-release-gates.md).
