# Automatic DJ systems: state of the art, November 2026

**Tags:** [S] solid (peer-reviewed or measured; preprints are flagged), [P] practitioner, [A] anecdotal (forum, press or marketing; vendor docs show what is claimed, not how good it is). "(snippet)" means I saw it only in a search summary, not the full page.

**Scope:** nothing was written to the project. Coverage is uneven: I read most academic papers in full, but commercial evidence is mostly vendor docs and press. Reddit wasn't directly readable, and I found few working-DJ tutorials.

## 1. What real human mixes show

### Takeaway
DJs stretch little, rarely transpose, and overlap in phrase multiples, and they agree only moderately on cues. Nearly all the data is dance music. I found no published figure for how much of each track is played, or for how DJs use EQ across a population.

### Cited Findings
- **Main corpus:** 1,557 mixes, 13,728 unique tracks, 24,202 played tracks and 20,765 transitions. The mean mix is 60.5 min with 15.5 tracks. It is mostly House and Trance, and alignment works poorly on Techno. [S] [Kim 2020](https://ar5iv.labs.arxiv.org/html/2008.10267)
- **Tempo change:** 86.1% under 5%, 94.5% under 10%, 98.6% under 20%. [S] [Kim 2020](https://ar5iv.labs.arxiv.org/html/2008.10267)
- **Transposition:** only 2.5% of played tracks, and 94.3% of those by one semitone. [S] [Kim 2020](https://ar5iv.labs.arxiv.org/html/2008.10267)
- **Transition length:** the histogram peaks every 32 beats and runs to about 224 beats. No mean or median is given. [S] [Kim 2020](https://ar5iv.labs.arxiv.org/html/2008.10267)
- **Cue agreement between DJs on the same track:** 23.6% identical, 40.4% within 4 beats, 73.6% within 8 measures, 86.2% within 16 measures. [S] [Kim 2020](https://ar5iv.labs.arxiv.org/html/2008.10267)
- **Perceived boundary:** human-marked track boundaries fall closest to cue-in in 52% of transitions, cue-out in 30% and cue-mid in 18%. [S] [Kim 2020](https://ar5iv.labs.arxiv.org/html/2008.10267)
- **Larger corpora:**
  - MixesDB has 5,040 mixes, 50,742 transitions, 67,514 played tracks and 6,672 hours. [S] [Kim 2022](https://dafx.de/paper-archive/2022/papers/DAFx20in22_paper_33.pdf)
  - Raveform has 4,902 mixes, 56,873 unique tracks and 53,780 transitions. It is techno-led with a 128 BPM mode, segments mostly last about 30 s (16 measures), and only 7% of mixes are fully identified. [S] [Raveform 2026](https://transactions.ismir.net/articles/288)
- **EQ and fader work:**
  - Estimators assume gains only fall on the outgoing track and only rise on the incoming one, with shelves at 180 Hz and 3 kHz and a mid peak at 1 kHz (Xone:96). [S] [Kim 2022](https://dafx.de/paper-archive/2022/papers/DAFx20in22_paper_33.pdf)
  - Their synthetic test data allows one gain move per channel every 4 s and uses 64-beat transitions (about 30 s). [S] [Kim 2022](https://dafx.de/paper-archive/2022/papers/DAFx20in22_paper_33.pdf)
  - Sub-band gain estimates beat linear crossfade and single-band baselines on reconstruction, and a 14-person listening test agreed. [S] [Kim 2021](https://nime.org/proc/nime2021_87/)

### Inferences
- 60.5 min / 15.5 tracks gives about 3.9 min per slot, against a 4.0 min mean track length. This doesn't show that DJs play nearly whole tracks: unidentified tracks inflate slot length and catalogue versions may be short.
- The tempo figures partly reflect track selection, so they describe what DJs choose to do, not what listeners can tolerate.

### Gaps
- Transition length in seconds, and band-level EQ behaviour across a population. I read only part of the Kim 2022 results.
- Any comparable statistics for pop, rock or hip-hop mixes.

## 2. Main academic systems

### Takeaway
Rule-based systems remain competitive. Learned effects have not beaten simple baselines once cues are fixed, and the best recent gains come from cue choice and stems.

### Cited Findings

| System | Approach | Data and test | Result | Limits |
|---|---|---|---|---|
| [Ishizaki 2009](https://zenodo.org/records/1418231/files/IshizakiHT09.pdf) [S] | Splits the tempo change across both tracks using a discomfort function | 18 RWC pop songs, 96 subjects; mix test with 27 subjects, 165 ratings | Beat naive mixing, p<0.001 | Some pairs were unacceptable under any method; bad strong/weak beat alignment still lowered ratings |
| [Bittner 2017](https://archives.ismir.net/ismir2017/paper/000086.pdf) [S] | Shortest Hamiltonian path for order; cost matrix over timbre, chroma, loudness, vocals, boundaries | 48 dance pairs within 5 BPM, 4 curators | 64.13% Good, 28.26% OK, 7.61% Bad | Fixed length; beat and downbeat errors were the main bottleneck |
| [Vande Veire 2018](https://doaj.org/article/5cd07351eb6f4beba2c26048a3fe516d) [S] | Rules: double drop, rolling and relaxed types, plus vocal-clash avoidance ([blog](https://lenvdv.github.io/2018-03-20-autodj)) | 18 DnB fans | Rated high quality | DnB only; fixed length and fade per type; no reliability measures |
| [Hirai 2018](https://www.jstage.jst.go.jp/article/ipsjjip/26/0/26_276/_article/-char/en) [S] (snippet) | Beat similarity plus LDA topics on chroma | Subjective experiment | Reported effective | Numbers not read |
| [DJtransGAN 2022](https://ar5iv.labs.arxiv.org/html/2110.06525) [S] | GAN driving differentiable EQ and fader; 24 parameters | 284 mixes; 136 listeners retained, 46 of them DJs | Human best; no significant difference between GAN, linear and rule | Electronic only; fixed 8 bars; listeners blamed pairs and cues; too fast on vocal-to-vocal |
| [Robinson 2023](https://arxiv.org/abs/2301.13380) [S, demo] | Min-cut picks a transition time per frequency bin | Late-breaking demo | Not read | Evaluation unknown |
| [Mosaikbox 2024](https://repositum.tuwien.at/bitstream/20.500.12708/212628/1/Sowula-2024-Mosaikbox%20Improving%20Fully%20Automatic%20DJ%20Mixing%20Through%20Rule-ba...-vor.pdf) [S] | Rules plus Demucs stem edits, -14 LUFS, ±8%, 16-downbeat overlap | 16 of 250 DnB songs, 30 listeners, 1 to 5 scale | Baseline 2.49, base 3.08, stems 3.46, with lyrics 3.03 | Lyric meaning gave no significant gain; the tempo limit also locks in genre; fixed length |
| [DJ AI 2025](https://research.sabanciuniv.edu/52373/1/AI_DJ_AM2025.pdf) [S, weak] | MERT picks segments, MusicGen generates audio, ±2 BPM rule | 20 listeners, 10 pairs | Preferred 70.5% over a fixed 10 s crossfade | Weak baseline; chroma metrics are not perceptual; only looks at the last 30 s |
| [DJustify 2026](https://arxiv.org/html/2610.33434) [S, preprint] | LLM plans next track, cues and technique; acoustic checker triggers up to 4 repairs | 400 pop tracks, 103 listeners, 1 to 10 scale | Human 6.7, DJustify 5.6, crossfade 4.7, Mosaikbox 4.0 | Below human; checker improves reliability, not the mean |

[UnmixDB](https://zenodo.org/records/1422385/files/schwarz-fourer-ismir2018late-breaking-unmixdb.pdf) [S] is reverse-engineering ground truth built from generated mixes. It uses beat-aligned linear fades, so it holds no human cue or EQ decisions.

### Inferences
- The strongest single comparison: swapping DJustify's cue selection for Bittner's cues lost 0.75 of its 0.89-point lead over crossfade. With DJtransGAN's tie against linear fades, this suggests cues and pairing matter more than effect curves. No study tests this directly.
- Mosaikbox scoring 4.0 on pop, after a respectable result on DnB, shows how badly EDM-tuned systems can transfer. Its authors note it was run outside its domain.

### Gaps
- The Vande Veire full text was blocked, so its accuracy figures and bar lengths are unverified.
- I did not read Hirai or Robinson in full.

## 3. How transitions are evaluated

### Takeaway
Tests are small, use differing scales and rarely isolate one error type. The available evidence ranks beat alignment and broken vocal phrases above key clash, but that ranking rests on thin data.

### Cited Findings
- **Reasons curators gave:** beats misaligned 15.22%, mid-vocals 6.52%, contrasting songs 4.34%, not on downbeat 2.17%, awkward points 2.17%, key clash 0%. This table doesn't reconcile with the 7.61% Bad rate, so reasons were probably also given for non-Bad items. [S] [Bittner 2017](https://archives.ismir.net/ismir2017/paper/000086.pdf)
- **Sung phrase cut off:** on two seeds, DJ-experienced listeners scored versions that cut a lead vocal mid-phrase 2.0 and 1.8, against 5.0 and 4.8 with repair. [S, preprint] [DJustify](https://arxiv.org/html/2610.33434)
- **Listener expertise:**
  - The human lead over DJustify grows from 1.02 overall to 1.9 among DJ-experienced listeners. [S, preprint] [DJustify](https://arxiv.org/html/2610.33434)
  - Baseline ratings fall as musical knowledge rises. [S] [Mosaikbox](https://repositum.tuwien.at/bitstream/20.500.12708/212628/1/Sowula-2024-Mosaikbox%20Improving%20Fully%20Automatic%20DJ%20Mixing%20Through%20Rule-ba...-vor.pdf)
- **Correlates of ratings:**
  - Comfort correlates strongly with rhythm smoothness. [S] [Ishizaki 2009](https://zenodo.org/records/1418231/files/IshizakiHT09.pdf)
  - The correlation between song-pair compatibility and transition rating is unstable: r=0.83 for one model, -0.03 for another. [S] [Mosaikbox](https://repositum.tuwien.at/bitstream/20.500.12708/212628/1/Sowula-2024-Mosaikbox%20Improving%20Fully%20Automatic%20DJ%20Mixing%20Through%20Rule-ba...-vor.pdf)
- **Tempo discomfort:** discomfort histograms peak at factors of 1.10 and 0.90, with mean thresholds of 1.227 up and 0.852 down. Within ±10%, 11.31% to 15.42% of subjects already felt discomfort, depending on the algorithm. [S] [Ishizaki 2009](https://zenodo.org/records/1418231/files/IshizakiHT09.pdf)
- **Test designs worth copying:**
  - Stratify pairs by vocal type (V-V, V-NV, NV-V, NV-NV), ask listeners to timestamp where they notice the transition, and collect free comments. [S] [DJtransGAN](https://ar5iv.labs.arxiv.org/html/2110.06525)
  - Count "abrupt" pairs per playlist: 4.2 random versus 2.4 sequenced, out of 29. [S] [Bittner 2017](https://archives.ismir.net/ismir2017/paper/000086.pdf)
- **Field test:** an A/B test on 10% of Spotify users found daily playlist return 1.4 percentage points higher with DJ-curated transitions. About 95% of users did not use crossfade. [S] [Bittner 2017](https://archives.ismir.net/ismir2017/paper/000086.pdf)

### Inferences
- "0% key clash" does not license ignoring key. The pairs were dance tracks within 5 BPM, and the cost function already included chroma.
- Ishizaki measured sustained tempo ramps on exposed pop songs, so it likely overstates what is audible during a short overlap.

### Gaps
- I found no factorial study of beat, vocal, key and energy errors.
- I found no independent listening test of commercial automix products. Mosaikbox explicitly excluded them, and DJustify's "Spotify-style" crossfade is its own Bittner-based baseline.

## 4. Datasets, models and code

### Takeaway
Analysis and cue tools are usable. Training data is EDM-heavy, audio is generally not distributed, and I found no mixed-genre mix corpus.

### Cited Findings

| Resource | Contents | Numbers | Caveats |
|---|---|---|---|
| [Raveform](https://transactions.ismir.net/articles/288) [S] | Mixes, 1,423 manually annotated tracks, models | Beat F1 0.991, downbeat F1 0.965 on its own test set; madmom's downbeat F1 is 0.669 there | Falls to 0.509 HR.5F on Harmonix pop |
| [allin1](https://pypi.org/project/allin1/1.0.2/) [A: docs] | Beats, downbeats, section labels | 8-fold ensemble on Harmonix | Depends on madmom |
| [Beat This](https://github.com/CPJKU/beat_this) [A: repo; ISMIR 2024 paper] | Beats and downbeats without DBN post-processing | 466 stars; MIT code and weights | Check training-data licence terms |
| [CUE-DETR / EDM-CUE](https://arxiv.org/html/2407.06823v1) [S, preprint] | 4,710 tracks, 21,461 cues from 4 DJs | Best F1 0.46; Mixed In Key up to 0.22, Automix up to 0.15 (one-beat tolerance) | EDM only; [repo](https://github.com/ETH-DISCO/cue-detr) is MIT, MP3 only, no audio |
| [M-DJCUE / Automix](https://ar5iv.labs.arxiv.org/html/2007.08411) [S] | 134 EDM tracks, rule-based detector | Precision 86%, recall 49%; 95.8% usable after expert review | 36% of misses came from tracks without a strict 4-bar period |
| [djmix-analysis](https://mir-aidj.github.io/djmix-analysis) [S] | Alignment and cue extraction code | Kim 2020 corpus | Public release of the corpus itself not confirmed |
| [djmixer-estimation](https://dafx.de/paper-archive/2022/papers/DAFx20in22_paper_33.pdf) [S] | Fader and EQ estimation | MixesDB | Repo not verified live |
| [DJtransGAN](https://github.com/ChenPaulYu/djtransgan-icassp2022/blob/main/index.md) [A: repo] | Differentiable mixer code | See section 2 | Electronic only |

Mixed In Key's precision conflicts across papers: 65% in [Zehren](https://ar5iv.labs.arxiv.org/html/2007.08411) versus 20% to 25% in [CUE-DETR](https://arxiv.org/html/2407.06823v1). Ground truth and tolerance differ, so the figures aren't comparable.

### Inferences
- Raveform's two cross-dataset results show that a single analysis model is a risk for a 1,389-song mixed library.

### Gaps
- No open mix corpus for pop, rock or hip-hop turned up.

## 5. Commercial products

### Takeaway
Products mostly offer beat-matched fades with limited pair logic. Stems are now widely available, and the complaints converge on badly timed cuts, vocal overlap and non-dance genres. Almost nothing technical is published.

### Cited Findings

| Product | What it does | Praise and complaints | Where it sounds automatic |
|---|---|---|---|
| **Spotify** [A] | [AI DJ](https://newsroom.spotify.com/tag/personalization/page/3) (snippet) adds generated commentary. [Automix](https://support.spotify.com/kr-en/article/tracks-transitions/) beat-matches on select playlists. [Mix](https://routenote.com/blog/spotify-mix-customizable-transitions/) (snippet) offers presets plus volume and EQ edits. [Smart Reorder](https://bgr.com/2110632/spotify-new-transition-feature-better-than-apple-music) sorts by BPM and key | AI DJ is called half-baked, with [repetitive queues](https://www.howtogeek.com/spotifys-ai-dj-just-got-three-new-features-but-theres-still-work-to-be-done/) | [Abrupt transitions](https://www.techradar.com/audio/spotify/spotifys-new-rival-to-apple-musics-automix-is-here-to-upgrade-your-playlists-and-i-think-its-the-better-dj-too) (snippet); [tempo-change artifacts](https://community.spotify.com/t5/Content-Questions/Feature-request-Tempo-matching-switch-in-Mix-mode/td-p/7517345) (snippet) |
| **Apple AutoMix** (2025) [A] | [Time stretching and beat matching](https://musictech.com/news/gear/apple-music-automix-ai/) (snippet). On/off only, and [skips albums and incompatible material](https://heise.de/-11139247) | Reportedly [good on hip-hop and electronic](https://bgr.com/2110632/spotify-new-transition-feature-better-than-apple-music) | [Cuts off endings and layers over fade-outs](https://bgr.com/2059450/how-to-turn-off-automix-apple-music-worst-feature); country, rock, melodic pop and indie sound [off](https://bgr.com/2110632/spotify-new-transition-feature-better-than-apple-music) |
| **djay** [A] | Filter, Echo, Tremolo, Riser, Neural Mix. Automatic mode picks types [at random, like a shuffle](https://help.algoriddim.com/user-manual/djay-pro-mac/mixing-basics/using-automix). Has tempo blend and song-range limits | [Mostly positive reviews](https://djtechreviews.com/reviews/software/algoriddim-djay-pro-ai) (snippet), mainly for stems | Random style choice; I found no independent test |
| **VirtualDJ** [A] | [Smart mode, about 4 to 8 s](https://virtualdj.com/manuals/virtualdj/interface/browser/sideview/automix/), from intro and outro analysis | Forum: [prefers tempo, then cut, fade, full](https://virtualdj.com/forums/194976/Old_versions/AUTOMIX_TYPE___SMART.html) (snippet) | Short fixed-range overlaps |
| **Traktor** [A] | [Cruise Mode](https://support.native-instruments.com/hc/de/articles/210300645-Using-the-TRAKTOR-Cruise-Mode-for-Automatic-Playback-of-Your-Tracks) (snippet) with one global crossfade time | [Fader moves can trigger a transition](https://community.native-instruments.com/discussion/43345/traktor-cruise-mode-and-hardware-faders-is-there-a-way-to-disable-manual-transitions) (snippet) | Same fade length on every transition |
| **Mixxx** [S: project docs] | [Four modes; -60 dBFS silence threshold; shorter of outro and intro sets the fade](https://mixxx.org/news/2020-07-09-intro-outro-sections) | Open and explicit about limits | Ignores volume, frequency and rhythm |
| **DJ.Studio** | Harmonize orders by BPM and key, in seconds versus about 20 minutes by hand for 20 tracks | [Multi-genre sets confuse it; some transitions fit key and tempo but make no musical sense](https://thedjmixtape.com/dj-studio-review/) [P]; [vocals stacked over vocals](https://www.trustpilot.com/review/dj.studio) (snippet) [A] | Vendor reply: "certainly not an automix tool" |
| **Mixed In Key** [A] | [Energy 1 to 10](https://mixedinkey.com/workflows/use-energy-level-detection/) (snippet), method undisclosed; up to 8 cues | Independent cue F1 up to 0.22 on [EDM](https://arxiv.org/html/2407.06823v1) [S, preprint] | Not applicable |
| **Pacemaker** [A] | [Last listed update Sep 2021](https://apps.appfollow.io/ios/pacemaker-ai-dj-app/593873080?country=it) (snippet) | [Distinctly average mixes](https://www.tapsmart.com/apps/review-pacemaker-make-music-mixes-ai-dj/) (snippet) versus [good automix, 3.5/5](https://www.bonedo.de/artikel/pacemaker-dj-test/) (snippet) | Old reviews; current status unknown |

A working DJ's overview treats automix as [a scaffold for offline mixes, not a finished set](https://thedjmixtape.com/ai-in-djing-2026/), with no test method given. [P]

### Inferences
- The shared failure is the absence of a "don't overlap here" decision, whether that means letting an ending play or avoiding a vocal.

### Gaps
- **rekordbox:** I found no usable current automix documentation.
- **Serato:** I found only a [2019 forum request](https://serato.com/forum/discussion/1732846) describing a single-player Autoplay. Current behaviour is unverified.
- **New entrants:** beyond Apple and Spotify, I found no credible new 2025 to 2026 product. Roundups were vendor or affiliate content.
- **Technical detail:** I found no public detail on Spotify's or Apple's cue logic.

## 6. Open-source projects

### Takeaway
Components are more reusable than whole systems. Most full systems have few stars, no evaluation and fragile dependencies. Commit dates were not visible, so "active" is unverified throughout.

### Cited Findings (all [A]: repo pages)
- [DJustify](https://github.com/ddman1101/DJustify): MIT code, but its vocal detector weights are CC BY-NC. 7 stars. The [gate code](https://raw.githubusercontent.com/ddman1101/DJustify/main/djustify/transition_core.py) is the most directly reusable idea I found.
- [Mosaikbox](https://github.com/robaerd/mosaikbox): no licence shown, device hardcoded to `mps`. Its survey code may be reusable once the licence is settled.
- [dj-engine](https://github.com/iknight18/dj-engine): MIT, 273 commits, 0 stars, design docs dated May 2026. Python analysis and Rust playback share a JSON sidecar, and it has stem moves like rhythm swap. No evaluation shown.
- [aiJockey](https://github.com/architagrawal/aiJockey): AGPL, a key-aware beam search close to Selecta's planner. The README reads largely as a plan and disagrees with itself (25+ versus 15 techniques). It warns that madmom is troublesome on Windows.
- [dnb-autodj-3](https://github.com/lenvdv/dnb-autodj-3): AGPL, 23 stars, Python 3.6 and Ubuntu 16.04, DnB only.
- [clawd139/automix](https://github.com/clawd139/automix): diffusion predicts effect curves, but no weights, samples or evaluation are shown. Its quality claims are unsupported.
- [pyCrossfade](https://awesome.ecosyste.ms/projects/github.com%2Foguzhan-yilmaz%2FpyCrossfade) (snippet): needed a Docker image in 2024 after newer dependencies broke it.

### Inferences
- The recurring failures are dependency rot, genre lock-in and no listening test, so an evaluation harness alone would set Selecta apart from these projects.

### Gaps
- Mixxx's source code was not read. Its behaviour here comes from project news and bug threads.

## 7. What changed in 2024 to 2026

### Takeaway
Three things changed: stems became standard, large EDM annotations appeared, and LLM planning with audio verification arrived. Generative audio transitions remain unproven against good mixing.

### Cited Findings
- Stem editing gave a significant gain of about 0.38 on a 5-point scale, on DnB only. [S] [Mosaikbox](https://repositum.tuwien.at/bitstream/20.500.12708/212628/1/Sowula-2024-Mosaikbox%20Improving%20Fully%20Automatic%20DJ%20Mixing%20Through%20Rule-ba...-vor.pdf)
- LLM planning matched its no-reasoning, no-checker variant on mean score (5.6 versus 5.7, p>.3). Renderability rose from 91% to 99%, and median distinct transitions per pair reached 6.5. [S, preprint] [DJustify](https://arxiv.org/html/2610.33434)
- Story-prompted sets scored about 1.9 points higher on story coherence with no change in transition quality (p=.85). [S, preprint] [DJustify](https://arxiv.org/html/2610.33434)
- Generated audio has only been shown to beat a fixed crossfade, in a 20-person test. [S, weak] [DJ AI](https://research.sabanciuniv.edu/52373/1/AI_DJ_AM2025.pdf)
- One team found latent diffusion struggled to bridge fixed endpoints and moved to MusicGen. [S, preprint] [arXiv 2310.19842](https://arxiv.org/pdf/2310.19842) (snippet)
- An unreviewed March 2026 paper proposes measuring collision, loudness and beat consistency from the decks and master, with calibration against experts. I saw no validation results in the parts I read. [A] [Manabe](https://dm-projects-web.pages.dev/dj-mix-research-institute/paper/on_measurability_dj_mix_quality_daito_manabe_en.pdf)

### Inferences
- LLMs currently add variety and narrative rather than better average transitions. Their useful contribution is the verify-and-repair pattern, which needs no LLM.

### Gaps
- No peer-reviewed comparison of generative transitions against stem-aware DSP or human DJs turned up. My searches here were not exhaustive.

## Design implications for Selecta

These are my recommendations, drawn from the evidence above. No default below has been validated on a mixed-genre library.

### What the current design misses
1. **Post-render verification.** Selecta renders offline, while real-time apps have less room to try and check alternatives. Render several candidates per pair, test the audio and repair failures. This is probably the clearest way to beat the commercial tools.
2. **Analysis confidence per track.** Beat errors were the top complaint in Bittner, and madmom's downbeat F1 was 0.669 on Raveform. Score each grid's reliability, and don't beat-match tracks with low confidence.
3. **Sung-phrase integrity.** Checking vocal overlap isn't enough. Cutting a vocal mid-phrase on either side did severe damage in DJustify. Selecta's lyric timing is well suited to this check.
4. **Cue choice made jointly with style.** Don't fix cues before choosing a recipe. Score (exit cue, entry cue, style, length) together inside the beam search.
5. **Transitions without beat-matching.** Tempo limits lock in genre, as Mosaikbox found. A mixed library needs echo-outs, cuts, natural-ending handoffs, and half- or double-time matching ([Ishizaki](https://zenodo.org/records/1418231/files/IshizakiHT09.pdf)).
6. **An evaluation harness.** None of the published gates are calibrated against ratings, and I found no listening test of real commercial automix output.

### What to copy
- Bittner's cost-matrix cue search, and its restriction to downbeats and section boundaries.
- Ishizaki's split tempo change, plus Bittner's beat-by-beat tempo ramp.
- Mosaikbox's stem rules: attenuate clashing vocals and swap incompatible drums.
- DJustify's checker: each failed check returns a specific fix.
- Selecting by section boundary, because Mosaikbox found that picking the top-scoring beat shift landed on unnatural positions.

### What to avoid
- A single fixed transition length.
- Choosing style at random, as djay's Automatic mode does.
- Treating Camelot and BPM compatibility as sufficient. DJ.Studio's reviewer shows these can pass while the result makes no musical sense.
- Lyric-meaning similarity as a transition score, at least until tested on your library. Mosaikbox found no benefit, though on DnB. Keep any story goal as a separate set-level score.
- GAN or diffusion effect curves as a near-term priority, and generated audio as a default.
- Copying club norms blindly for home listening. Apple's complaints suggest people value hearing a song's ending, so make that a setting.

### Default numbers worth using

| Parameter | Default | Basis |
|---|---|---|
| Tempo change | Prefer ≤5% per track, hard cap 8%, else no beat-match | Kim, Mosaikbox, Ishizaki |
| Pitch shift | 0 by default, at most ±1 semitone | Kim |
| Overlap, dance tracks | Phrase multiples, 32 or 64 beats | Kim, DJtransGAN, Kim 2022 |
| Overlap, vocal-led tracks | Fit the actual vocal-free window; shorter or none if there isn't one | My judgement; DJustify gates |
| Non-dance phrase handling | Don't assume 4-bar periods | Zehren |
| Exit and entry search zone, dance | Exit in last 25%, entry in first 20% | Bittner |
| Minimum play, pop | Exit after the first chorus; entry ≤55% of B with ≥45 s left | DJustify |
| Vocal overlap | Target ≤1.0 s; attenuate the outgoing vocal if over 2 s | DJustify, Mosaikbox |
| Vocal at cut point | ≤50% coverage in the 1.5 s after a cut or before an entry; <15% in the 16 beats before a blend | DJustify |
| Vocal detection | Silence below -40 dBFS for ≥1 s; drop segments under 400 ms | Mosaikbox |
| Seam energy | Quiet time ≤1.2 s; minimum energy ≥0.22 × mean | DJustify |
| Entry level | First 3 s of B at most +2.5 dB over last 3 s of A | DJustify |
| Loudness | -14 LUFS per track; try ≤+1.5 LU over the louder deck and -1 dBTP on the master | Mosaikbox; Manabe (unvalidated) |
| EQ bands | Shelves at 180 Hz and 3 kHz, mid at 1 kHz; move gains in one direction | Kim 2022 (modelling assumptions) |

Mosaikbox's mixability weights came from informal testing, so don't copy them.

### How to evaluate
1. **Baselines:** a fixed 10 to 12 s crossfade, a Bittner-style cue search, real exports from at least one commercial automix, and a hand-made mix by a DJ if you can get one.
2. **Stimuli:** stratify pairs by vocal type, tempo gap and genre pair, deliberately oversampling hard cases such as rock to hip-hop. I suggest about 60 pairs to start, which is a judgement call and not a power calculation.
3. **Blinding:** randomise and hide the method. You know the songs, so add a few outside listeners, including DJ-experienced ones, since they are harsher and more sensitive.
4. **Collect:** a 1 to 5 rating, the timestamp where the transition became noticeable, and reason tags (beat, downbeat, mid-vocal, key, energy, contrast, cut-off ending).
5. **Primary metric:** the rate of bad transitions (≤2/5), not the mean. DJustify's checker barely moved the mean but rescued its worst cases.
6. **Objective logs:** post-render onset alignment, vocal overlap seconds, phrase-cut flags, loudness bump and low-band collision. Then regress these on ratings and tune each gate. This calibration appears to be missing from the literature.
7. **Long-run use:** log skips, manual overrides and recipe repetition across full sets. Whether listeners notice repeated recipes is an open question, and this log would help answer it.
8. **Reference target:** on pop, the current benchmark is about 0.9 points above crossfade and 1.0 below a human on a 10-point scale. "Clearly better" should mean beating real commercial output with a much lower bad-transition rate, especially on non-dance material.
