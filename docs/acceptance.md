# Build-plan acceptance ledger

This is an evidence ledger, not a marketing checklist. “Implemented” means code and synthetic
tests exist. “Needs listening” means the implementation is complete but the plan explicitly
requires a person or this specific music library to judge it.

## Implemented

- Incremental library scan, reversible non-music filtering and duplicate detection.
- CPU beat/downbeat, section, energy, loudness, key and timbre analysis with resumable refresh.
- Declarative `TransitionScript` renderer, warping, 24 dB/oct band ownership, effects, limiting,
  audit checks, repair attempts and a never-silent fallback.
- Core and extended recipe catalogue, including stem-backed and wordplay modes.
- Local-only API; persistent queue, steering and preferences; song-ID-only audio access.
- Type-led React UI for Start/Deck, Arc, Found, Crate, Workshop, Stage and Listening Room.
- Rolling beam planner, visible energy arc, joint transition feasibility and persistent queue.
- Sequential LRCLIB retrieval, token-safe lyric links, word-cut confidence gate and boundary snap.
- On-demand windowed Demucs with a 5 GB LRU cap; it never precomputes the whole library.
- Seam Book searches for lyric, hook, transposed melody and harmonic relationships.
- Blind 1–5 ratings, reason tags and bad-transition-rate reporting.

## Needs this library and the user's ears

- Stage 1 timing report is complete: 21 real songs averaged roughly 26 seconds on this laptop,
  projecting about five hours for the 707-track music library. The 20-song beat/downbeat/key
  listening page is at `reels/beat-check/grid.html` (local and intentionally ignored by Git).
- Listening check 1 is rendered at `reels/check-1/index.html`: five audit-passing transitions
  covering echo, clean cuts and a reverb wash. Its ratings are still needed before recipe tuning.
- Listening reels 2–3 and recipe tuning.
- Mix-versus-vocal alignment bake-off across ten multilingual songs.
- Discovery usefulness ratings.
- The approximately 60-pair blind comparison against fixed crossfade, cue-search, commercial and
  human baselines. “Best DJ” is not considered proven until Selecta wins on bad-transition rate.

These cannot truthfully be marked passed without the user's music database and listening results.
