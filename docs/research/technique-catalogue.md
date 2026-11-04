# DJ transition technique catalogue for Selecta (November 2026)


**Tags**
- **S**: spec, manual, source code or measured.
- **P**: working DJ or DJ school tutorial.
- **A**: forum, vendor blog or marketing.
- **Calc**: my arithmetic.
- **Own**: my unsourced starting value.
- **(excerpt)**: read only in a search excerpt, page not opened.

mixgraph.io is a vendor glossary with some odd values, so it is always A.

**Process:** this took roughly 70 tool calls, well over researcher.md's guideline of 15, because of the scope. I created no files. Two read-only Python runs pulled text from a manual that WebFetch had saved.

## 1. What do mixers and DJ software actually specify?

### Takeaway
EQ depths and some crossovers are published. Sweep times, reverb decay in seconds and resonance values are not, so those defaults must be tuned by ear.

### Cited Findings

**EQ**

| Source | Bands or crossovers | Range | Tag |
|---|---|---|---|
| [Xone:96 guide](https://r2.gear4music.com/media/82/827295/download_827295.pdf), ch 1-4 | HI 3 kHz, HI MID 1.1 kHz, LO MID 350 Hz, LO 180 Hz | HI/LO +6 dB to full kill; mids +10/-27 dB | S |
| Same guide, ch A-B | HI 3 kHz, swept MID 190 Hz-2.75 kHz, LO 180 Hz | MID +10/-24 dB | S |
| [DJM-900NXS2 manual copy](https://www.manualslib.de/manual/156249/Pioneer-Dj-Djm-900Nxs2.html?page=13) | Printed points 30 kHz, 1 kHz, 20 Hz | -26/+6 dB each | S |
| [DJM-A9 listing](https://markertek.com/product/PIO-DJM-A9) | Not given | -26/+6 dB | A |
| [Mixxx LV-Mix](https://raw.githubusercontent.com/mixxxdj/mixxx/main/src/effects/backends/builtin/lvmixeqbase.h) | 246 Hz, 2484 Hz | Not applicable | S |
| [Mixxx full-kill biquad](https://raw.githubusercontent.com/mixxxdj/mixxx/main/src/effects/backends/builtin/biquadfullkilleqeffect.cpp) | Mid 1100 Hz; Q 0.3 boost, 0.9 mid kill, 0.4 shelf kill | Kill filter -23 dB, isolator path cut to zero; knob 0-0.25 maps -23 to -12 dB | S |
| [Traktor Z ISO](https://support.native-instruments.com/support/solutions/articles/69000879507-traktor-pro-2-eq-and-filter-models) | 24 dB/oct slope | Full kill; phase affected at centre | S |
| [Traktor thread](https://community.native-instruments.com/discussion/46176/traktor-4-eq-specifications) | Not given | Classic about +12/-24, P600 about +12/-26, NUO about +10/-25 to -30 | A |

- The Xone text extraction lost the infinity symbol. The kill reading comes from the guide's prose, seen in a search excerpt.
- The Pioneer points read as test frequencies rather than crossovers (my inference). [B&H](https://www.bhphotovideo.com/c/product/1590134-REG/pioneer_dj_djm_900nxs2_w_uxj4_djm900nxs2_white.html) prints the LOW band differently (excerpt).

**Faders**
- Mixxx constant power normalises gains as if the signals are uncorrelated, giving about 0.707 each at centre. Its code notes the right crossover ratio runs from 0.5 for equal signals to about 0.707 for uncorrelated ones. The curve exponent defaults to 1.0, range 0.6-1000 ([source](https://raw.githubusercontent.com/mixxxdj/mixxx/main/src/engine/enginexfader.cpp), S).
- Xone crossfader curves are constant power, transition and fast-cut. Channel faders are constant power, dipped and fast-cut, with shutoff under -85 dB at 1 kHz ([guide](https://r2.gear4music.com/media/82/827295/download_827295.pdf), S).

**Filters**
- Xone VCF: -3 dB cutoff from 20 Hz to 20 kHz. Resonance is unnumbered, running from mild to "just short of self-oscillation" ([guide](https://r2.gear4music.com/media/82/827295/download_827295.pdf), S).
- Mixxx filter: log-scaled 13 Hz-22.05 kHz, Q 0.4-4, default 0.707, using biquad LPF and HPF in series ([source](https://raw.githubusercontent.com/mixxxdj/mixxx/main/src/effects/backends/builtin/filtereffect.cpp), S).
- pedalboard HighpassFilter and LowpassFilter are first order at 6 dB/oct. LadderFilter offers LPF12/HPF12/BPF12 and LPF24/HPF24/BPF24 ([docs](https://spotify.github.io/pedalboard/reference/pedalboard.html), S).

**Delay and reverb**
- Mixxx echo: 1/8 to 2 beats, default 0.5. Feedback and send both default to 0.708 (-3 dB). Ping-pong 0, quantize on, triplets off. Each written sample is input times send plus delayed signal times feedback, then clamped ([source](https://raw.githubusercontent.com/mixxxdj/mixxx/main/src/effects/backends/builtin/echoeffect.cpp), S; argument order inferred).
- Mixxx reverb: decay 0-1 (default 0.5), bandwidth default 1, damping default 0. These are unitless ([source](https://raw.githubusercontent.com/mixxxdj/mixxx/main/src/effects/backends/builtin/reverbeffect.cpp), S).
- In Mixxx, reverb is the only time-based effect not synced to tempo. Effects sit after the faders, so tails outlive a fader pull. Filters shift phase, so a mid-position wet/dry mix can comb filter ([manual](https://manual.mixxx.org/2.5/en/chapters/effects), S).

**Brake and spinback**
- [Mixxx code](https://raw.githubusercontent.com/mixxxdj/mixxx/main/src/controllers/scripting/legacy/controllerscriptinterfacelegacy.cpp) (S):
  - Timer period 1 ms.
  - Alpha 1/512, beta (1/512)/1024 times factor.
  - Ramp target ±0.01.
  - Factors above 1 are compressed by (f-1)/10+1.
- [Mixxx wiki](https://github.com/mixxxdj/mixxx/wiki/Midi-Scripting) (S): spinback starts at rate -10, and factors of about 0.5 or lower leave the deck running at inaudibly low speed.

### Inferences
- A 200 Hz bass split sits between Xone's 180 Hz and Mixxx's 246 Hz.
- pedalboard's first-order filters are far gentler than a 24 dB/oct isolator, so they cannot do bass kills.

### Gaps
- Pioneer Beat FX table: every manual copy I tried was blocked or unavailable, and excerpts did not contain it.
- Pioneer crossover frequencies: not found.
- Xone VCF slope: my extraction did not capture it.
- Rane Seventy-Two EQ: the [spec page](https://manualslib.mx/manual/121506/Rane-Seventy-Two-Mkii.html?page=102) lists none.
- pedalboard Delay, Reverb and LadderFilter defaults: not readable in the docs page I fetched.
- Not reached: Serato, VirtualDJ, djay and full rekordbox manuals, and Mixxx Auto DJ defaults.

## 2. What is each technique, and when does it work or fail?

### Takeaway
Most techniques have clear execution steps but few numbers. The best sources are one measured study and Crossfader's step-by-step recipes.

### Cited Findings

**Blends**
- **Bass swap / EQ blend.**
  - Cut the incoming lows, play both tracks, then trade lows so one bass plays ([NI](https://www.native-instruments.com/blogs/blog/dj-transitions), P).
  - Timing varies: halfway through the incoming intro ([London Sound Academy](https://www.londonsoundacademy.com/blog/10-hip-hop-dj-transitions), P, excerpt; [Crossfader #10](https://wearecrossfader.co.uk/blog/12-high-energy-dj-transitions/), P), or at a phrase change (A, excerpt, source page not identified).
  - Fails because two kicks in one band sum unpredictably ([mixgraph](https://www.mixgraph.io/glossary/kick), A, excerpt).
  - No source gives the swap ramp time.
- **Single-phrase beatmatch.** Keep within about 5 BPM with no EQ moves. Start 16 or 32 bars before the outgoing outro and raise the fader slowly ([NI](https://www.native-instruments.com/blogs/blog/dj-transitions), P).
- **Long blend lengths.**
  - Measured: length histogram peaks every 32 beats (8 bars), in a dataset of 1,557 mixes that is mostly house and trance ([Kim et al.](https://ar5iv.labs.arxiv.org/html/2008.10267), S).
  - Progressive house: 32-64+ bars ([mixgraph](https://www.mixgraph.io/mixing-guide/progressive-house), A).
  - Hip-hop, D&B and open format favour short mixes and cuts ([NI](https://www.native-instruments.com/blogs/blog/dj-transitions), P).
  - Forum rule: 32 counts for hip-hop, 64 for house, with "counts" undefined ([DJTT forum](https://forum.djtechtools.com/t/intros-and-outros/111), A, excerpt).
  - Pop, R&B, Latin, Asian pop: no bar count found. Reggaeton is reportedly arranged in eight-bar sections ([MusicRadar](https://www.musicradar.com/news/reggaeton-tips-bad-bunny), production guide, excerpt, attribution unconfirmed).

**Effect exits**
- **Echo out.**
  - Engage a synced delay on the last beat, pull the fader, and bring the next track up as repeats decay ([mixgraph](https://www.mixgraph.io/glossary/echo-out), A, excerpt).
  - 1/2 or 1 beat at 30-40% wet ([Digital DJ Tips](https://www.digitaldjtips.com/do-you-know-how-to-use-these-3-essential-dj-effects/), P).
  - Crossfader uses a one-beat echo at 8 to 11 o'clock, sometimes 2 ([recipes](https://wearecrossfader.co.uk/blog/12-high-energy-dj-transitions/), P). That is 10-40% or 70% if 7-to-5 o'clock is linear (Calc).
  - Feedback 0.708 loses 3 dB per repeat, reaching -60 dB after 20 repeats, or 2.5 bars at 1/2 beat (Calc).
- **Delay throw.** One-beat echo on a vocal at 10 o'clock, then slam the fader ([Crossfader #11](https://wearecrossfader.co.uk/blog/12-high-energy-dj-transitions/), P).
- **Reverb wash.** Add reverb to the end of the outgoing section, let the tail decay, then bring in a track at another tempo ([Digital DJ Tips](https://www.digitaldjtips.com/do-you-know-how-to-use-these-3-essential-dj-effects/), P). No source gives decay in seconds.
- **Filter sweep.**
  - Incoming enters filtered, both filters move to neutral, outgoing fades ([NI](https://www.native-instruments.com/blogs/blog/dj-transitions), P).
  - A high-pass can replace the low EQ, but use it sparingly ([Digital DJ Tips](https://www.digitaldjtips.com/do-you-know-how-to-use-these-3-essential-dj-effects/), P).
  - One recipe raises the incoming fader over 4 beats, then sweeps a VAPORIZE effect on the outgoing track and the incoming low EQ ([Crossfader #2](https://wearecrossfader.co.uk/blog/12-high-energy-dj-transitions/), P).
  - No sweep length rule or time curve found.

**Cuts and drops**
- **Hard cut / cut on the one.** Cue the incoming downbeat and switch at a natural break, such as a chorus or drop ([NI](https://www.native-instruments.com/blogs/blog/dj-transitions), P). Tempo and key need not match (my inference, since nothing overlaps).
- **Drop swap.** Hot cue on the incoming drop, phrase-match so drops coincide, cut so one drop is heard. Being a beat off is obvious, and gradual music has no target moment ([mixgraph](https://www.mixgraph.io/glossary/drop-swap), A).
- **Double drop.** Both drops land together. Needs phrase, tempo and harmonic match, with no graceful exit ([Musician Wave](https://www.musicianwave.com/what-is-a-double-drop/), A, excerpt). No numeric tolerance found.
- **Power blend.** Two targeted searches found no definition. Treat it as undefined rather than a standard term.

**Loops and builds**
- **Loop roll / shrinking build.**
  - Loop the last bar, halve 8→4→2→1 beats, release on the downbeat ([mixgraph](https://www.mixgraph.io/glossary/loop-roll), A, excerpt).
  - That page also warns a roll over one bar sounds stuck, but Crossfader builds run longer: a 4-beat loop halved and doubled every 8 beats (#10), and 3/2→3/4→halved (#5) ([recipes](https://wearecrossfader.co.uk/blog/12-high-energy-dj-transitions/), P).
- **Riser.** A noise sweep over the last bars masks the join ([mixgraph](https://www.mixgraph.io/glossary/noise-fx), A, excerpt). No level or bar count found.
- **Silence before a drop.** A production guide puts silence between riser and drop, with no length ([FaderPro](https://blog.faderpro.com/techniques/3-tips-for-better-edm-drops/), P, excerpt). DJ.Studio's breakdown crossover silences the outgoing track before its beats return ([article](https://dj.studio/blog/dj-tempo-change-techniques), A).

**Tempo**
- **Tempo ramp / bridging.**
  - 104.1→126 BPM over 16 bars under an isolated vocal (#11).
  - 125→about 183 BPM over 16 bars on a 16-beat loop with bass off, a SPACE effect and Wide range (#12) ([Crossfader](https://wearecrossfader.co.uk/blog/12-high-energy-dj-transitions/), P).
  - These are +21% and +46%, or 1.4 and 3.6 BPM per bar (Calc).
  - DJ.Studio caps one transition at roughly 25-30%, then falls back to half or double tempo ([help](https://help.dj.studio/en/articles/15359028-double-and-half-tempo), A).
  - A build-and-drop switch ignores the gap, for example 120→72 ([DJ.Studio](https://dj.studio/blog/dj-tempo-change-techniques), A).
- **Halftime / doubletime.**
  - One bar slow equals two bars fast, so 4 bars at 60 equals 8 at 120 ([Digital DJ Tips](https://www.digitaldjtips.com/how-to-mix-using-half-time-and-double-time-bpms/), P).
  - Prefer a cut over a long crossfade ([DJ.Studio](https://dj.studio/blog/dj-tempo-change-techniques), A).
  - DJ.Studio treats 150 and 77 as half tempo, which is 2.7% off exact (Calc) ([help](https://help.dj.studio/en/articles/15359028-double-and-half-tempo), A).
  - Fails when analysers report half the true tempo ([Digital DJ Pool](https://digitaldjpool.com/blog/dj-bpm-guide/), A, excerpt).
- **Pitch bend.** Crossfader #9 nudges the jog to tighten a loop (P). No numeric parameter found.

**Brakes and stutters**
- **Backspin / spinback.** Start on the first beat of a new phrase and fade slowly ([Bonedo](https://www.bonedo.de/artikel/spinbacks-und-brake-effekte-im-dj-mix-richtig-einsetzen), P, excerpt). No beatmatch needed ([mixgraph](https://www.mixgraph.io/glossary/brake), A, excerpt). A rekordbox tutorial sets backspin to 4/1 ([tutorial](https://www.virtualclubbinglife.com/?p=210031), P, excerpt).
- **Brake.** Vinyl brake at 4/1 with Hold in that same tutorial. Crossfader winds a loop down into the next drop with touch release at about 3 o'clock (#3), and brakes with touch release on Slow in #7 and #9 ([recipes](https://wearecrossfader.co.uk/blog/12-high-energy-dj-transitions/), P). No stop time in seconds found.
- **Stutter.** Toggle a 1-beat loop with its half and chop with the crossfader (#3). Or press play/pause rhythmically for 8 beats, cut for 4, then brake (#9) (same recipes, P).

**Stems**
- **Acapella over instrumental.** Mute the outgoing vocal and lay the incoming acapella over its instrumental ([DJ.Studio help](https://help.dj.studio/en/articles/9292881-making-mashups-with-stem-separation), A). Works best when tempo and key match; separation does not fix a clash ([stem guides](https://stemsplit.io/blog/dj-stem-separation-guide), A, excerpt).
- **Staged stem swap.** A 16-bar sequence: bass bars 1-4, drums 5-8, vocals 9-12, melody 13-16, then fade the outgoing track ([StemSplit](https://stemsplit.io/blog/dj-stem-separation-guide), A).
- **Vocal loop weave ("Wordplay").** One-beat echo at 9 o'clock before the verse, 4-beat vocal stem loop, start Deck 2, chop the fader for 16 bars, then remove Deck 2's vocal, unloop Deck 1 and echo it out ([Crossfader #1](https://wearecrossfader.co.uk/blog/12-high-energy-dj-transitions/), P).
- **Mashup layering.** Two acapella decks at different pitches (#4). Pitch-play melody (#6). Key-shifting single words to match the other track (#11) (same recipes, P).

**Key**
- **Harmonic mixing and energy boost.** [Mixed In Key](https://mixedinkey.com/workflows/change-energy-with-camelot-wheel/) (P):
  - ±1 is smooth.
  - A letter switch shifts mood.
  - +2 gives a noticeable lift, in moderation.
  - -5 is a stronger change.
  - Shorten the overlap if melodies clash.
  - -5 equals +7, which is one semitone up; +2 is two semitones up (Calc).
- **Key shift.** Only 2.5% of 24,202 played tracks were transposed, and 94.3% of those by one semitone ([Kim et al.](https://ar5iv.labs.arxiv.org/html/2008.10267), S; mostly house and trance).

**Ornaments**
- **Scratch-style.** Flares can open, close or transition songs ([DJ Courses Online](https://djcoursesonline.com/dj-blog/free-dj-lesson-open-fader-scratches), P, excerpt). No numeric parameters found.
- **Sound effects and DJ drops.** [DJcity](https://news.djcity.com/tag/turntable-techniques/page/2/) covers "transition stingers" (P, excerpt, no detail). The only air-horn page I found was low trust, so I did not use it.

**Other named moves**
- Same-song switch-up (#2).
- Slip-mode chop (#8).
- Polyrhythmic mixing, for example 60 with 120 or 180 ([DJ.Studio](https://dj.studio/blog/dj-tempo-change-techniques), A).

### Inferences
- Real-world transitions cluster on 8-bar multiples, at least in house and trance.
- Big tempo moves succeed by hiding the ramp under a loop, breakdown or isolated vocal, with the bass off.

### Gaps
- No bar counts for pop, R&B, Latin or Asian pop.
- No EQ automation data from real mixes; Kim et al. report none. A follow-up study on fader and EQ estimation may exist, but I did not check it.
- Not reached: School of Sound and Point Blank tutorials, and most Digital DJ Tips and DJ TechTools technique pages.
- Several technique entries rest on excerpts or vendor glossaries, so treat them as lower confidence.

## 3. How far can pitch, stretch and stems go?

### Takeaway
No library publishes an audibility limit. Practice clusters under 5% tempo change and one semitone.

### Cited Findings

**Pitch and tempo**
- 86.1% of tempo adjustments were under 5%, 94.5% under 10%, 98.6% under 20% ([Kim et al.](https://ar5iv.labs.arxiv.org/html/2008.10267), S).
- Key-lock artefacts grow outside about 5%, and Traktor broke down past about ±30%. The test dates from 2014 ([DJ TechTools](https://djtechtools.com/2014/03/16/keylock-in-dj-softwares-compared-serato-dj-traktor-pro-virtual-dj), P).
- Tempo detection thresholds in the literature:
  - About 2% ([Dahl & Granqvist](https://vbn.aau.dk/ws/portalfiles/portal/65338357/DahlGranqvistVenezia_proc3subm_openacc.pdf), S, excerpt).
  - 3-6%, falling as the sequence lengthens ([paper](https://typeset.io/pdf/time-discrimination-in-a-monotonic-isochronous-sequence-ynslrz5yhj.pdf), S, excerpt, attribution unconfirmed).
  - About 5-10% for music ([Quené](https://cspeech.ucd.ie/rppw/rppw10/quene/abstract.html), S, excerpt).
- Lab pitch discrimination is about 3 cents ([review](https://arxiv.org/pdf/2307.00084), S, excerpt, attribution unconfirmed).
- Without key lock (Calc):
  - +1% is 17 cents.
  - +3% is 51 cents, about halfway to the next semitone.
  - One semitone is +5.95% or -5.61%.

**Rubber Band**
- R3 almost always beats R2, at much higher CPU cost ([usage](https://breakfastquay.com/rubberband/usage.txt), S).
- R3 suits complex mixes, vocals and bass-heavy music. Transients, detector, phase and smoothing options are R2 only and R3 ignores them. Formant preservation helps vocals on pitch shifts. Changing pitch over time needs high-consistency mode in real time ([API](https://breakfastquay.com/rubberband/code-doc/classRubberBand_1_1RubberBandStretcher.html), S).
- Crispness `-c 6` may suit drums, and `-c 1` piano ([usage](https://breakfastquay.com/rubberband/usage.txt), S).
- No ratio limit is stated in the [API](https://breakfastquay.com/rubberband/code-doc/classRubberBand_1_1RubberBandStretcher.html), [usage](https://breakfastquay.com/rubberband/usage.txt) or [technical notes](https://breakfastquay.com/rubberband/technical.html) (S).
- `pedalboard.time_stretch` ([docs](https://spotify.github.io/pedalboard/reference/pedalboard.html), S):
  - Values above 1.0 shorten the audio.
  - Accepts per-sample arrays.
  - Changes more often than every 1,024 samples have no effect.
  - Defaults: `high_quality=True`, `transient_mode='crisp'`, `preserve_formants=True`.
- Listening data: quality rises as the ratio nears 1, and slowing rates lower than the inverse speed-up. Rubber Band was not tested, and only one training ratio sits within 10% of 1 (0.9961). The test-set ratios are not listed ([Roberts & Paliwal](https://ar5iv.labs.arxiv.org/html/2006.00848), S).

**Demucs**
- SDR in dB ([paper](https://ar5iv.labs.arxiv.org/html/2211.08553), S):

| Model | Drums | Bass | Other | Vocals |
|---|---|---|---|---|
| htdemucs | 10.05 | 9.78 | 6.42 | 8.93 |
| htdemucs_ft | 10.08 | 10.39 | 6.32 | 9.20 |

- `htdemucs_ft` takes 4 times longer. Hybrid Transformer models allow at most 7.8 s per segment. The author is no longer actively developing it ([README](https://github.com/adefossez/demucs), S).
- `apply_model` defaults: `shifts=1` (random up to 0.5 s), `overlap=0.25`, triangular weights, `transition_power=1` ([source](https://raw.githubusercontent.com/adefossez/demucs/main/demucs/apply.py), S).

**Artefacts**
- Reported problems: reverb and delay bleed into other stems, kick and bass separate imperfectly, heavily processed vocals leak into "other". Fix: 80 Hz high-pass on a vocal stem with kick bleed ([StemSplit](https://stemsplit.io/blog/dj-stem-separation-guide), A).
- [DJ.Studio's benchmark](https://dj.studio/blog/dj-software-stem-separation-benchmark) describes a method but publishes no numbers (A).

### Inferences
- A 16-bar ramp under about 2-3% is likely hard to notice.
- Key mismatch shows up only when tonal parts overlap, so exit effects and cuts avoid the problem.
- "Other" is the weakest stem, so swaps that expose it alone carry the most risk.
- Triangular weights give window edges little support, so give Demucs extra audio either side.

### Gaps
- No audibility threshold for pop vocals. The Schellenberg and Trehub work on pitch memory for familiar songs did not surface.
- No Rubber Band listening data separating vocals from drums.
- Not confirmed whether `high_quality=True` selects R3.
- No working DJ source on hiding stem artefacts in transitions.
- I did not assess separators newer than Demucs.

## Design implications for Selecta

**Rules for all recipes**

The tier boundaries and split frequency are Own, informed by the sources above.

- **Bass:** one low-end owner at all times. Split at 200 Hz, 24 dB/oct, full kill.
- **Filters:** use LadderFilter HPF24/LPF24 or your own crossovers, not pedalboard's 6 dB/oct filters.
- **Gain:** equal power between different tracks. Linear when recombining stems of one track (correlated signals).
- **Tempo tiers:**
  - Up to 5%: beat blend.
  - 5-10%: ramp, or split the gap between tracks.
  - 10-30%: ramp only over a breakdown or loop with bass off.
  - Above 30%: half or double tempo if the ratio is within 3%, otherwise exit effect or cut.
- **Key gates:**
  - Overlapping tonal parts: Camelot 0, ±1 or letter switch.
  - Boost moves (+2, +7): short overlap only.
  - Otherwise shift ±1 semitone, or use a recipe with no overlap.
- **Vocals:** never overlap two lead vocals.
- **Demucs:** use `htdemucs` by default, `shifts=0` for repeatable renders, and at least 2 s of extra context each side of the window, trimmed afterwards.
- **Stretching:** keep each track within ±5% where possible, and prefer speeding up to slowing down. Test stems stretched separately against a stretched full mix, since no source covers this.

**Default parameters**

| Recipe | Gate | Length | Core defaults | Basis |
|---|---|---|---|---|
| `cut_on_one` | None | 0 bars | Cut on incoming downbeat at phrase end; 10 ms declick | P, Own declick |
| `echo_out` | None | Tail 2-3 bars | 1/2 beat (1 beat if slow), feedback 0.5-0.7, wet 35%, dry cut at phrase end, return high-pass 250 Hz | S/P; Own high-pass |
| `delay_throw` | Vocal phrase end | 1-2 bars | 1 beat, wet 30%, feedback 0.5, send open on last word only | P, Own |
| `bass_swap_blend` | Up to 5%, key gate, no vocal clash | 8 bars hip-hop, R&B, Latin, Asian pop; 16 pop, dance; 32 house | Incoming lows killed, swap over 1 beat at midpoint on a phrase line | P, Own lengths and ramp |
| `long_blend` | Up to 2%, instrumental intro and outro | 32 bars; 64 progressive only | Mids shift gradually, bass swap as anchor | P/A, Own gate |
| `filter_sweep` | Up to 5% | 8-16 bars | Log frequency, linear in time; outgoing high-pass 20 Hz→2 kHz; incoming low-pass 200 Hz→20 kHz; Q 0.7, max 2 | S ranges, Own values |
| `reverb_wash` | Any | 2-4 bars | Wet rising to 60%, about 4 s tail, return high-pass 300 Hz | Own, no source |
| `drop_swap` | Labelled drops, phrase aligned | 0 bars | Cut on incoming drop; optional 1-beat gap | A, Own gap |
| `double_drop` | Up to 2%, Camelot 0 or ±1, no vocals | 8-16 bars | One bass killed, phrase locked | A, Own |
| `loop_roll_build` | Before a phrase line | 1-4 bars | Halve 4→2→1→1/2 beats, release on downbeat; 5 ms loop seams | A/P, Own seams |
| `riser_air` | Before a drop | 4-8 bars | High-pass noise rising, -18 dB, 1 beat of silence | Own |
| `tempo_ramp` | 5-30% | 16 bars | Linear BPM on a loop or breakdown, bass off | P, Own gate |
| `half_double` | Ratio within 3% of 2:1 | 0-8 bars | Map 1 slow bar to 2 fast bars; prefer a cut | P/A, Own gate |
| `brake` | Any | 1 bar | Rate 1→0.01, then next track on downbeat | S target, Own length |
| `backspin` | Any | 1-2 beats | Start at -10×, decaying; fade out; new phrase start | S/P, Own length |
| `vocal_swap` | Up to 5%, Camelot 0 or ±1 | 8-16 bars | Outgoing vocal off, incoming on, 4 bars per stage; instrumental as mix minus vocals | A, Own |
| `staged_stem_swap` | Up to 5%, key gate | 16 bars | Bass, drums, vocals, melody, 4 bars each | A, Own gate |
| `key_shift` | Key gate fails | Not applicable | ±1 semitone, ±2 maximum; formants on for vocals | S/Own |

**Build order for mixed-genre music**
1. `cut_on_one` and `echo_out`. Always valid, and they suit hip-hop and any tempo or key mismatch.
2. The tempo, half/double and key gates, because every recipe depends on them. Correct half-tempo analysis errors here.
3. `bass_swap_blend`, which covers dance and much pop.
4. `vocal_swap`, which handles vocal-heavy pop, R&B and Asian pop, where vocal clash looks like the main risk (my inference).
5. `filter_sweep`, `reverb_wash` and `delay_throw`.
6. `tempo_ramp`, then `loop_roll_build` and `drop_swap`.
7. `brake`, `backspin` and `riser_air`, capped per set so they stay occasional (Own).
8. `double_drop` and mashup layering. Scratch last, since no source gives parameters.

Because no numbers exist for Latin or Asian pop, run listening tests on those genres before treating any length as final. Start from 8 bars.
