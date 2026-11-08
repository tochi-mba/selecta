# ADR-0166 — Shared song, seam, Energy Horizon and route visual grammar

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** Not started (0/7 Implemented, 0/7 In progress, 7/7 Not started).
- **Independent verification:** No (0/7).
- **Programme/date/baseline:** Selecta creative-interface synthesis; 2026-11-08; main 4c2f9f03b8b7e185a7a5021979f4b443e40299dd.
- **Priority / phase:** P0 / Foundation.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0136, ADR-0147, ADR-0150, ADR-0155; no prior decision or status is changed by this proposal.
- **Existing source touchpoints:** web/src/ui/seam.ts; web/src/views/EditorRows.tsx; web/src/views/MixSetup.tsx.

## Context and evidence boundary

The existing UI has separately useful cards, seam bars, five-stop arc and request list. A cross-surface graphic alphabet could let the same real object expand from a compact marker to a creative control. Existing MI visual-material tasks do not by themselves verify that new object grammar.

This is a **new, unimplemented design and acceptance delta**. Similar existing source, earlier implementation checkmarks and this docs PR cannot demonstrate that a CI task is implemented or independently verified.

## Accepted decision

- Define four reusable visual object families: Song Identity, Seam Connection, Energy Horizon and Requested Route.
- Make shapes deterministic from real identifiers/data; neutral abstract fallback is explicitly decorative, never fake cover art or invented waveform.
- Give cut, overlap, echo/filter, wordplay and stem-assisted seams distinct readable structures and accessible words.
- Preserve semantic lime action/playing, blue requests, warning orange, cream ink and meaningful non-colour patterns.
- Publish small, card, timeline, inspector, Stage and Studio representations with consistent state ownership.

## Visual, animation and microinteraction contract

- A selected seam may expand into a detailed representation without changing its song pair or revision.
- Unknown timing or energy uses a labelled unknown state rather than synthetic bars.
- Objects only animate when selection, confirmed playback or real processing state changes.

## Alternatives and trade-offs

Preserve the current restrained layout when a richer animation does not measurably improve comprehension, creative control or delight. A preview or graphic is illustrative until connected to actual source data. No fake waveform, beat, word timing, quality score, cover art, render status, autoplay sound or processing percentage. Every animated or direct-manipulation state requires an accessible static/keyboard equivalent.

## Implementation checklist — 0/7 Implemented, 0/7 Verified

1. **CI-0166-01 — Specify four reusable musical objects.** **Acceptance:** Each has stable identity, semantic variants and known/unknown representations. **Required verification:** Component specimens at compact and full sizes. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
2. **CI-0166-02 — Design decorative song fingerprint provenance.** **Acceptance:** Identical song yields stable motif with no genre or quality inference. **Required verification:** Missing metadata, duplicate title and re-render fixtures. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
3. **CI-0166-03 — Define seam visual technique catalogue.** **Acceptance:** Supported methods are recognizably different and accurately named. **Required verification:** Expert diagram versus rendered seam review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
4. **CI-0166-04 — Separate requested and achieved energy.** **Acceptance:** Unknown/relative analysis never appears numerically comparable with user shape. **Required verification:** Data provenance and user interpretation audit. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
5. **CI-0166-05 — Encode semantic colours and patterns.** **Acceptance:** Status remains legible without color and on light/dark/forced colours. **Required verification:** Computed contrast and AT snapshots. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
6. **CI-0166-06 — Validate visual scaling across surfaces.** **Acceptance:** Mini-player/card/timeline/inspector share object without overflow. **Required verification:** 320–2560px and 400% zoom review. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.
7. **CI-0166-07 — Evaluate diagram meaning without legend.** **Acceptance:** Listeners can distinguish planned, audible and unavailable states. **Required verification:** Uncoached graphic comprehension study. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** —; **Evidence:** —.

## Invariants and required negative cases

Preserve single audio owner, manual Pause, original audio files, disclosed LRCLIB metadata lookup, current/draft revision guards and Undo, exact seam identity, bridge consent and atomic join, full eight-lane Studio with recovery, existing routes and Library workflows, blind A/B neutrality, frozen-revision decodable FLAC and local operation. Test missing/RTL titles, stale responses, failure, cancel, offline, 320–2560px, zoom, high-contrast, reduced motion, touch, keyboard and real audio as relevant.

## Dependencies, evidence and status

- **Depends on:** ADR-0136, ADR-0147, ADR-0150, ADR-0155; reconcile old task implementation rather than claiming it incomplete.
- **Next sequence:** owner decision → object/state prototype → explicit test fixtures → scoped implementation PR → separate human/AT/audio/performance review → recorded GO/NO-GO.
- **Now:** Decision Accepted; Implementation Not started; Independently Verified No; no implementing PR/SHA.
- [Roadmap](selecta-creative-interface-roadmap.md) · [140-task checklist](selecta-creative-interface-implementation-checklist.md) · [Evidence](selecta-creative-interface-implementation-evidence.md) · [Parity](selecta-creative-interface-feature-parity.md) · [Interaction matrix](selecta-creative-interface-interaction-matrix.md) · [Verification](selecta-creative-interface-verification-matrix.md) · [Gates](selecta-creative-interface-release-gates.md).
