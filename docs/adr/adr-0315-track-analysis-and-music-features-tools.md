# ADR-0315 - Music feature, per-track diagnostics and analysis-request tool contract

- **Decision:** Accepted (owner approval recorded 2026-11-08; docs only, implementation pending).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Lucy agentic Make a Mix (LU); 2026-11-08; main `1b53debedc3d6ef3c8d0cf6302b561b0003e8d78`.
- **Priority / phase:** P0 / Music tools. **Owner:** Unassigned. **Implementing PR/SHA:** -.
- **Existing ADR owners:** ADR-0107, ADR-0217, ADR-0227, ADR-0237, ADR-0251; unchanged.
- **Source touchpoints:** `src/selecta/analysis/features.py`; `src/selecta/analysis/song.py`; `src/selecta/analysis/pipeline.py`; `src/selecta/routes/library.py`.

## Context and evidence boundary

Selecta computes actual tempo, key, loudness, energy, section and cue data, with confidence/versions and readiness. A model cannot infer those musical measurements accurately from titles. This accepted decision adds Lucy requirements; it does not assert existing capability absence or certify source implementation. Re-check source at implementation SHA.

## Proposed decision

Expose analysis.features/tempo/key/energy/sections/cues/loudness/lyrics/timbre/stemsAvailable/health with evidence and explicit unavailable states. Expensive new analysis uses the normal Selecta worker under separately authorised compute permission, never hidden inside a read call.

## UI/UX and evidence contract

Compact analysis cards show real measured values and confidence where available; no invented waveform, metadata or decoder progress. Existing Workshop and song-detail navigation remain authoritative.

**Required negative cases:** Unanalysed or failed recordings, low confidence, beat half-time ambiguity, missing lyrics/stems, stale file change, corrupt cache, unsupported formats and high CPU/audio contention.

## Alternatives, dependencies and trade-offs

Reuse Selecta's authoritative song/mix/worker state and the documented WeftAI Python runtime rather than duplicating DJ logic in a model or new agent server. No fake progress, unconsented remote-media upload or automatic playback. Existing ADRs named above retain scope and historical status.

## Implementation checklist - 0/8 Implemented; 0/8 independently Verified

1. **LU-315-01 - Specify feature provenance.** **Acceptance:** Every field describes source, analysis version, confidence/unknown policy. **Required verification:** Fixture and schema truth table. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
2. **LU-315-02 - Expose current feature reads.** **Acceptance:** Tools return only existing measured BPM/key/energy/sections/loudness/timbre. **Required verification:** Analysis parity integration. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
3. **LU-315-03 - Expose cues and lyrics safely.** **Acceptance:** Cue/word information reflects actual loaded song and lyrics availability. **Required verification:** No-lyrics/partial timing tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
4. **LU-315-04 - Distinguish missing and failed analysis.** **Acceptance:** Unanalysed, queued, failed, stale and ineligible reasons remain distinct. **Required verification:** Readiness/status matrix. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
5. **LU-315-05 - Control expensive computation.** **Acceptance:** Request analysis is privileged, de-duplicated and follows worker priority. **Required verification:** Permission and playback-pressure test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
6. **LU-315-06 - Build track-analysis mini UI.** **Acceptance:** Measured fields and read-only waveform render without fabricated data. **Required verification:** Static/animated/AT visual proof. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
7. **LU-315-07 - Invalidate stale outputs.** **Acceptance:** Changed audio/corrections invalidate cached feature references and proposal evidence. **Required verification:** File replacement and version test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
8. **LU-315-08 - Benchmark analysis queries.** **Acceptance:** Tool read workloads stay bounded and do not starve actual player. **Required verification:** CPU/latency and real-audio regression. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.

## Preservation and proof

Preserve original local audio, deliberate Pause and one audio owner, real song/seam identity, current/draft scope and Undo, atomic consented bridge, Studio 8 lanes/8–64 cells, truthful Library readiness, blind study neutrality and frozen-revision FLAC. Verify relevant stale/failed/offline/race/RTL/320px/400% zoom/forced-colour/Still/audio cases. A docs-only PR is not implementation evidence.

## Programme state

Proposed → owner decision (dated); source PR+SHA → Implemented only upon task-specific proof; independent reviewer/device/audio/AT evidence → Verified. [Roadmap](selecta-lucy-roadmap.md) · [checklist](selecta-lucy-implementation-checklist.md) · [evidence](selecta-lucy-implementation-evidence.md) · [verification](selecta-lucy-verification-matrix.md) · [release](selecta-lucy-release-gates.md).
