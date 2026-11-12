# Selecta 4.0 - feature preservation and no-regression mapping

- **Proposed:** 2026-11-07.
- **Baseline:** `main` `9b663f9f10212619f27ce67ce82f602347065cbd` (PR #25 and PR #26 already merged at review).
- **Status (2026-11-12, recounted from the [checklist](selecta-4-implementation-checklist.md) task lines):** 25 decisions **Accepted**; 250 tasks: **202 Implemented, 36 In progress, 12 Not started; 0 Verified**. (Created 2026-11-07 with 25 Proposed decisions and 250 Not started tasks.)
- **Change scope:** Documentation only; no frontend, backend, audio, database, test or CI changes.
- **History:** ADR-0001–0088, T/P/S3/S31 identities and their historical evidence remain unchanged.


This is a **prospective mapping**, not a claim of verified parity. ADR-0089 requires a source-backed exhaustive inventory of every existing control including obscure menus. Missing capabilities discovered in implementation must be added, not silently removed to fit design.

| Existing capability | Proposed surface | Responsible ADR | Must retain | Guarding tests (S4-0089-03) |
|---|---|---|---|---|
| First-run folder path, validation and scanning | Onboarding / Workspace Sources | ADR-0096, ADR-0106 | Exact path, six-ready threshold, file safety, lyric privacy | `tests/test_s4_folder_input.py`, `tests/test_polish_phase03.py`, `tests/test_scan.py`, `tests/test_s4_scan_restart.py` |
| Selecta's pick, The moment/mood/sound/journey | Explore | ADR-0097 | Suggestion status, Play, Edit first, Save draft | `web/src/views/Mixes.test.tsx`, `web/e2e/mp-0283-make-a-mix.e2e.ts`, `tests/test_drafts.py` |
| Energy five-point shape, feel, duration and cue destination | Explore customization | ADR-0097 | Steering persisted, scope clear, destination ID | `web/src/views/MixSetup.test.tsx`, `web/src/views/s4Destination.test.tsx` |
| Current mix Play/Pause/Next/previous/seek and Media Session | Listen and mini-player | ADR-0093, ADR-0098 | One audio owner, precise seek/jump semantics | `web/src/player.test.ts`, `web/src/audio/focus.test.tsx`, `web/src/audio/mediaSession.test.ts`, `web/e2e/listen.e2e.ts` |
| Lyrics, spectrum, waveforms and Stage | Listen | ADR-0098 | Timed/untimed, fullscreen denied, reduced motion | `web/src/views/Now.test.tsx`, `web/src/views/spectrumVisuals.test.ts`, `web/e2e/ex-0116-stage-themes.e2e.ts` |
| Current vs saved drafts, copy/rename/delete and render line | My Mixes | ADR-0099 | No wrong scope; render queue not playback list | `web/src/views/Drafts.test.tsx`, `web/src/views/s4DraftFocus.test.tsx`, `tests/test_drafts.py` |
| Editor reorder/add/remove/lock/Undo/preview | Mix editor | ADR-0100 | Pointer/touch/keyboard, stable song ID | `web/src/views/Mix.test.tsx`, `web/e2e/mp-0287-editor-rows.e2e.ts`, `tests/test_s4_scope_model.py` |
| Transition moves, cue, fallback, why, rating | Inspector | ADR-0101 | Requested vs actual rendered, keyed preview | `web/e2e/mp-0288-seam-inspector.e2e.ts`, `web/src/views/s4InspectorRating.test.tsx`, `tests/test_arrange.py` |
| Stem grid, solo, presets, AI, recovery and Apply | Studio | ADR-0102 | 8–64 cells, eight lanes, local revision guard | `web/src/views/Studio.test.tsx`, `web/src/views/StudioSafety.test.tsx`, `tests/test_studio.py` |
| Live song requests, search, waiting, cancellation | Requests drawer | ADR-0103 | No fabricated ETA, stale poll rejected | `web/src/views/Requests.test.tsx`, `tests/test_requests.py` |
| Bridge Finder, extra-song approval, rough override | Requests and Editor | ADR-0103 | Explicit consent and atomic idempotent insertion | `web/src/views/RequestsJoining.test.tsx`, `tests/test_requests_together.py` |
| Word lyric connections and ratings/add-pair | Explore / Discover words | ADR-0104 | Shared words, render key, atomic pair | `web/src/views/LinksRating.test.tsx`, `web/e2e/mp-0292-discovery.e2e.ts` |
| Harmonic four-stage audition and feedback | Explore / Discover harmonic | ADR-0104 | Stage order and playback ownership | `web/e2e/mp-0292-discovery.e2e.ts` |
| Library search, URL query, filters, readiness and pagination | Library | ADR-0105 | 20k fixture, deep page and Back/Forward | `web/src/views/Library.test.tsx`, `tests/test_library_edges.py`, `web/e2e/mp-0291-library.e2e.ts` |
| Song details, corrected BPM/Camelot, priority/Never play | Song Details | ADR-0106 | Measured vs effective, validation, original-file safety | `web/e2e/mp-0291-library.e2e.ts`, `tests/test_folder_relink.py` |
| Sources and analysis workers | Workspace | ADR-0107 | Watch/unwatch; partial/missing/paused | `web/src/views/Workshop.test.tsx`, `web/src/views/ex-0128-job-truth.test.tsx` |
| Cache budget, storage and diagnostics | Workspace | ADR-0107 | Slider recoverability and private-path redaction | `web/src/views/Workshop.test.tsx`, `web/e2e/mp-0293-workspace-operations.e2e.ts` |
| Saved project versus frozen FLAC export job | Editor / Activity / Workspace | ADR-0108 | FLAC decodes from exact frozen revision | `web/src/views/ExportJobs.test.tsx`, `tests/test_export_retry.py`, `web/e2e/flows.e2e.ts` |
| Blind listening A/B and learning | Workspace Learning | ADR-0109 | Protocol blindness, once-only submission | `web/src/views/ListeningStudyFlow.test.tsx`, `tests/test_listening.py` |
| All theme, density, keyboard and layout preferences | Global / Settings | ADR-0090, ADR-0092, ADR-0111 | System/Light/Dark persistence without audio change | `web/src/state/prefs.test.ts`, `web/e2e/finishing.e2e.ts` |
| Accessible controls, focus, overlay dismiss, Activity Undo | Shared UI | ADR-0094, ADR-0095, ADR-0110 | Keyboard/AT, scoped Undo and clear status | `web/src/ui/controls.test.tsx`, `web/e2e/pages.e2e.ts`, `web/e2e/overlay-arbitration.e2e.ts` |
| Local-first paths, Host/Origin, LRCLIB disclosure, PWA | Cross-cutting | ADR-0096, ADR-0111 | No unapproved external calls or loss of old-server support | `tests/test_api_contracts.py`, `web/src/localPrivacyCopy.test.ts`, `tests/test_flag_server.py` |
| Existing URL aliases and query history | Shell / Router | ADR-0092 | /listen, /mixes, /mixes/mine, edit routes, /library, /discover, /workshop/* | `web/src/router.test.tsx`, `web/src/App.test.tsx` |
| All failure, loading, empty, stale and recovery states | Cross-cutting | ADR-0095, ADR-0112 | No false readiness or lost pending intent | `web/e2e/mp-0297-loading-and-recovery.e2e.ts`, `web/src/state/s4StateTransitions.test.ts` |
| Large Library, long Editor and Studio performance | Cross-cutting | ADR-0111, ADR-0112 | 20k/100-song/64-cell scale and audio continuity | `web/e2e/integration.e2e.ts`, `web/e2e/mi-0162-performance.e2e.ts`, `tests/test_library_edges.py` |

## Route preservation

Keep `/listen`, `/mixes`, `/mixes/mine`, `/mix/current/edit`, `/mixes/drafts/:id/edit`, `/library`, `/discover`, `/discover/harmonic`, `/workshop/*`, and all aliases and existing URL-query semantics discovered at the exact baseline. A true Listen empty state must retain the Listen URL rather than disguise Explore as Listen.

## Full contract acceptance

- A feature is preserved only if the user can still find and operate it, not merely if its backend endpoint exists.
- Every mutation retains stable target identity, scope, audio consequence, revision and error recovery.
- No original song files are altered through Library correction, excluding or source-unwatch actions.
- New aspirational features-extra advanced metadata filters, remote/local artwork fetching, additional export formats, native folder chooser or true A/B version preservation-are optional separately scoped proposals unless validated by current APIs.
- Existing tests map to each capability; changed selectors should use roles/accessible names without dropping behaviour assertions.
