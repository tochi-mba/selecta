# ADR-0165 - Creative-interface charter and attention modes

- **Decision:** Accepted (owner approval recorded 2026-11-08).
- **Implementation:** Not started (0/7 Implemented, 0/7 In progress, 7/7 Not started).
- **Independent verification:** No (0/7).
- **Programme/date/baseline:** Selecta creative-interface synthesis; 2026-11-08; main 4c2f9f03b8b7e185a7a5021979f4b443e40299dd.
- **Priority / phase:** P0 / Foundation.
- **Owner:** Unassigned.
- **Related earlier ADRs:** ADR-0114, ADR-0135, ADR-0164; no prior decision or status is changed by this proposal.
- **Existing source touchpoints:** web/src/App.tsx; web/src/shell/Shell.tsx; web/src/views/Now.tsx.

## Context and evidence boundary

Selecta is a local autonomous DJ and optional creative workstation. Earlier ADRs describe functional polish and restraint, but the outstanding design opportunity is an unmistakably coherent instrument across Explore, Create and Listen. This record proposes new cross-scene design acceptance; it does not declare existing implementation absent.

This is a **new, unimplemented design and acceptance delta**. Similar existing source, earlier implementation checkmarks and this docs PR cannot demonstrate that a CI task is implemented or independently verified.

## Accepted decision

- Expose three presentation intentions: Explore inspires, Create permits precise manipulation, Listen protects musical immersion. Do not add mandatory routes.
- Give each scene one primary music object, one primary action, a quiet utility layer and a deliberate disclosure path for advanced controls.
- Carry current song, selected transition, mix scope and intent between scenes without ever changing audio as a side effect of navigation.
- Use expression only to clarify a musical relationship, confirmed state or user action; ban gratuitous screensaver animation.
- Treat a listener's first convincing handoff and confident recovery as success metrics, not the number of screen effects.

## Visual, animation and microinteraction contract

- A new scene keeps recognizable song/seam identity; audio remains owned by the existing persistent player.
- Background preparation must not summon modal UI, play sounds, or interrupt intentional Pause.
- Reduced-motion mode preserves the entire information hierarchy with static labels and focus.

## Alternatives and trade-offs

Preserve the current restrained layout when a richer animation does not measurably improve comprehension, creative control or delight. A preview or graphic is illustrative until connected to actual source data. No fake waveform, beat, word timing, quality score, cover art, render status, autoplay sound or processing percentage. Every animated or direct-manipulation state requires an accessible static/keyboard equivalent.

## Implementation checklist - 0/7 Implemented, 0/7 Verified

1. **CI-0165-01 - Inventory current scenes and interruptions.** **Acceptance:** Map primary action, supporting data, conflicts and source state for every core journey. **Required verification:** Annotated source baseline and uncoached observation. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
2. **CI-0165-02 - Define Explore Create Listen scene hierarchy.** **Acceptance:** Each has one first-glance focal object without losing advanced actions. **Required verification:** Design specimens in both themes and five-second glance test. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
3. **CI-0165-03 - Specify entry, exit and context retention.** **Acceptance:** Route, Back/Forward, current/draft and selected seam survive changes. **Required verification:** History, focus, audio and revision regression tests. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
4. **CI-0165-04 - Establish intentional interruption policy.** **Acceptance:** Only consent, requested overlay and significant failure may interrupt. **Required verification:** Injected render/request/error fixtures. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
5. **CI-0165-05 - Define music-led language and affordance policy.** **Acceptance:** Intent controls do not require BPM/cues while experts can still reach them. **Required verification:** Novice/expert comprehension study. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
6. **CI-0165-06 - Document attention and visual-intensity limits.** **Acceptance:** No unrelated autoplay, constant pulsing, competing CTA or disguised status. **Required verification:** Audited scene checklist and reduced-motion fixtures. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.
7. **CI-0165-07 - Record end-to-end quality baseline.** **Acceptance:** First play, edit, seam preview, request and export remain complete without hidden changes. **Required verification:** Real-audio, keyboard and participant protocol. **Implementation:** Not started; **Verified:** No; **Owner:** Unassigned; **PR/SHA:** -; **Evidence:** -.

## Invariants and required negative cases

Preserve single audio owner, manual Pause, original audio files, disclosed LRCLIB metadata lookup, current/draft revision guards and Undo, exact seam identity, bridge consent and atomic join, full eight-lane Studio with recovery, existing routes and Library workflows, blind A/B neutrality, frozen-revision decodable FLAC and local operation. Test missing/RTL titles, stale responses, failure, cancel, offline, 320–2560px, zoom, high-contrast, reduced motion, touch, keyboard and real audio as relevant.

## Dependencies, evidence and status

- **Depends on:** ADR-0114, ADR-0135, ADR-0164; reconcile old task implementation rather than claiming it incomplete.
- **Next sequence:** owner decision → object/state prototype → explicit test fixtures → scoped implementation PR → separate human/AT/audio/performance review → recorded GO/NO-GO.
- **Now:** Decision Accepted; Implementation Not started; Independently Verified No; no implementing PR/SHA.
- [Roadmap](selecta-creative-interface-roadmap.md) · [140-task checklist](selecta-creative-interface-implementation-checklist.md) · [Evidence](selecta-creative-interface-implementation-evidence.md) · [Parity](selecta-creative-interface-feature-parity.md) · [Interaction matrix](selecta-creative-interface-interaction-matrix.md) · [Verification](selecta-creative-interface-verification-matrix.md) · [Gates](selecta-creative-interface-release-gates.md).
