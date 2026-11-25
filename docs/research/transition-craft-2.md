# Transition craft, part two: what the engine still lacks (2026-11-25)

This builds on [transition-craft.md](transition-craft.md) (the four-layer model and the 66 rated
seams), [technique-catalogue.md](technique-catalogue.md), [dj-craft.md](dj-craft.md) and
[auto-dj-systems.md](auto-dj-systems.md). It does not repeat them. It records what a fresh pass
over the craft sources and the literature added, and what each finding asks of the engine.

**Tags:** [S] study or primary source, [P] working DJ or DJ school, [A] vendor or forum. Search
summaries are marked (summary): the page itself was not opened.

## 1. The ten rules, in the order they bite

A transition fails at the first rule it breaks, however good the rest is. The numbers in
brackets are the owner's own ratings (`planner/fit.py`, [transition-craft.md](transition-craft.md)).

1. **The right two songs.** Cue choice and pairing matter more than effect curves: swapping only
   the cue selection lost 0.75 of a 0.89 point lead in the DJustify test, and a learned effect
   model tied with a linear fade in DJtransGAN ([auto-dj-systems.md](auto-dj-systems.md)).
2. **One pulse.** Onsets within about 10 ms fuse; 10 to 40 ms is a flam. A beat-locked move
   needs a sure grid (confidence under 0.8: liked 0 of 6).
3. **One bass, one lead voice, no roughness.** Key matters only while tonal parts overlap (keys
   5+ apart: liked 2 of 11).
4. **The level holds.** Falls of 6 to 9 dB after a seam were all disliked.
5. **It happens on a phrase line.** Real mixes peak every 32 beats (Kim et al. 2020).
6. **Long enough to be a blend or short enough to be a statement.** 8+ bars within 4.5% tempo:
   liked 16 of 19. Four-bar overlaps: 0 of 7.
7. **The move keeps its promise.** A blend promises continuity, a build promises an arrival, an
   echo or cut needs an audible reason.
8. **It lands on something.** Cold intros were the worst-rated seams.
9. **Predictable underneath, surprising on top.** Beat, phrase and bass handling never surprise;
   the choice of move and the energy turn may.
10. **It serves the set.** Each seam holds, lifts or drops the energy on purpose.

## 2. New findings

### 2.1 Bands and stems should change hands at different moments

