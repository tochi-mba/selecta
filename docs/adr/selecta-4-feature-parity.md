# Selecta 4.0 - feature preservation and no-regression mapping

- **Proposed:** 2026-11-07.
- **Baseline:** `main` `9b663f9f10212619f27ce67ce82f602347065cbd` (PR #25 and PR #26 already merged at review).
- **Status:** 25 decisions **Proposed**; 250 tasks **Not started**; **0 Implemented / 0 Verified**.
- **Change scope:** Documentation only; no frontend, backend, audio, database, test or CI changes.
- **History:** ADR-0001–0088, T/P/S3/S31 identities and their historical evidence remain unchanged.


This is a **prospective mapping**, not a claim of verified parity. ADR-0089 requires a source-backed exhaustive inventory of every existing control including obscure menus. Missing capabilities discovered in implementation must be added, not silently removed to fit design.

| Existing capability | Proposed surface | Responsible ADR | Must retain |
|---|---|---|---|
| First-run folder path, validation and scanning | Onboarding / Workspace Sources | ADR-0096, ADR-0106 | Exact path, six-ready threshold, file safety, lyric privacy |
| Selecta's pick, The moment/mood/sound/journey | Explore | ADR-0097 | Suggestion status, Play, Edit first, Save draft |
| Energy five-point shape, feel, duration and cue destination | Explore customization | ADR-0097 | Steering persisted, scope clear, destination ID |
| Current mix Play/Pause/Next/previous/seek and Media Session | Listen and mini-player | ADR-0093, ADR-0098 | One audio owner, precise seek/jump semantics |
| Lyrics, spectrum, waveforms and Stage | Listen | ADR-0098 | Timed/untimed, fullscreen denied, reduced motion |
| Current vs saved drafts, copy/rename/delete and render line | My Mixes | ADR-0099 | No wrong scope; render queue not playback list |
| Editor reorder/add/remove/lock/Undo/preview | Mix editor | ADR-0100 | Pointer/touch/keyboard, stable song ID |
| Transition moves, cue, fallback, why, rating | Inspector | ADR-0101 | Requested vs actual rendered, keyed preview |
| Stem grid, solo, presets, AI, recovery and Apply | Studio | ADR-0102 | 8–64 cells, eight lanes, local revision guard |
| Live song requests, search, waiting, cancellation | Requests drawer | ADR-0103 | No fabricated ETA, stale poll rejected |
| Bridge Finder, extra-song approval, rough override | Requests and Editor | ADR-0103 | Explicit consent and atomic idempotent insertion |
| Word lyric connections and ratings/add-pair | Explore / Discover words | ADR-0104 | Shared words, render key, atomic pair |
| Harmonic four-stage audition and feedback | Explore / Discover harmonic | ADR-0104 | Stage order and playback ownership |
| Library search, URL query, filters, readiness and pagination | Library | ADR-0105 | 20k fixture, deep page and Back/Forward |
| Song details, corrected BPM/Camelot, priority/Never play | Song Details | ADR-0106 | Measured vs effective, validation, original-file safety |
| Sources and analysis workers | Workspace | ADR-0107 | Watch/unwatch; partial/missing/paused |
| Cache budget, storage and diagnostics | Workspace | ADR-0107 | Slider recoverability and private-path redaction |
| Saved project versus frozen FLAC export job | Editor / Activity / Workspace | ADR-0108 | FLAC decodes from exact frozen revision |
| Blind listening A/B and learning | Workspace Learning | ADR-0109 | Protocol blindness, once-only submission |
| All theme, density, keyboard and layout preferences | Global / Settings | ADR-0090, ADR-0092, ADR-0111 | System/Light/Dark persistence without audio change |
| Accessible controls, focus, overlay dismiss, Activity Undo | Shared UI | ADR-0094, ADR-0095, ADR-0110 | Keyboard/AT, scoped Undo and clear status |
| Local-first paths, Host/Origin, LRCLIB disclosure, PWA | Cross-cutting | ADR-0096, ADR-0111 | No unapproved external calls or loss of old-server support |
| Existing URL aliases and query history | Shell / Router | ADR-0092 | /listen, /mixes, /mixes/mine, edit routes, /library, /discover, /workshop/* |
| All failure, loading, empty, stale and recovery states | Cross-cutting | ADR-0095, ADR-0112 | No false readiness or lost pending intent |
| Large Library, long Editor and Studio performance | Cross-cutting | ADR-0111, ADR-0112 | 20k/100-song/64-cell scale and audio continuity |

## Route preservation

Keep `/listen`, `/mixes`, `/mixes/mine`, `/mix/current/edit`, `/mixes/drafts/:id/edit`, `/library`, `/discover`, `/discover/harmonic`, `/workshop/*`, and all aliases and existing URL-query semantics discovered at the exact baseline. A true Listen empty state must retain the Listen URL rather than disguise Explore as Listen.

## Full contract acceptance

- A feature is preserved only if the user can still find and operate it, not merely if its backend endpoint exists.
- Every mutation retains stable target identity, scope, audio consequence, revision and error recovery.
- No original song files are altered through Library correction, excluding or source-unwatch actions.
- New aspirational features-extra advanced metadata filters, remote/local artwork fetching, additional export formats, native folder chooser or true A/B version preservation-are optional separately scoped proposals unless validated by current APIs.
- Existing tests map to each capability; changed selectors should use roles/accessible names without dropping behaviour assertions.
