# What makes a transition sound good

Research notes behind the `feat/transition-craft` changes (2026-11-17): the DJ craft, the
perception science underneath it, and what the listener's own 66 rated seams proved. The planner's
calibrated limits live in `src/selecta/planner/fit.py`; this file is the why.

## The model: four layers, lowest first

A transition must pass each layer before the one above can matter.

### Layer 0 - psychoacoustic floor (violations are always bad)

1. **One pulse.** Listeners entrain to a single beat in the roughly 200-1500 ms period range.
   Two onsets fuse into one event only within about 10 ms; 10-40 ms reads as a flam; beyond
   that, two competing pulse trains are a trainwreck. The audit's 20 ms, 75th-percentile beat
   check matches the science: jitter matters as much as offset.
2. **One low end.** Below about 200 Hz the ear's critical bands are wide, so two bass sources
   share one auditory filter and mask or beat against each other ("mud"). Exactly one song owns
   the bass at any instant, handed on a bar line. This is the craft's most-named error.
3. **Low roughness.** Sensory dissonance (Plomp-Levelt) peaks when partials sit about a quarter
   of a critical band apart. Key labels are a proxy; measured chroma against the interval kernel
   is the truth. `planner.true_key` asks the kernel before paying for a render.
4. **One lead voice.** Two intelligible vocal streams fight for one attention channel. Lyrics
   only describe the lead vocal, and only on synced songs; `analysis.vocal_sense` listens to the
   demucs voice stem where lyrics can't say.
5. **Loudness continuity.** A level fall reads as the party dying (the reels' worst moments fell
   6-9 dB); a jump reads as a jolt. Falls hurt more than rises.
6. **Honest speed.** Rubber Band `time_stretch` preserves pitch, so the craft rule "6% tempo is
   a semitone" does **not** apply to Selecta's renders. It applies to varispeed only. No detune
   penalty is needed; the audit's stretch cap (8%) is about artifacts, not pitch.

### Layer 1 - metric grammar

Music is a hierarchy: beat, bar, 4/8-bar phrase, 16/32-bar section. Listeners keep unconscious
counters at every level, and a transition is an event that is expected at boundary points. A
mid-phrase switch is a prediction error with no reward: "bumpy however clean the beatmatch".
Cue-point research (Zehren et al.) places switch points on strong beats at period boundaries.
Half- and double-time pairs are one pulse (87 against 174 BPM); bar books must stay matched, one
slow bar to two fast bars. Hence `analysis.phrases` and the folded `beat_lock`.

### Layer 2 - the move is a promise

