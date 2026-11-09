# ADR-0332 - Audio-first performance, agent resource budgets and safe cache scheduling

- **Decision:** Accepted (owner approval recorded 2026-11-08; docs only, implementation pending).
- **Implementation:** 8/8 Not started; 0/8 In progress; 0/8 Implemented.
- **Independent verification:** 0/8 Verified.
- **Programme/date/baseline:** Lucy agentic Make a Mix (LU); 2026-11-08; main `1b53debedc3d6ef3c8d0cf6302b561b0003e8d78`.
- **Priority / phase:** P0 / Performance. **Owner:** Unassigned. **Implementing PR/SHA:** -.
- **Existing ADR owners:** ADR-0162, ADR-0235, ADR-0236, ADR-0270, ADR-0297, ADR-0298; unchanged.
- **Source touchpoints:** `web/src/player.ts`; `web/src/audio/focus.ts`; `src/selecta/seams.py`; `src/selecta/planner/beam.py`; `web/src/App.tsx`.

## Context and evidence boundary

Model streaming, SVG microanimations, 100k-song searches and transition analysis compete with the playback engine, preview audio, renders and UI responsiveness. This ADR is a new proposal, not source implementation or independently proven usability/audio. Older implementation and verification histories remain unchanged.

## Proposed decision

Give active player/audio work strict priority, isolate chat stream rendering, lazy-load Lucy, virtualise long history accessibly and cap backend planning/memory use. Cache derived results only with source version checks; pause offscreen animation and never fake GPU/audio activity.

## UI/UX and measurable acceptance contract

Composer and player remain responsive while multiple tool cards stream. Cards completing do not redraw the whole app, offscreen animations suspend, and unexpected resource throttling is described honestly.

**Required negative cases:** Low-end Windows, concurrent rendering, 100k songs, slow disk, phone background sleep, memory pressure, 400% zoom, repeated SSE updates, evicted media and cache snapshot mismatch.

## Rejected shortcuts and dependencies

Never prioritise chatbot animation over audio continuity or fabricated estimates over measured truth. Reuse the existing Selecta app and WeftAI typed planning. Before implementing, reconcile related accepted ADRs against current source, tests and actual audio evidence; do not retrofit their historical statuses.

## Implementation checklist - 0/8 Implemented; 0/8 independently Verified

1. **LU-332-01 - Define resource budgets.** **Acceptance:** CPU/memory, active reads, model cycles, animation frames and player priority measured. **Required verification:** Baseline/after CPU/audio benchmark. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
2. **LU-332-02 - Isolate token updates.** **Acceptance:** Only active message/tool view rerenders per event; streaming batched without missing content. **Required verification:** React profiler + stream stress. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
3. **LU-332-03 - Lazy-load Lucy surfaces.** **Acceptance:** Quick Play, Listen and Editor startup are not burdened by AI module when unused. **Required verification:** Bundle/load regression. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
4. **LU-332-04 - Optimise large-library tools.** **Acceptance:** Indexed/capped search and cached-seam inventory avoid unbounded scans. **Required verification:** 100k-song and large cache fixture. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
5. **LU-332-05 - Prioritise audio/worker.** **Acceptance:** Optional planning yields to current playback, urgent requests and render queue. **Required verification:** Real audio underrun and worker test. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
6. **LU-332-06 - Control media and cache lifetime.** **Acceptance:** Ready-only edge pin/lease, invalidation and storage limits explicit. **Required verification:** Disk pressure and eviction races. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
7. **LU-332-07 - Stop offscreen motion.** **Acceptance:** Visible cards animate meaningfully; hidden cards consume negligible work. **Required verification:** Profiler + Still/visibility tests. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.
8. **LU-332-08 - Set release baselines.** **Acceptance:** INP, scrolling, time-to-first-update, resource regression and audio tests recorded. **Required verification:** Named hardware metrics at exact SHA. **Implementation:** Not started; **Independently Verified:** No; **Owner:** Unassigned; **Implementation PR/SHA:** -; **Evidence/reviewer:** -.

## Preservation and release proof

Preserve originals, single audio owner/manual Pause, real current/draft/revision/seam/occurrence identity and scoped Undo, consented atomic bridges, Studio 8 lanes/8–64 cells, correct library and LRCLIB disclosure, neutral blind listening, frozen FLAC export. Test stale/offline/worker crashes, mobile/320px/400% zoom, keyboard/AT/RTL/forced colours/reduced motion and real audio as relevant.

## Governance

Decision Accepted and all eight LU tasks Not started/Not Verified. An implementing PR/test SHA and exact acceptance evidence are distinct from independent named reviewer/date/platform proof. [Roadmap](selecta-lucy-roadmap.md) · [checklist](selecta-lucy-implementation-checklist.md) · [evidence](selecta-lucy-implementation-evidence.md) · [verification](selecta-lucy-verification-matrix.md) · [release](selecta-lucy-release-gates.md).
