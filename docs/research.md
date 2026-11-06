# Research behind Selecta

Researched in November 2026, before any code was written. This page is the summary. The detailed notes, with a source link on each claim and an evidence rating, are in six files:

| Notes | Covers |
|---|---|
| [dj-craft.md](research/dj-craft.md) | How good DJs choose tracks, shape a set and handle genre jumps |
| [wordplay.md](research/wordplay.md) | What wordplay transitions are, how they're performed, what makes them land |
| [technique-catalogue.md](research/technique-catalogue.md) | Every named transition, with parameters where any exist |
| [auto-dj-systems.md](research/auto-dj-systems.md) | Academic systems, commercial products, how transitions get evaluated |
| [music-analysis.md](research/music-analysis.md) | Beats, key, structure, stems and lyric alignment on a CPU-only laptop |
| [ui-ux.md](research/ui-ux.md) | Interface patterns, steering, trust, web platform limits |
| [practitioner-followup.md](research/practitioner-followup.md) | 2026 practitioner forum check on phrase choices, vocal overlap, and selective stem use |

**How far to trust this.** Measured evidence is thin and skews heavily to house and trance. Nothing measured covers pop, rap, Latin or Asian pop mixing, and I found no measured study of wordplay at all. Much of the practice lives in video I couldn't read. So most numbers in the plan are starting values to tune by ear, not established facts.

## What matters most

**Automatic systems aren't as good as people yet.**
- The best published result on pop scored 5.6 out of 10 against 6.7 for a human, and a plain crossfade scored 4.7 (DJustify 2026, a preprint).
- The gap to a human grew to 1.9 points among listeners with DJ experience.
- DJustify's separate three-minute story-set test found no detectable gap from a human DJ on story or transition ratings, while story planning improved coherence over its no-story ablation. This is not proof of equivalence: that comparison used 99 listeners and a 400-track pool, and the no-story condition also differed in opener policy.
- A system that did respectably on drum and bass scored 4.0 on pop, so dance-tuned systems transfer badly.

**Cue and pairing choices seem to matter more than effect curves.**
- A GAN that learned its effects tied with plain linear fades once cues were fixed.
- Swapping one system's cue selection for a simpler method lost most of its lead over a crossfade.
- No study tests this directly, so it's an inference.

**The worst failures are specific and avoidable.**
- Cutting a lead vocal mid-phrase scored about 2 out of 5 against about 5 with a repair.
- Misaligned beats were the top complaint in one study.
- Commercial complaints converge on badly timed cuts, vocal overlap and non-dance genres.

**DJs stretch little.** In 1,557 mostly house and trance mixes, 86% of tempo changes were under 5%, only 2.5% of tracks were transposed, and overlaps clustered on 32-beat multiples. DJs agreed on the same cue only about a quarter of the time, so a song has several valid cues, not one right one.

**Key matters less than people say, and more on long overlaps.** It barely matters for cuts and drum-only moves, and matters a lot for long blends with vocals or melody. One study found trained listeners preferred measured consonance over a commercial key tool's picks.

## Wordplay

- The best-documented moves are same-word loops and set-up and punchline. Rhyme has almost no support.
- Practitioners actively suggest common words like "love" and "baby", so rare-word weighting is the wrong main signal.
- The best written recipe is a multi-step loop exchange, not one echo and a landing.
- Tempo and key can largely be ignored for a sequential cut, and both are required for a layered exchange.
- Recognition is the central pleasure of mashups, per music theory writing on the genre.
- I found no DJ software with lyric-link search, and no evaluated lyric-link system. Selecta's opening is real, but unproven.

## Timing

- Trained listeners need 15 to 20 ms to hear the order of two sounds.
- At around 40 ms, fast-attack pairs split into two events.
- Published beat accuracy scores allow ±70 ms, so they can't certify a clean mix.
- A 0.1 BPM error drifts about 53 ms over 32 bars, so grids must be re-phased.

## Tools

| Task | Choice | Why |
|---|---|---|
| Beats and downbeats | `beat-this` | State of the art, MIT, no madmom needed. No hip-hop benchmark exists |
| Key | S-KEY if it runs here, chroma as cross-check | About 72 to 74 MIREX against about 53 for templates |
| Word timing | WhisperX's alignment module or `ctc-forced-aligner` | Purpose-built aligners reach a median near 40 ms. Whether separated vocals help is contested |
| Stems | `htdemucs` on short windows | Full-library separation would take about 160 to 325 hours here |
| Lyrics | LRCLIB API | About 90 requests a minute. The dump is about 44 GB |

Rejected on this machine: SongFormer, allin1, Essentia, madmom, torchaudio's MMS_FA.

## Interface

- People resent machines that talk or hide their plans, and praise low-effort steering.
- Trust peaked at moderate transparency in one study, so explanations stay short, true and on demand.
- Long analysis stops being trusted when it looks stalled, more than when it's slow, so show real counts and what finished last.
- Waveform conventions exist so people can beatmatch by eye, so Selecta drops most of them.
- Lyrics are treated as typography, because the signature feature is literally words.
