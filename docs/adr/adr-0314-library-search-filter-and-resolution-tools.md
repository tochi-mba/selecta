# ADR-0314 — Library search, filtered collections, identity and readiness tool contract

- **Decision:** Accepted (owner approval recorded 2026-11-08; docs only, implementation pending).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Lucy agentic Make a Mix (LU); 2026-11-08; main `1b53debedc3d6ef3c8d0cf6302b561b0003e8d78`.
- **Priority / phase:** P0 / Music tools. **Owner:** Unassigned. **Implementing PR/SHA:** —.
- **Existing ADR owners:** ADR-0226, ADR-0227, ADR-0251, ADR-0252, ADR-0260; unchanged.
- **Source touchpoints:** `src/selecta/routes/library.py`; `src/selecta/routes/edit.py`; `src/selecta/db.py`.

## Context and evidence boundary

Selecta already searches local songs, supports corrections and exposes a mix-ready subset. Lucy needs bounded composable read tools rather than scraping the Library UI or sending the entire catalog to a model. This accepted decision adds Lucy requirements; it does not assert existing capability absence or certify source implementation. Re-check source at implementation SHA.

## Proposed decision

Expose tracks.search/details/filter/count/countBy/distinct/mostCommon/resolveName/duplicates/exclusions/ready and recent-library candidate operations; validate against authoritative is_music, duplicate_of, 'never', readiness and analysis versions.

## UI/UX and evidence contract

The search card displays actual filters, matched versus returned counts and ready/not-ready reasons; ambiguous song titles resolve with actual metadata and do not silently pick wrong versions.

**Required negative cases:** 100k songs, empty/unknown genres, duplicate editions, files being copied, exclusions, missing files, metadata correction during turn, null BPM/key and untrusted tags.

## Alternatives, dependencies and trade-offs

Reuse Selecta's authoritative song/mix/worker state and the documented WeftAI Python runtime rather than duplicating DJ logic in a model or new agent server. No fake progress, unconsented remote-media upload or automatic playback. Existing ADRs named above retain scope and historical status.

## Implementation checklist — 0/8 Implemented; 0/8 independently Verified

1. **LU-314-01 — Define track identity schema.** **Acceptance:** Song ID, recording identity and occurrence identity never collapse incorrectly. **Required verification:** Duplicate/remaster and song correction fixtures. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
2. **LU-314-02 — Implement bounded search.** **Acceptance:** Server-side indexed discovery with truthful counts, paging and caps. **Required verification:** Large-library performance and cap tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
3. **LU-314-03 — Register filter/group tools.** **Acceptance:** Only supported typed fields accepted; bad field returns actionable error. **Required verification:** WeftAI filter schema validation. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
4. **LU-314-04 — Expose eligibility reasons.** **Acceptance:** Analysis/current-version, missing audio, excluded and duplicate cases explicit. **Required verification:** Readiness parity fixture. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
5. **LU-314-05 — Resolve ambiguous user names.** **Acceptance:** Multiple matching recordings trigger disambiguation with artist/version. **Required verification:** Natural-language ambiguity eval. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
6. **LU-314-06 — Handle partial and missing data.** **Acceptance:** Unknown BPM/key/genre not silently interpreted as zero or excluded. **Required verification:** Null and sparse-metadata tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
7. **LU-314-07 — Protect privacy and output budget.** **Acceptance:** Model receives minimal relevant metadata, never paths or full catalog by default. **Required verification:** Provider payload snapshot and leakage test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.
8. **LU-314-08 — Integrate library detail routes.** **Acceptance:** Track actions open existing Library details and return to Lucy selection. **Required verification:** Cross-route keyboard/mobile E2E. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** —; **Evidence/reviewer:** —.

## Preservation and proof

Preserve original local audio, deliberate Pause and one audio owner, real song/seam identity, current/draft scope and Undo, atomic consented bridge, Studio 8 lanes/8–64 cells, truthful Library readiness, blind study neutrality and frozen-revision FLAC. Verify relevant stale/failed/offline/race/RTL/320px/400% zoom/forced-colour/Still/audio cases. A docs-only PR is not implementation evidence.

## Programme state

Proposed → owner decision (dated); source PR+SHA → Implemented only upon task-specific proof; independent reviewer/device/audio/AT evidence → Verified. [Roadmap](selecta-lucy-roadmap.md) · [checklist](selecta-lucy-implementation-checklist.md) · [evidence](selecta-lucy-implementation-evidence.md) · [verification](selecta-lucy-verification-matrix.md) · [release](selecta-lucy-release-gates.md).
