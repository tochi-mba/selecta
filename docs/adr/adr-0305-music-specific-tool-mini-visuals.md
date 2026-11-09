# ADR-0305 - Music-specific mini visualisations for all Lucy tool families

- **Decision:** Accepted (owner approval recorded 2026-11-08; docs only, implementation pending).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Lucy agentic Make a Mix (LU); 2026-11-08; main `1b53debedc3d6ef3c8d0cf6302b561b0003e8d78`.
- **Priority / phase:** P0 / Tool UI. **Owner:** Unassigned. **Implementing PR/SHA:** -.
- **Existing ADR owners:** ADR-0206, ADR-0207, ADR-0212, ADR-0237, ADR-0266, ADR-0296; their decisions and statuses remain unchanged.
- **Source touchpoints:** `web/src/ui/MusicObjects.tsx`; `web/src/styles/tokens.css`; `web/src/styles/music-objects.css`.

## Context and evidence boundary

Library search, audio feature analysis, transition checks, planning, revision diff and rendering are musically different activities. A generic spinner for all of them loses meaning. This is an accepted **new Lucy feature contract** (not yet implemented), not evidence that Lucy exists, that the current UI is defective, or that any new task is implemented. Source observations require revalidation at the implementation SHA.

## Proposed decision

Specify a visual renderer registry by operation family using existing Selecta tokens. Search shows filters and real counts; analysis shows measured facets; transitions show directed pair; planning shows real sequence; constraints show pass/block; revision shows exact diff; render shows real readiness.

## Interaction, provenance and data contract

Mini UIs remain compact in chat, expand for evidence, and switch to text equivalents in Still/reduced motion/forced-colours. Never draw invented waveforms, cached songs, cover art, beat clocks or percentages as measured facts.

**Failure and negative scope:** No waveform data, unknown BPM/key, absent covers, long Unicode/RTL names, multiple cached styles, render fallback, unrelated progress event, 320px and high zoom.

## Alternatives and trade-offs

Prefer integrating the existing Selecta source-of-truth over duplicating music state or adding a detached chatbot. Reject fabricated analysis, unsupported audio effects, model-authorised playback, and generic animation that does not explain real work. Any remote AI provider requires a separate explicit privacy/consent decision.

## Implementation checklist - 0/8 Implemented; 0/8 independently Verified

1. **LU-305-01 - Define visual mapping registry.** **Acceptance:** Every exposed operation family maps to a mini UI and truthful fallback. **Required verification:** Tool-to-renderer catalog completeness test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
2. **LU-305-02 - Design search and filtering visuals.** **Acceptance:** Filters, true matched/returned counts, exclusions and capped results distinguish zero from failure. **Required verification:** Search/soft-cap synthetic fixture. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
3. **LU-305-03 - Design track-analysis visuals.** **Acceptance:** BPM/key/energy/sections/waveform appear only when actual measurement exists. **Required verification:** Missing/low-confidence/expired-analysis fixtures. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
4. **LU-305-04 - Design transition and word-link visuals.** **Acceptance:** Directed pair, actual move and evidence status stay correct with reversed/unknown pairs. **Required verification:** Pair-reversal and lyric-availability tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
5. **LU-305-05 - Design sequence and energy visuals.** **Acceptance:** Proposal bars derive from real song order/energy; unknown gaps shown as unknown. **Required verification:** Provenance and sparse-value render test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
6. **LU-305-06 - Design revision-diff visuals.** **Acceptance:** Added/moved/removed/kept statuses match computed immutable diff. **Required verification:** Diff snapshot/lock fixtures. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
7. **LU-305-07 - Design render and job visuals.** **Acceptance:** Queued/rendering/ready/failed reflect actual server truth, no fake job progress. **Required verification:** Live job and aborted-worker fixtures. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
8. **LU-305-08 - Verify motion and themes.** **Acceptance:** Still, reduced-motion, forced colours, light/dark, AT and mobile all convey same information. **Required verification:** Paired visual/AT/performance review. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.

## Non-negotiable regression and release boundaries

Original local music unchanged; one player/audio-focus owner and intentional Pause; exact current/draft/revision/occurrence/seam identity and scoped Undo; explicitly consented atomic request bridges; all eight Studio lanes and 8–64 cells; truthful library readiness and LRCLIB metadata disclosure; neutral listening studies; frozen-revision decodable FLAC. Run relevant offline, stale, partial, cancelled, parallel, multi-tab, long/RTL/CJK, both themes, Still/reduced motion, 320px/400% zoom, keyboard, touch and real-audio tests. A model-generated explanation cannot substitute for actual source evidence.

## Status governance and cross-links

Decision **Accepted** (owner direction recorded 2026-11-08); future revision/supersession requires a dated decision. Implementation only advances with a source/test PR and specific acceptance proof; independent verification requires different named evidence and reviewer. No legacy task gets reclassified by this docs PR. [Lucy roadmap](selecta-lucy-roadmap.md) · [320-task checklist](selecta-lucy-implementation-checklist.md) · [evidence](selecta-lucy-implementation-evidence.md) · [verification](selecta-lucy-verification-matrix.md) · [release gates](selecta-lucy-release-gates.md).
