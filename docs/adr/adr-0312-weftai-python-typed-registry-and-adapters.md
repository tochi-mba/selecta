# ADR-0312 - WeftAI Python registry, typed music collections and provider adapters

- **Decision:** Accepted (owner approval recorded 2026-11-08; docs only, implementation pending).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Lucy agentic Make a Mix (LU); 2026-11-08; main `1b53debedc3d6ef3c8d0cf6302b561b0003e8d78`.
- **Priority / phase:** P0 / WeftAI. **Owner:** Unassigned. **Implementing PR/SHA:** -.
- **Existing ADR owners:** ADR-0236, ADR-0237, ADR-0238, ADR-0269; unchanged.
- **Source touchpoints:** `pyproject.toml`; `src/selecta/analysis/song.py`; `src/selecta/routes/helpers.py`.

## Context and evidence boundary

Selecta is Python 3.12/FastAPI; a separate TypeScript agent backend is not necessary. The Python WeftAI package supports typed collections, plans, ref fields, standard operations, registry filters and provider adapters, but Lucy-specific operations are new work. This accepted decision adds Lucy requirements; it does not assert existing capability absence or certify source implementation. Re-check source at implementation SHA.

## Proposed decision

Pin a tested released WeftAI Python version and compatible provider package. Define typed Tracks, DirectedSeams, ProposalSongs and relevant value outputs with stable keys and field descriptors; use standard collection operations where fit and custom handlers for Selecta music logic.

## UI/UX and evidence contract

The model sees short labels, true match counts and bounded previews; the UI receives typed real result metadata. Internal paths and sensitive record IDs are never gratuitously exposed to provider text.

**Required negative cases:** Pydantic/schema incompatibility, unknown operation, ref type mismatch, bad 1-based ordinal, truncated intermediate result, provider schema limitations, empty collections and dependency version drift.

## Alternatives, dependencies and trade-offs

Reuse Selecta's authoritative song/mix/worker state and the documented WeftAI Python runtime rather than duplicating DJ logic in a model or new agent server. No fake progress, unconsented remote-media upload or automatic playback. Existing ADRs named above retain scope and historical status.

## Implementation checklist - 0/8 Implemented; 0/8 independently Verified

1. **LU-312-01 - Pin Python WeftAI dependencies.** **Acceptance:** Version/lock/license/Windows/Python support verified at implementation SHA. **Required verification:** Clean install on Windows/Linux and packaging CI. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
2. **LU-312-02 - Define typed music collections.** **Acceptance:** Stable Track/Seam/Proposal collection keys and fields with provenance. **Required verification:** Schema snapshots and duplicate-identity tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
3. **LU-312-03 - Register standard filtering operations.** **Acceptance:** Typed filter/count/countBy/distinct/details with bounded display and honest caps. **Required verification:** WeftAI standard-operation conformance tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
4. **LU-312-04 - Define custom Selecta operations.** **Acceptance:** Music planner/analysis handlers use existing services, never raw arbitrary model code. **Required verification:** Integration fixture against real library. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
5. **LU-312-05 - Describe operation permissions.** **Acceptance:** effects read/write, destructive/idempotent/openWorld annotations match actual behaviour. **Required verification:** Registry lint and capability audit. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
6. **LU-312-06 - Connect provider tool binding.** **Acceptance:** Selected model's schema/tool wire supports validated WeftAI plans. **Required verification:** Provider adapters contract matrix. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
7. **LU-312-07 - Test reference semantics.** **Acceptance:** Typed references, sessions, 1-based full-set ordinals and invalid fields behave as documented. **Required verification:** WeftAI Python test harness. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
8. **LU-312-08 - Reconcile package/source versions.** **Acceptance:** No main-branch-only API assumed available in deployed PyPI wheel. **Required verification:** Release/version fixture and install smoke test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.

## Preservation and proof

Preserve original local audio, deliberate Pause and one audio owner, real song/seam identity, current/draft scope and Undo, atomic consented bridge, Studio 8 lanes/8–64 cells, truthful Library readiness, blind study neutrality and frozen-revision FLAC. Verify relevant stale/failed/offline/race/RTL/320px/400% zoom/forced-colour/Still/audio cases. A docs-only PR is not implementation evidence.

## Programme state

Proposed → owner decision (dated); source PR+SHA → Implemented only upon task-specific proof; independent reviewer/device/audio/AT evidence → Verified. [Roadmap](selecta-lucy-roadmap.md) · [checklist](selecta-lucy-implementation-checklist.md) · [evidence](selecta-lucy-implementation-evidence.md) · [verification](selecta-lucy-verification-matrix.md) · [release](selecta-lucy-release-gates.md).
