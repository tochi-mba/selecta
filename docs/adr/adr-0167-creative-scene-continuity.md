# ADR-0167 — Cross-scene continuity, contextual navigation and persistent context

- **Decision:** Proposed (owner acceptance not recorded).
- **Implementation:** Not started (0/7 Implemented, 0/7 In progress, 7/7 Not started).
- **Independent verification:** No (0/7).
- **Programme/date/baseline:** Selecta creative-interface synthesis; 2026-11-08; main 4c2f9f03b8b7e185a7a5021979f4b443e40299dd.
- **Priority / phase:** P0 / Foundation.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0139, ADR-0140, ADR-0159; no prior decision or status is changed by this proposal.
- **Existing source touchpoints:** web/src/App.tsx; web/src/router.ts; web/src/shell/Shell.tsx; web/src/shell/manifest.ts.

## Context and evidence boundary

Navigation, history and persistent audio already work. The new question is whether a mix idea becomes the same recognizable work in the editor and whether a seam becomes the same pair in Stem Studio. Object continuity is proposed in addition to existing page transition and focus work.

This is a **new, unimplemented design and acceptance delta**. Similar existing source, earlier implementation checkmarks and this docs PR cannot demonstrate that a CI task is implemented or independently verified.

## Proposed decision

- Keep the existing route structure and primary navigation rather than adding a page for each creative feature.
- Carry mix, song and seam identities between discovery, generated sequence, timeline, inspector, Studio and playback.
- Make context-specific actions more prominent than permanent utility controls; command palette remains an accelerator, not the only path.
- Treat current mix and draft as separate visible scopes across navigation and inspection.
- Use shared-object reveals only when the destination is actually available; never conceal an error or start playback.

## Visual, animation and microinteraction contract

- Back/Forward restores real scroll and focus, not a fabricated new creation.
- A selected seam may expand to an inspector/Studio while the pair label stays visible.
- Mobile sheets do not overlap bottom transport or obscure the keyboard input.

## Alternatives and trade-offs

Preserve the current restrained layout when a richer animation does not measurably improve comprehension, creative control or delight. A preview or graphic is illustrative until connected to actual source data. No fake waveform, beat, word timing, quality score, cover art, render status, autoplay sound or processing percentage. Every animated or direct-manipulation state requires an accessible static/keyboard equivalent.

## Implementation checklist — 0/7 Implemented, 0/7 Verified

1. **CI-0167-01 — Map exact object identity across routes.** **Acceptance:** Mix/scope/seam/song IDs survive navigation and stale responses. **Required verification:** Deep-link and popstate matrix. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
2. **CI-0167-02 — Storyboard mix idea to generated sequence.** **Acceptance:** The selected concept remains identifiable without false rendered state. **Required verification:** Confirmed-build fixture and review video. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
3. **CI-0167-03 — Storyboard seam to Inspector to Studio.** **Acceptance:** Same pair/revision and audio owner always preserved. **Required verification:** Open/close/reorder conflict test. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
4. **CI-0167-04 — Prioritize contextual actions in shell.** **Acceptance:** Primary creation and request actions clear without utility clutter. **Required verification:** Keyboard/desktop/mobile focus review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
5. **CI-0167-05 — Design responsive panel and return path.** **Acceptance:** Closing sheet returns to originating song/seam with meaningful focus. **Required verification:** Escape, nested modal and 320px tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
6. **CI-0167-06 — Protect playback through page transitions.** **Acceptance:** No route change unexpectedly plays, seeks or resumes audio. **Required verification:** Real audio multitab and manual Pause audit. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
7. **CI-0167-07 — Test stale state and deep-link recovery.** **Acceptance:** Missing draft or late build never steals navigation or changes wrong mix. **Required verification:** Network-race and missing-route tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.

## Invariants and required negative cases

Preserve single audio owner, manual Pause, original audio files, disclosed LRCLIB metadata lookup, current/draft revision guards and Undo, exact seam identity, bridge consent and atomic join, full eight-lane Studio with recovery, existing routes and Library workflows, blind A/B neutrality, frozen-revision decodable FLAC and local operation. Test missing/RTL titles, stale responses, failure, cancel, offline, 320–2560px, zoom, high-contrast, reduced motion, touch, keyboard and real audio as relevant.

## Dependencies, evidence and status

- **Depends on:** ADR-0139, ADR-0140, ADR-0159; reconcile old task implementation rather than claiming it incomplete.
- **Next sequence:** owner decision → object/state prototype → explicit test fixtures → scoped implementation PR → separate human/AT/audio/performance review → recorded GO/NO-GO.
- **Now:** Decision Proposed; Implementation Not started; Independently Verified No; no implementing PR/SHA.
- [Roadmap](selecta-creative-interface-roadmap.md) · [140-task checklist](selecta-creative-interface-implementation-checklist.md) · [Evidence](selecta-creative-interface-implementation-evidence.md) · [Parity](selecta-creative-interface-feature-parity.md) · [Interaction matrix](selecta-creative-interface-interaction-matrix.md) · [Verification](selecta-creative-interface-verification-matrix.md) · [Gates](selecta-creative-interface-release-gates.md).