Expectation research (Huron's ITPRA; the Music Perception build/drop study) says pleasure is
tension built and a prediction confirmed at the right instant. Each move promises something:

- **A blend promises continuity**: folded gap within 4.5%, 8+ bars, compatible key, one bass,
  one voice. The local ratings prove the envelope exactly (16 good of 19 inside, 1 of 10 out).
- **A roll or build promises an arrival**: B must land on a chorus or an energy step, at equal
  or higher energy, on the promised downbeat (`planner.arrival`).
- **Punctuation promises a moment**: an echo, cut or wash needs an audible reason - a finished
  line, a structural turn - or it reads as a mistake (`planner.motivated_punctuation`). This is
  why wordplay works: the shared word is the audible reason.
- **Micro-predictable, macro-surprising.** "Too algorithmic" decodes as surprise at the wrong
  level. Beat, phrase and bass handling must be utterly predictable; the move choice, the
  wordplay and the key lift are where surprise belongs.

### Layer 3 - energy narrative

Every seam makes one energy decision - hold, lift or drop - and the move must match it: blends
hold, sweeps and builds lift, echo-outs drop. An echo at peak energy deflates the floor; a hot
exit into a cold intro is an unintended drop (`planner.energy_intent`).

## What the 66 rated seams proved (35 Good / 31 Bad, re-crossed 2026-11-17)

- Overlaps with gap <= 4.5% AND bars >= 8: **16G/3B (84%)**. Break either: **1G/9B**. All seven
  rated 4-bar overlaps were disliked, in every genre.
- Phrase rolls with gap <= 15% AND keys <= 3: **4G/1B**; everything else 4G/10B.
- Keys 5+ apart: **2G/9B** across every move family, cuts included.
- Audit-warned seams: **0G/4B**. Clean audit is necessary, not sufficient: 27 clean seams were
  still disliked - the audit hears Layer 0, not Layers 1-3.
- Grid confidence 0.55-0.8 beat-locked: **0G/6B** (the dead zone). Below 0.5 the engine already
  avoids beat-locking and punctuation sometimes lands (4G/5B).
- tempo_ramp: **0G/3B** lifetime; its design forces the proven-bad 4-bar length.
- Seam duration 25-35 s: 77% good. 15-25 s: 40%. Short punctuation (~13 s): fine.
- Substituted moves beat honoured requests (67% vs 49%): the fallback ladder is healthy; first
  choice was the weak link.
- vocal_ride 6G/2B; one bad ride had perfect measurements - pair musicality, not physics.

The ratings backup these came from: `C:\Users\tochi\selecta-ratings-backup-2026-11-17`
(ratings.json plus every raw seam record from the four old data homes).

## Known deferrals

- **Studio / strip-and-land / intertwine through `render/engine.py`: done behind
  `render.one_engine` (2026-11-25, on by default, waiting on the owner's ears).** With it on,
  each shape or intertwine is a script of eight stem parts (`render/stem_seam.py`), so B gets
  the pocket nudge, `tighten_beats` takes a second take when the beats sit apart, and the audit
  hears vocal spans measured from the voice stems, a muted lane counting as silent. The clip
  now runs 2 s of B's full mix past the overlap so the nudge can fade out; the hand-over to
  B's full mix stays at the end of the overlap. With it off, the old private mixes play exactly
  as before. Still not done: the old mixes are not deleted (that waits for the listening stop),
  seams already rendered keep their old audio until rendered again, and B's stems are now
  stretched on every take rather than once per session, so strip and land renders more slowly.
- **Word and ride moves fold half/double time: done behind `render.one_engine`.** `word_blend`,
  `vocal_ride` and `word_exchange` lock with `fold_ratio` and the folded `beat_lock`, and
  `modes_for` reads its unchanged tempo limits off the folded gap. `phrase_roll` and `word_cut`
  never lock beats, so they have nothing to fold; the roll's 15% and 3 key limits are unchanged.
- Audit thresholds remain uncalibrated against ratings; the per-seam `pair` block now stored
  with every render is what future calibration will read.

## Sources

Craft: Digital DJ Pool, djtechreviews, mixgraph.io, vibesdj.io, djlearn.de, djkit's rule of 32,
The Ghost Production on phrasing, dj.studio (mix anatomy, mashups, tempo tricks), Digital DJ
Tips (half/double time), MusicRadar, Mixed In Key, StemSplit, VirtualDJ, Pioneer DJ genre guide,
Grandmaster Flash's quick-mix lineage (Wikipedia), DJ AM tributes (Fool's Gold, Cuepoint),
proaudio.co.za on South African mixing, routenote and artistrack on amapiano/afrobeats.

Science: Plomp & Levelt (1965) roughness and its implementations (Leman DAFX-00, Porres' Pure
Data dissonance toolbox, Sethares' kernel); auditory masking (Wikipedia; mastering blogs on
kick/bass separation); beat entrainment and microtiming (Frontiers in Psychology 2016; PMC jazz
microtiming studies); onset fusion and the precedence effect (clicks fuse under ~10 ms, speech
to ~50 ms, music up to ~100 ms); Huron, *Sweet Anticipation* (MIT Press 2006); "Building the
Anticipation" (Music Perception, UC Press); Dancecult 6(1) on build-ups and drops; Zehren et
al., "Automatic Detection of Cue Points for DJ Mixing" (arXiv:2007.08411); Nam et al., mix-to-
track alignment (arXiv:2008.10267).
