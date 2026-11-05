# Build-plan acceptance ledger

This is an evidence ledger, not a marketing checklist. “Implemented” means code and synthetic
tests exist. “Needs listening” means the implementation is complete but the plan explicitly
requires a person or this specific music library to judge it.

## Existing foundations (not proof of end-to-end completion)

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

## Confirmed implementation gaps — goal remains active

Current source inspection supersedes the broad completion claims above.

- Browser playback serves original encoded songs, reloads after queue actions, and does not
  schedule rendered transitions or provide gapless audio-clock playback.
- The Deck section strip, lyric text, Stage lyrics and Why explanation are placeholders.
- Workshop Pause/Analyse buttons, Crate Never play, and Listening Room ratings are unwired.
- Per-seam preferences are stored in queue.transition but full-set exports ignore them.
- Set-wide mixing preferences filter planning but do not consistently control rendering.
- Stem cache eviction does not protect priority songs or account for the full storage budget.
- No directory watcher automatically schedules newly added music.
- Word matching lacks verified forced alignment integration; word recipes must not imply
  word-accurate execution from estimated LRC line boundaries.
- Stem preview bar alignment exists, but its vocal fades still use fixed relative positions
  instead of verified phrase endings, and it bypasses the common transition audit.
- Melody discovery currently compares average chroma: this cannot establish a shared melody,
  sample fingerprint, or rhythmic relationship. Those discovery layers remain unfinished.
- Several extended recipes are aliases or approximations rather than the named technique.
- Whole-package test coverage was last measured at 60.8%; browser and model-backed integration
  coverage remains insufficient. A green current suite does not establish plan completion.
- Ten earlier four-song sets exist, but they were rendered before the latest stem improvements.
  Regeneration and listening comparison remain required.

Completion requires working runtime behavior and tests for these paths, then actual listening
evidence for the subjective criteria. No item is complete merely because a screen or function exists.
