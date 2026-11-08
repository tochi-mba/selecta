# ADR-0168 — Make a Mix: expressive idea selection and honest result reveal

- **Decision:** Proposed (owner acceptance not recorded).
- **Implementation:** Not started (0/7 Implemented, 0/7 In progress, 7/7 Not started).
- **Independent verification:** No (0/7).
- **Programme/date/baseline:** Selecta creative-interface synthesis; 2026-11-08; main 4c2f9f03b8b7e185a7a5021979f4b443e40299dd.
- **Priority / phase:** P0 / Explore.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0142, ADR-0117, ADR-0118; no prior decision or status is changed by this proposal.
- **Existing source touchpoints:** web/src/views/Mixes.tsx; web/src/views/CurrentMix.tsx; web/src/styles/creation.css.

## Context and evidence boundary

The featured suggestion and grouped vibe cards are useful but visually similar. Mood, sound, moment and journey can be represented through distinctive abstract motifs before a mix exists, then connected to actual confirmed songs after generation.

This is a **new, unimplemented design and acceptance delta**. Similar existing source, earlier implementation checkmarks and this docs PR cannot demonstrate that a CI task is implemented or independently verified.

## Proposed decision

- Provide a memorable featured musical-intent hero, with the first Play action unmistakable.
- Use abstract mood/energy previews that never masquerade as analysis of an unbuilt mix.
- Make Play, Shape first and Save draft distinct outcomes with unambiguous replacement safety.
- Explain approximate length through visual scale without guaranteeing exact duration or track order.
- Reveal a server-confirmed sequence and per-seam preparation, never theatrical fake progress.

## Visual, animation and microinteraction contract

- Filters settle/reveal cards without moving keyboard focus or playing audio.
- Selection changes an abstract preview; confirmed build animates only actual returned songs.
- Loading/error/cancel remains clear and static in reduced-motion mode.

## Alternatives and trade-offs

Preserve the current restrained layout when a richer animation does not measurably improve comprehension, creative control or delight. A preview or graphic is illustrative until connected to actual source data. No fake waveform, beat, word timing, quality score, cover art, render status, autoplay sound or processing percentage. Every animated or direct-manipulation state requires an accessible static/keyboard equivalent.

## Implementation checklist — 0/7 Implemented, 0/7 Verified

1. **CI-0168-01 — Design featured hero and one primary CTA.** **Acceptance:** Intent, Play and approximate length readable at first glance. **Required verification:** 375/1440px screenshots and glance testing. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
2. **CI-0168-02 — Create distinct card motif set.** **Acceptance:** The moment/mood/sound/journey distinguishable without made-up facts. **Required verification:** Motif provenance and comprehension review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
3. **CI-0168-03 — Retain all three card commitments.** **Acceptance:** Play/Shape/Save reachable and correctly scoped on keyboard/touch. **Required verification:** Replacement and draft creation tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
4. **CI-0168-04 — Design approximate-length effect.** **Acceptance:** Choice changes intention graphic without promising exact minutes. **Required verification:** Short/long fixtures and copy review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
5. **CI-0168-05 — Reveal generated track order honestly.** **Acceptance:** Only server-returned songs and seam states are shown as created. **Required verification:** Slow, error, stale and success build tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
6. **CI-0168-06 — Avoid button-heavy mobile cards.** **Acceptance:** No accidental change of current playing mix from card surface. **Required verification:** Usability and 320px touch test. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
7. **CI-0168-07 — Measure first choice confidence.** **Acceptance:** Users choose intended feeling without technical coaching. **Required verification:** Uncoached task completion and hesitation counts. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.

## Invariants and required negative cases

Preserve single audio owner, manual Pause, original audio files, disclosed LRCLIB metadata lookup, current/draft revision guards and Undo, exact seam identity, bridge consent and atomic join, full eight-lane Studio with recovery, existing routes and Library workflows, blind A/B neutrality, frozen-revision decodable FLAC and local operation. Test missing/RTL titles, stale responses, failure, cancel, offline, 320–2560px, zoom, high-contrast, reduced motion, touch, keyboard and real audio as relevant.

## Dependencies, evidence and status

- **Depends on:** ADR-0142, ADR-0117, ADR-0118; reconcile old task implementation rather than claiming it incomplete.
- **Next sequence:** owner decision → object/state prototype → explicit test fixtures → scoped implementation PR → separate human/AT/audio/performance review → recorded GO/NO-GO.
- **Now:** Decision Proposed; Implementation Not started; Independently Verified No; no implementing PR/SHA.
- [Roadmap](selecta-creative-interface-roadmap.md) · [140-task checklist](selecta-creative-interface-implementation-checklist.md) · [Evidence](selecta-creative-interface-implementation-evidence.md) · [Parity](selecta-creative-interface-feature-parity.md) · [Interaction matrix](selecta-creative-interface-interaction-matrix.md) · [Verification](selecta-creative-interface-verification-matrix.md) · [Gates](selecta-creative-interface-release-gates.md).