- DJ.Studio's tutorial and Mixgraph's long-blend guide describe the same order: bring the
  incoming highs in first, then trade mids, and swap the bass last on a phrase change; on the way
  out, remove highs and presence first, then mids, leaving sub and kick until the swap
  ([DJ.Studio](https://dj.studio/blog/dj-eqmixing), [Mixgraph](https://www.mixgraph.io/learn/dj-transition-techniques)) [A, summary].
  DJ TechTools notes the dissent: some house DJs avoid EQ cuts and mix full-frequency
  ([DJTT](https://djtechtools.com/2012/03/11/eq-critical-dj-techniques-theory/)) [P, summary].
- Robinson and Brown treat a crossfade as a seam through the spectrogram: each frequency bin
  gets its own switch time, found with a min-cut over a time-frequency graph
  ([arXiv 2301.13380](https://arxiv.org/abs/2301.13380)) [S, demo paper; no listening test found].
- Kim et al. showed real DJ transitions are reconstructed better by per-band gain curves than by
  one fader, and a 14-person test agreed
  ([NIME 2021](https://nime.pubpub.org/pub/g7avj1a7/release/1)) [S].

**For Selecta:** today only the low band is traded (`styles/blend.py` `_low_curves`). An offline
engine can search the handover bar of every band, and with stems of every stem, against its own
audit numbers (low end clash, harmony, vocal overlap, level). A person at the decks cannot try
hundreds of combinations; the renderer can. Planned as `band_weave`.

### 2.2 One tonal owner, like one bass owner

Stem tutorials agree on the moves: mute the incoming bass stem rather than cutting it with EQ,
drop one song's drums when two patterns are busy, and use an acapella as the bridge between two
instrumentals ([Digital DJ Tips](https://www.digitaldjtips.com/stems-live-redrums/),
[Native Instruments](https://www.native-instruments.com/blogs/blog/how-to-mix-stems)) [P, summary].
Key lives in the melody, bass and voice stems. If only one song's tonal stems sound at a time and
the other lends drums only, the overlap has no harmony to clash.

**For Selecta:** a planner rule (tonal owner) that lets a stem blend cross a key gap the gates
refuse today. This is a hypothesis: the ratings never tested it. It needs its own reel.

### 2.3 One drummer when the patterns fight

Guides for broken-beat genres say the same thing in different words: two four-on-the-floor
tracks sit together, but two busy or differently shaped drum parts should not overlap; make sure
only one track's drums play at the moment of transition
([Mixcloud](https://blog.mixcloud.com/2023/10/02/a-guide-to-beatmatching/),
[Digital DJ Tips](https://www.digitaldjtips.com/hardest-styles-of-djing/)) [P/A, summary].
Mosaikbox swaps incompatible drums with stems and measured a gain of about 0.38 on a 5-point
scale, on drum and bass only ([auto-dj-systems.md](auto-dj-systems.md)).

**For Selecta:** the audit checks that beats line up, never whether the two patterns reinforce
each other. Compare each bar's kick and snare pattern on a 16-step grid (from the drum stem, or
the low and mid band onsets without stems) and the swing ratio; when they disagree, the overlap
uses one song's drums and swaps on a bar line. I found no source on dembow against four on the
floor, or swung against straight, specifically.

### 2.4 Make room where a song has none

The standard fix for a short outro or a song with no intro is a loop: four or eight bars of the
last clean instrumental phrase, or of the incoming intro, mixed "as if it had a full length
intro"; the warnings are to leave the loop with a plan and not to let a short loop run without
movement ([DJ TechTools](https://djtechtools.com/2017/09/11/mixing-songs-dont-dj-intro-4-common-techniques/),
[Crossfader](https://wearecrossfader.co.uk/blog/dj-looping-guide/),
[Mixgraph](https://www.mixgraph.io/glossary/loop-out)) [P/A, summary].

**For Selecta:** when no 8-bar window exists, the planner drops to an echo or a cut, the moves
the owner rates lowest. A loop builds the window. In script terms it is repeated parts of the
same bars with short crossfades, so the renderer needs nothing new. With stems, loop the drums
only.

### 2.5 Key shift is real, small, and a whole-song decision

Rules of thumb put the safe range at one semitone, two at most; Pioneer's key sync never moves a
track more than two; VirtualDJ warns before larger shifts
([Digital DJ Tips](https://www.digitaldjtips.com/fuzzy-keymixing-the-easy-new-way-to-mix-anything-into-anything/),
[DJ TechTools](https://djtechtools.com/2013/05/15/mixing-in-key-when-and-how-to-change-track-key-in-dj-software/)) [P/A, summary].
In 1,557 real mixes only 2.5% of tracks were transposed, 94% of those by one semitone (Kim 2020).
A DJ shifts the track before bringing it in and leaves it shifted. Selecta renders only the seam
and returns to the native file, so a shift inside the clip would jump at the handover.

**For Selecta:** a whole-song shifted version, played for the song's whole stay. Later, and only
after a listening test. Not a seam effect.

### 2.6 A judge for "do these two belong together"

One vocal ride had perfect measurements and was still disliked: a pair problem, not physics.
COCOLA is a contrastive model that scores harmonic and rhythmic coherence between stems, built
to judge generated accompaniments; code and checkpoints are public, trained on MUSDB18-HQ,
MoisesDB, Slakh2100 and CocoChorales ([arXiv 2404.16969](https://arxiv.org/abs/2404.16969)) [S].
The 2025 AutoMashup work uses it and reports that compatibility is asymmetric: it depends on
which song gives the voice and which the band [S, summary].

**For Selecta:** a spike. Score A's voice stem against B's band before planning a ride. The
training data includes research-only sets, so the licence decides whether it may run in Cloud.

### 2.7 Calibration by hand

The gates in `planner/fit.py` were fitted by hand on 66 seams. Every seam now saves a `pair`
block of facts, and every published system says gates should be regressed on ratings
([auto-dj-systems.md](auto-dj-systems.md), "How to evaluate"). A job that re-fits the gates as
ratings arrive, and writes the cross-tabs here, removes the hand step.

## 3. What the products do now

- Apple AutoMix (iOS 26) time-stretches and beatmatches, is on or off only, and skips albums;
  complaints are cut-off endings and poor results outside dance and hip-hop. Spotify's Mix lets
  a person set volume, EQ and effect curves per transition and shows key and tempo; complaints
  are abrupt changes and tempo artefacts
  ([MacRumors](https://www.macrumors.com/2025/08/20/spotify-debuts-playlist-mixing-tool/),
  [BGR](https://bgr.com/2110632/spotify-new-transition-feature-better-than-apple-music)) [A, summary].
  Neither is reported to use stems or to check its own result.
- DJ.Studio's stem presets are a crossfade with a longer drum fade, and a swap where one song's
  stems stop as the other's start ([DJ.Studio](https://dj.studio/blog/song-stem-extractor)) [A, summary].

The gap Selecta can own is unchanged: render, measure, repair, and decide when not to overlap.

## 4. Order of work this implies

1. `band_weave` (2.1). 2. Loop-made room (2.4). 3. Tonal-owner rule (2.2). 4. Rhythm fit (2.3).
5. A rebuilt tempo bridge: the retired tempo ramp forced a 4-bar overlap (liked 0 of 3); DJs
ramp over 16 bars on a loop or drums only with the bass out
([technique-catalogue.md](technique-catalogue.md)). 6. The calibration job (2.7). 7. Spikes: the
coherence judge (2.6) and key-shifted versions (2.5).

Each is a recipe or planner rule, behind its own flag, kept only if the owner rates its reel up.

## 5. Gaps

- No listening test of per-band or per-bin handovers against a plain bass swap.
- No source on dembow or swing mismatch.
- No measured data on loops in automatic mixing.
- The pages marked (summary) should be opened before any number here is treated as a default.
