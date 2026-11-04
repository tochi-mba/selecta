# Music analysis and lyric alignment for Selecta (as of November 2026)


**Labels:** [solid] = peer-reviewed, measured or primary doc. [practitioner] = project card, README claim or community guide. [anecdotal] = forum, blog or unverifiable.

**Caveat on numbers:** most table values come from a fetch tool reading HTML or Markdown versions of each source, and I did not re-check them against the PDFs. "Abstract only" means I never saw the full text.

## 1. Beat and downbeat tracking

### Takeaway
Beat This remains the reference, and the small model almost matches the final one on held-out data. The real risk for a DJ is downbeat continuity, not F1. I found no hip-hop evaluation and no CPU timing.

### Cited Findings
- GTZAN held-out, beat F1 / downbeat F1:
  - Final (20M params): 89.1 / 78.3.
  - Small (2M params): 88.8 / 77.2.
  - Final + DBN: 88.1 / 77.4.
  - Hung et al. without DBN: 88.7 / 75.6.
  - [solid] [paper](https://ar5iv.labs.arxiv.org/html/2407.21658)
- Downbeat CMLt / AMLt on the final model is 67.3 / 79.1, rising to 73.3 / 87.8 with a DBN. [solid] [paper](https://ar5iv.labs.arxiv.org/html/2407.21658)
- 8-fold cross-validation, beat / downbeat F1. Small was not reported per dataset. [solid] [paper](https://ar5iv.labs.arxiv.org/html/2407.21658)

| Dataset | Beat F1 | Downbeat F1 |
|---|---|---|
| Harmonix | 95.8 | 90.7 |
| RWC Pop | 96.1 | 93.7 |
| Filosax | 99.5 | 98.5 |
| JAAH | 95.1 | 85.0 |
| RWC Jazz | 83.3 | 80.7 |
| HJDB | 98.2 | 96.6 |
| Hainsworth | 91.9 | 80.0 |
| SMC | 62.7 | n/a |
| ASAP | 76.3 | 61.2 |

- **Benchmark mismatch:** HJDB is hardcore, jungle and drum and bass, not hip-hop. The paper discusses neither hip-hop nor swing. [solid] [paper](https://arxiv.org/html/2407.21658v1)
- Harmonix comparators, on different protocols: All-In-One .958 / .915, Beat Transformer .954 / .898, SpecTNT-TCN .953 / .908. [solid] [All-In-One paper](https://ar5iv.labs.arxiv.org/html/2307.16425)
- F1 tolerance is ±70 ms. Output is 50 fps, chunks are non-overlapping 30 s, and hard pieces produce non-periodic beats. [solid] [paper](https://arxiv.org/html/2407.21658v1)
- AlignBeat (2025) gains 3.6 points of downbeat CMLt over Beat This across 18 datasets, with F-measures within 1 point. I saw no code link. [solid, abstract only] [arXiv](https://arxiv.org/abs/2510.14391)
- beat-this 1.1.0 was released on 2026-04-14 and needs torch>=2 and torchaudio. [solid] [PyPI](https://pypi.org/pypi/beat-this/json)
- The DBN option needs madmom. CPU is only a fallback flag, with no timing given. [solid] [README](https://github.com/CPJKU/beat_this)
- A third-party ONNX export exists: final ~80 MB, small ~10 MB, opset 14, and within 2e-5 of PyTorch. [practitioner] [card](https://huggingface.co/ashudesai/songbird-models)

### Inferences
- A ±70 ms pass is 3.5 times the 20 ms order threshold (section 8), so published F1 cannot certify a flam-free mix.
- For DJ use, continuity matters more than F1. A post-hoc grid fit that doesn't assume constant tempo should recover part of the DBN's continuity gain without madmom.
- Evidence on tempo drift is indirect: the low scores on SMC, ASAP and RWC Classical are the closest signal.

### Gaps
- Hip-hop-specific accuracy and CPU timing for either model.
- [Masked diffusion beat tracking](https://arxiv.org/pdf/2608.04624) surfaced at the end and is unread.

## 2. Structure and chorus detection

### Takeaway
Newer models are clearly better, but none is practical on this laptop. A bar-level self-similarity approach is a defensible baseline. Chorus is usable as an approximate region, not as a precise edit point. I found no hook benchmark.

### Cited Findings
- SongFormBench-Harmonix (200 songs), ACC / HR.5F / HR3F:
  - SongFormer: .795–.807 / ~.70 / ~.78.
  - All-In-One: .740 / .596 / .730.
  - LinkSeg: .780 / .630 / .762.
  - [solid] [paper](https://arxiv.org/html/2510.02797v2)
- SongFormBench-CN (100 Chinese songs): SongFormer .891 / .688 / .851, All-In-One .834 / .563 / .771. [solid] [paper](https://arxiv.org/html/2510.02797v2)
- SongFormer has only been tested on Ubuntu with Python 3.10. Its 2–4 s per song is an L40 GPU figure. The README says nothing about CPU, Windows or ONNX. [practitioner] [README](https://raw.githubusercontent.com/ASLP-lab/SongFormer/main/README.md)
- One of SongFormer's backbones, MuQ, has about 300M parameters and CC-BY-NC weights. [solid] [card](https://huggingface.co/OpenMuQ/MuQ-large-msd-iter)
- allin1 on Windows needs madmom from GitHub and a source build of NATTEN. The default is an 8-model ensemble. Its only speed figure (10 songs in 73 s) used an RTX 4090. [practitioner] [PyPI](https://pypi.org/project/allin1/0.4.0/)
- All-In-One itself is tiny (~300K params). Its Harmonix HR.5F is .660 in its own 8-fold protocol, and removing demixing from the smaller TCN baseline cost about .025. [solid] [paper](https://ar5iv.labs.arxiv.org/html/2307.16425)
- Classic versus learned on Harmonix, HR.5F / chorus F1 / chorus-boundary HR.5F:
  - Scluster: .263 / .534 / .171.
  - DSF+Scluster: .497 / .611 / .326.
  - CNN-Chorus: n/a / .692 / .371.
  - SpecTNT: .558–.570 / .815–.831 / ~.48–.50.
  - [solid] [paper](https://ar5iv.labs.arxiv.org/html/2205.14700)
- Cross-dataset chorus F1 for SpecTNT: SALAMI-pop .811, RWC-Pop .847. [solid] [paper](https://ar5iv.labs.arxiv.org/html/2205.14700)
- Barwise TF classic features, HR.5F / HR3F:
  - Harmonix: Foote 47 / 72, CBM 48 / 69.
  - RWC-Pop: CBM 58.5 / 71.
  - SALAMI: CBM 40 / 56.
  - Deep embeddings beat these usually, not always.
  - [solid] [2026 paper](https://arxiv.org/html/2603.27218)
- Lyrics signal: text-only segmentation reaches 67.4% F, or 75.3% with audio. Rap often has no chorus at all. [solid, abstract only] [record](https://bvbvf1.bib-bvb.de/vufind/PrimoRecord/cdi_hal_primary_oai_HAL_hal_03295581v1)
- Repeating-line patterns for text-only chorus detection were reported as language-independent in English and Japanese. [solid, abstract only] [ISMIR 2020](https://program.ismir2020.net/poster_3-04.html)

### Inferences
- Even the best supervised model hits a chorus boundary within 0.5 s only about half the time. Snap to the downbeat grid and treat labels as probabilities.
- LRC line repetition is cheap and already available, so it is the obvious chorus cue to add. Its effect has not been measured for this pipeline.

### Gaps
- CPU timing and ONNX exports for SongFormer or allin1: I found none.
- Any benchmark for "hook" detection.

## 3. DJ cue-point detection

### Takeaway
Published work is EDM-only and modest in accuracy. Nothing supports it for pop, rap or Latin.

### Cited Findings
- CUE-DETR on EDM-CUE (4,710 tracks, 21,461 cues, 101-track test set), best F1 by tolerance:

| Method | One beat | Half beat |
|---|---|---|
| CUE-DETR | .46 | .32 |
| Mixed In Key | .22 | .16 |
| Automix | .15 | .13 |

  Annotations come from club DJs and tempos span 95–190 BPM. [solid] [paper](https://arxiv.org/html/2407.06823v1)
- The CUE-DETR code and checkpoints are public. It needs Python 3.11.9, is mp3-only, and states no licence or CPU support. [practitioner] [README](https://raw.githubusercontent.com/ETH-DISCO/cue-detr/main/README.md)
- Zehren et al. report about 96% of generated points as good quality. It is rule-based, with public code and the M-DJCUE dataset. [solid, abstract only, self-evaluated] [arXiv](https://arxiv.org/abs/2007.08411)

### Inferences
Rules built on downbeats, sections and energy are the sensible choice here. Mixed In Key's low F1 suggests even commercial cue tools are far from DJ annotations.

### Gaps
I found no 2025–2026 cue models and no non-EDM evaluations.

## 4. Key detection

### Takeaway
Replacing chroma templates is the highest-value accuracy upgrade in the stack. S-KEY is the best candidate because it runs on PyTorch alone, but its weights carry a licence restriction.

### Cited Findings
- FMAKv2, MIREX score / mode accuracy: Krumhansl 53.4 / 64.9, S-KEY (60k) 72.1 / 79.0, madmom CNN 73.1 / 79.3. [solid] [paper](https://arxiv.org/html/2501.12907v2)
- Other datasets, MIREX score. Hip-hop is named as hard with no number given, and blues falls below 50% on GTZAN. [solid] [paper](https://arxiv.org/html/2501.12907v2)

| Model | FMAKv2 | GTZAN | GiantSteps |
|---|---|---|---|
| S-KEY 1M | 73.2 | 74.4 | 72.1 |
| madmom | 73.1 | 67.9 | 71.0 |

- S-KEY runs on CPU through a CLI or Python API. It installs with Poetry (no PyPI release yet), has no Windows notes, and its weights are for non-commercial research only. [practitioner] [README](https://raw.githubusercontent.com/deezer/s-key/main/README.md)
- AllConv CNN, weighted / exact: Billboard 85.1 / 79.9, Isophonics 82.5 / 76.3, GiantSteps 74.6 / 67.9, KeyFinder set 76.1 / 70.0. [solid] [paper](https://ar5iv.arxiv.org/html/1808.05340)
- Hand-tuned methods on the same data: bgate on the KeyFinder set 72.4 / 65.0. Outside their tuned genre, weighted scores are CK1 72.8 on Billboard, BD1 59.6 on GiantSteps and HS1 64.1 on Isophonics. [solid] [paper](https://ar5iv.arxiv.org/html/1808.05340)
- Commercial tools (66 Beatport tracks against a human majority): Mixed In Key 86%, Serato 70%, rekordbox 70%, KeyFinder 65%, Traktor 47%. The sample is small and dated. [practitioner] [DJTT 2015](https://djtechtools.com/2015/11/16/key-detection-software-comparison-2015-edition)
- A 2020 Reddit test put Mixed In Key near 76.5%. [anecdotal] [mirror](https://reddit.birdcat.cafe/r/DJs/comments/hwlzyt/key_detection_comparison_2020)
- I confirmed essentia has no Windows wheels ([PyPI](https://pypi.org/simple/essentia/)) and madmom is source-only ([PyPI](https://pypi.org/simple/madmom/)). [solid]
- OpenKeyScan is described as a CNN desktop app for Windows and Mac, but the only source is a competitor's page with no benchmark. [anecdotal] [page](https://beatkey.pages.dev/openkeyscan-alternative)

### Inferences
- A simple chroma approach should give about 45–60% exact on mixed pop and hip-hop. That is my estimate from Krumhansl's 53.4 MIREX and 64.9 mode accuracy. I found no direct measurement for librosa on these genres.
- Fifth and relative errors are often still mixable. For AllConv on Billboard, 89.7% of tracks are correct, fifth or relative, so weighted score tracks DJ usefulness better than exact accuracy.

### Gaps
- Which weights `skey.pt` contains (60k or 1M).
- CPU timing for S-KEY.
- libKeyFinder's standing against academic benchmarks, or any Windows Python package for it.
- ONNX key models: I found none.
- A 200-track Mixed In Key test appeared in a search snippet. I could not trace it, so I excluded it.

## 5. Energy and danceability

### Takeaway
Evidence is thin. Nothing I found validates a DJ "energy" measure, so anything built here is a heuristic you must evaluate yourself.

### Cited Findings
- Essentia publishes danceability heads, including an [ONNX discogs-effnet head](https://essentia.upf.edu/models/classification-heads/danceability/). [solid]
- Danceability heads are binary, arousal/valence heads (DEAM, emoMusic, MuSe) output a 1–9 scale, and the models are CC BY-NC-SA. [solid] [docs](https://raw.githubusercontent.com/MTG/essentia/master/doc/sphinxdoc/models.rst)
- An older danceability classifier scored 92.41% on 306 in-house tracks. The architecture is unstated. [practitioner] [AcousticBrainz](https://acousticbrainz.org/datasets/accuracy)
- DEAM arousal R² varies widely across papers: about .35 to .672. Protocols differ, so these are not comparable. [solid, snippet only] [arXiv](https://arxiv.org/pdf/2112.07192)
- Music2Emo adds key, chord and MERT features. [solid, abstract only] [arXiv](https://web3.arxiv.org/abs/2502.03979)

### Inferences
Binary danceability and DEAM arousal are weak stand-ins for DJ energy. A composite of short-term loudness, onset density, spectral flux and low-frequency share is cheap and explainable, but unvalidated.

### Gaps
- Primary sources for the detrended-fluctuation danceability method.
- Effnet input preprocessing details and CPU timings.
- Any study of perceived DJ energy.

## 6. Stem separation on CPU

### Takeaway
Newer vocal models gain 2–3 dB over htdemucs, but I found no CPU measurements for them. SCNet is the only model with a published CPU advantage. Windowing has no direct measurement, so the padding figure below is my own inference.

### Cited Findings
- Multisong vocal SDR: Mel-Band Roformer (Kim) 10.98, BS-Roformer (viperx) 10.87, MDX23C 10.17, SCNet XL IHF 9.68, SCNet Large 8.94–9.05, htdemucs fine-tuned 8.78, SCNet Small 8.27, htdemucs 8.24. [practitioner, measured] [ZFTurbo](https://raw.githubusercontent.com/ZFTurbo/Music-Source-Separation-Training/main/docs/pretrained_models.md)
- Multisong 4-stem average: SCNet XL IHF 9.92, SCNet Large 9.19–9.28, htdemucs 9.16, SCNet Small 8.87. SCNet was trained on MUSDB18HQ only. [practitioner, measured] [ZFTurbo](https://raw.githubusercontent.com/ZFTurbo/Music-Source-Separation-Training/main/docs/pretrained_models.md)
- Current leader: MVSep's BS Roformer at 12.33 vocal SDR. I did not confirm its weights are available. [practitioner] [leaderboard](https://mvsep.com/quality_checker/multisong_leaderboard?sort=vocals)
- MUSDB18-HQ: HT Demucs 7.52–9.00 depending on data and tuning. [solid] [paper](https://ar5iv.labs.arxiv.org/html/2211.08553)
- SCNet reports CPU inference at 48% of HT Demucs with 9.0 dB. This is author-reported. [solid] [arXiv](https://arxiv.org/abs/2401.13276)
- Demucs CPU cost is about 1.5× track length on unstated hardware. Its maximum segment is 7.8 s, `--two-stems` saves no compute, `htdemucs_ft` costs about 4×, and the repo gets little active development. [solid] [README](https://raw.githubusercontent.com/adefossez/demucs/main/README.md)
- demucs.cpp on a 16-core 5950X, 4-minute track: 4m09s to 10m23s depending on threading. [practitioner] [perf doc](https://raw.githubusercontent.com/sevagh/demucs.cpp/main/.github/PERFORMANCE.md)
- Training segment length: 3.4 s gives 8.17 dB, 7.8 s gives 8.70 dB. Inference uses 25% overlap with a linear crossfade. [solid] [paper](https://ar5iv.labs.arxiv.org/html/2211.08553)
- Community guidance says higher overlap helps with diminishing returns and can eventually sound muddier. It is not benchmarked. [anecdotal] [guide](https://docsearch.algolia.com/mcp/docs/repo/nomadkaraoke/python-audio-separator)
- audio-separator 0.48.0 covers MDX-Net (ONNX), VR, Demucs and MDXC/RoFormer, with a `[cpu]` extra. SCNet was not in the summary I read. [solid] [PyPI](https://pypi.org/pypi/audio-separator/json)

### Inferences
- On this 15 W 4-core chip, expect htdemucs at about 2–4× real time (estimate). A full-library pass would take roughly 160–325 h, assuming 3.5-minute tracks. Your windowed approach is the right call.
- Padding: use at least one full 7.8 s model segment around the target, so about 4–8 s per side. The target region then sits away from the model's edges and crossfades. This is inferred from the segment and overlap design, not measured.

### Gaps
- Measured SDR against padding or window length.
- CPU real-time factors for RoFormer, MDX-Net or SCNet on a laptop.
- SDR for Kim_Vocal_2 and Voc_FT. The score file was too large to read through.

## 7. Lyric alignment

### Takeaway
Purpose-built singing aligners reach a median near 40 ms and a mean near 150–220 ms. WhisperX and MMS_FA have no peer-reviewed numbers on singing that I could find. Expect them to be worse, with rap and non-English worse again.

### Cited Findings
- Jamendo English, mean absolute error: Stoller .82 s, Vaglio .37, Demirel .31, Huang .23, Gupta .22, Durand .15–.16. PCO is 92–94%. [solid] [paper](https://ar5iv.labs.arxiv.org/html/2306.07744)
- JamendoLyrics Multi-Lang: Durand with language conditioning .18 s overall (EN .21, ES .13, DE .16, FR .19). English-only training hurts: Gupta scores ES .97, FR .78. [solid] [paper](https://ar5iv.labs.arxiv.org/html/2306.07744)
- Cheng et al. 2025: MAE .216 s, median .041 s on Jamendo. [solid, abstract only] [DAFx](https://dafx.de/paper-archive/details/o-wYFu7sQFE_GuYrAHxIHA)
- Mandarin polyphonic: fine-tuned Whisper encoder with an RNN and separation reaches MAE .071 s. [solid, abstract only] [ASRU 2023](https://ar5iv.labs.arxiv.org/html/2311.12488)
- MIR-MLPop offers 90 Mandarin, Cantonese and Hokkien songs for your own evaluation, non-commercial only. [solid] [repo](https://github.com/york135/MIRMLPop)
- Singing-tuned MMS-300m (Tune Studio):
  - Syllable F1 .875 against .788 for the first pipeline with the stock aligner, on 74 held-out English and German songs.
  - 79.6% of syllable starts have a boundary-head peak within ±40 ms, 94.0% within ±80 ms.
  - ONNX available, CC BY-NC, self-reported.
  - [practitioner] [card](https://huggingface.co/tuneperfect/tunestudio-aligner)
- WhisperX-style aligners: one issue tracker claims about .2 s for forced alignment against .5 s for free recognition on JamendoLyrics, citing an internal document. [anecdotal] [issue](https://github.com/WXYC/media-worker/issues/8)
- Separation, conflicting evidence:
  - Models trained on polyphonic audio beat those trained on separated vocals: Mauch .25 vs 3.62 s, Hansen .16 vs .67 s, Jamendo .34 vs .39 s. These are older separators and a training-domain comparison. [solid] [Gupta](https://ar5iv.labs.arxiv.org/html/1909.10200)
  - Whisper long-form WER barely moves on Jam-ALT (23.02 to 22.87) but improves on MUSDB-ALT (25.82 to 21.90). True stems reach 17.51. Timestamps were not measured. [solid] [paper](https://arxiv.org/html/2506.15514v1)
  - MAVL aligned both mix and vocal track, using the vocal result as a fallback and filtering low-confidence alignments. [practitioner] [paper](https://arxiv.org/pdf/2505.18614)
- Rap: a few hip-hop and metal songs produced the worst outliers on Jamendo. [solid] [Stoller](https://arxiv.org/pdf/1902.06797) Prior work cited by Gupta finds rap less intelligible because of its syllable rate. [solid] [Gupta](https://ar5iv.labs.arxiv.org/html/1909.10200) I found no rap-specific error figure.
- Imperfect lyrics: extra or missing words degrade alignment. [practitioner] [syncalong](https://pypi.org/project/syncalong/) WhisperX maps unknown characters to a wildcard and keeps a segment's original timing if it has no dictionary characters. [solid, code] [alignment.py](https://raw.githubusercontent.com/m-bain/whisperX/main/whisperx/alignment.py)
- WhisperX 3.8.6 pins torch~=2.8.0, torchaudio~=2.8.0 and torchvision~=0.23.0. It also requires pyannote-audio>=4, ctranslate2, faster-whisper, and torchcodec <0.8 on Windows. [solid] [PyPI](https://pypi.org/pypi/whisperx/json)
- torchcodec on Windows needs the FFmpeg DLLs loadable (`ffmpeg.exe` on PATH is not enough), and FFmpeg 8 reportedly fails. The reports concern pyannote and torchcodec, not WhisperX directly. [practitioner] [HF forum](https://discuss.huggingface.co/t/cannot-load-torchcodec/169260)
- Lighter routes:
  - WhisperX's package init is lazy ([init](https://raw.githubusercontent.com/m-bain/whisperX/main/whisperx/__init__.py)).
  - `alignment.py` needs torch, transformers, pandas and nltk, and falls back from torchaudio to Hugging Face models. It has no pyannote import. [solid, code]
  - ctc-forced-aligner covers ~1,130 languages with 30 s windows and 2 s of context, and needs romanization for the default model. That model is CC-BY-NC. [practitioner] [README](https://raw.githubusercontent.com/MahmoudAshraf97/ctc-forced-aligner/main/README.md)
- MMS_FA through torchaudio is a dead end. The [tutorial](https://docs.pytorch.org/audio/stable/_sources/tutorials/ctc_forced_alignment_api_tutorial.rst.txt) says these APIs were removed in 2.9, though the [2.9 reference page](https://docs.pytorch.org/audio/2.9.0/generated/torchaudio.functional.forced_align.html) still describes removal as upcoming. [solid, docs conflict]

### Inferences
- Pass LRC line times as segments, padded by 0.5–1 s, because aligning strictly inside a wrong line window compresses words. This comes from reading the code and is untested.
- Gate on alignment score and reject low-confidence lines rather than trusting a forced fit.

### Gaps
- WhisperX, stable-ts, wav2vec2 or MMS_FA on JamendoLyrics: no peer-reviewed numbers found.
- Any benchmark with deliberately imperfect lyrics or real LRCLIB text.
- Korean, Japanese and Thai alignment on singing.

## 8. Audible timing thresholds

### Takeaway
Design around 20 ms for percussive alignment and treat 40 ms as a clear failure. Nothing I found measures word misplacement directly.

### Cited Findings
- Trained listeners need 15–20 ms for temporal order (Hirsh). Goebl and Parncutt report about 20 ms for pure tones and about 30 ms for piano. Fusion extends to about 40 ms for complex sounds. Listeners preferred under 19 ms in jazz trios (Hofmann). All are as summarised in this paper. [solid, secondary] [PLOS One](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0218162)
- Singing ensembles: differences in asynchrony become detectable somewhere between 10 and 38 ms, and natural mean asynchrony was 57–95 ms in duos. [solid] [PLOS One](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0218162)
- Isochrony: the just-noticeable displacement is about 6 ms for intervals under 240 ms, and about 2.5% of the interval above that. Musical training made no difference. [solid] [Friberg & Sundberg](https://zendy.io/pdf-viewer/10.1121/1.413218)
- Fast-attack pairs split into two events at about 40 ms or more, while kick-plus-slow-attack pairs stay anchored to the kick. [solid, abstract only] [RITMO listing](https://www.uio.no/ritmo/prosjekter/time/index.html)
- Listeners disliked irregularity within the drum track, but bass-versus-drum displacement had no effect on ratings. [solid, snippet only] [Senn 2017](https://www.frontiersin.org/articles/10.3389/fpsyg.2017.01709)
- Synthetic onset-only tones can be detected at about 1 ms. This does not reflect full mixes. [solid, abstract only] [AES 2025](https://aeseurope2025.sched.com/event/222b4/detection-of-spectral-component-asynchrony-applying-psychoacoustic-research-to-transient-phenomena-in-music)
- Lip-sync proxy for on-screen lyrics: detectable at +45 / −125 ms, acceptable at +90 / −185 ms. [solid, different modality] [ITU BT.1359](https://www.itu.int/dms_pubrec/itu-r/rec/bt/R-REC-BT.1359-1-199811-I!!MSW-E.doc)

### Inferences
- At 120 BPM, 2.5% of a beat is 12.5 ms.
- A 0.1 BPM tempo error accumulates to about 53 ms over 32 bars, so periodic re-phasing is mandatory.
- The 20 ms beat frame means raw beat times have about ±10 ms quantisation before any tracker error.

### Gaps
- Word-misplacement perception. The 0.3 s PCO window is a benchmark convention, not evidence of audibility.
- I could not confirm Rasch's primary figures.

## 9. Lyric matching

### Takeaway
Multi-language rhyme is a stack of partial tools, and semantic matching on lyrics has no direct benchmark. Lightweight options do exist.

### Cited Findings
- DopeLearning defines multisyllabic rhyme as multi-word assonance and adds a rhyme-density measure. [solid] [arXiv](https://arxiv.org/pdf/1505.04771)
- Hirjee and Brown score imperfect and internal rhymes with a probabilistic model trained on rap phoneme frequencies. [solid, summary only] [scite](https://scite.ai/authors/hussein-hirjee-Yjpv4K)
- RhymePad uses CMUdict with a g2p-en fallback, treating a shared vowel run as a slant rhyme. [practitioner] [PyPI](https://pypi.org/project/rhymepad/)
- Epitran: English needs Flite. Chinese needs CC-CEDict, which it cannot distribute. French, Portuguese and Arabic are flagged as ambiguous, with limited accuracy. There are no Windows notes. [solid] [README](https://raw.githubusercontent.com/dmort27/epitran/master/README.md)
- CharsiuG2P is a ByT5 model covering about 100 languages. [solid, abstract only] [Interspeech 2022](https://www.isca-archive.org/interspeech_2022/zhu22_interspeech.html)
- simplemma is pure Python, offline, 54 languages, about 50 MB in low-memory mode. UD accuracy: EN .96, ES .96, FR .96, DE .97, IT .95, PT .95, ID .93, TL .84. Its table has no Chinese, Japanese, Korean, Thai or Vietnamese. [practitioner, measured] [README](https://raw.githubusercontent.com/adbar/simplemma/main/README.md)
- EmbeddingGemma: 61.15 on MTEB Multilingual v2, 7.68 points above the next sub-500M model, with the lead holding at 128 dimensions and 4-bit weights. [solid] [paper](https://arxiv.org/html/2509.20354v3) An [ONNX checkpoint](https://releases.sh/release/rel_BwxGl_zBfEgFELWANCF50) exists. [practitioner]
- On Intel CPUs, sbert's guidance favours OpenVINO int8 (tested on an i7-13700K). [practitioner] [sbert](https://sbert.net/docs/sentence_transformer/usage/efficiency.html)
- model2vec needs only numpy and offers a multilingual model distilled from bge-m3. Its "up to 500× faster" is a vendor claim. [practitioner] [README](https://raw.githubusercontent.com/MinishLab/model2vec/main/README.md)

### Inferences
Song-level theme matching can afford embeddings computed offline. Rhyme should stay phoneme-based with a language-specific route, and low-confidence languages should simply not use rhyme as a transition signal.

### Gaps
- Any benchmark on lyric similarity, or on phoneme-based rhyme in Spanish, Tagalog or Korean.
- CPU latency on this chip.
- CJK lemmatisers: not researched.

## 10. Lyrics sources

### Takeaway
LRCLIB is fine through the API. The dump does not fit on your disk. Coverage for your library is unknown and easy to measure.

### Cited Findings
- No API key is needed. Identified clients get about 90 requests/min per IP. Send sequentially with 200–500 ms delays and honour `Retry-After`. `/api/get` matches duration within ±2 s, and misses may be backfilled later. No data licence is stated. Publishing is open to anonymous submitters, and a flag endpoint covers wrong lyrics or copyright issues. [solid] [docs](https://lrclib.net/docs.txt)
- Records include a `lyricsfile` field, and `hasWordSync` marks word-level timings. [solid] [docs](https://lrclib.net/llms-full.txt)
- Dumps: the newest listed file (September 2026) is 44.3 GiB gzipped, per a search snippet of the [dumps page](https://lrclib.net/db-dumps). Direct fetch only returned a JavaScript stub, so this is unconfirmed. An [August 2024 dump](https://btdig.com/37acf713fd978442b0bddd261bccf107607ce319) was 4.89 GB. [practitioner]
- An undated listing says nearly 3M non-deduplicated lyrics and an MIT-licensed codebase. [practitioner, may be stale] [listing](https://awesome.ecosyste.ms/projects/github.com%2Ftranxuanthang%2Flrclib)
- syncedlyrics supports Musixmatch, LRCLIB, NetEase and Megalobiz. Genius is plain only, and Deezer and Lyricsify are broken. It does not address copyright. [practitioner] [README](https://raw.githubusercontent.com/moehmeni/syncedlyrics/main/README.md)
- Third-party pages say Musixmatch's free tier returns about 30% of lyrics and that full lyrics need a commercial plan. I did not retrieve official pricing. [anecdotal] [directory](https://freeapihub.com/apis/musixmatch)
- Whisper-only fallback has a long-form WER of about 20–23% on Jam-ALT, with English worse at about 25–27%. [solid] [paper](https://arxiv.org/html/2506.15514v1)

### Inferences
- 1,389 lookups take at least about 15.5 minutes at 90 requests/min.
- Fallback order: LRCLIB synced, then LRCLIB plain plus forced alignment, then ASR text marked low-trust and excluded from word-level edits.
- Using scraped providers carries terms-of-use risk, so keep them off by default. I did not review their terms.

### Gaps
- Hit rates: no published coverage figure, and nothing by language.
- The accuracy of community line timings.
- LyricFind and other licensed sync sources.

## Design implications for Selecta

CPU costs below are my estimates, assuming 3.5-minute tracks. None was measured on this i7-10510U, so time each on 10 files before committing. Accuracy figures come from benchmarks that only partly match your library.

| Task | Recommendation | Expected accuracy | Estimated CPU |
|---|---|---|---|
| Beats, downbeats | Keep beat-this. Use `small` for bulk, rerun `final` where grid fit is poor. Add your own grid fit and onset snap. | Beat F1 ~89–96; downbeat F1 ~77–94, weaker on rap and drifting tracks | 10–20 s per track (4–8 h total); `final` maybe 60 s |
| Key | **Change:** S-KEY, keeping chroma as a cross-check. Check the licence if you ever distribute. | About 72–74 MIREX vs ~53 for templates (FMAKv2); hip-hop lower | 5–15 s per track |
| Sections | Keep bar SSM. Move to Barwise TF with CBM. | HR3F ~.55–.72, HR.5F ~.40–.58 | 2–5 s per track |
| Chorus | **Add** LRC line repetition plus energy. Output a confidence, no hook feature. | Unsupervised chorus F1 ~.53–.61; lyric gain unmeasured; rap often has none | Negligible |
| Cue points | Rules on downbeats, sections and energy. Skip CUE-DETR except as an EDM experiment. | Unmeasured; CUE-DETR's best is .46 on EDM | Negligible |
| Energy | Composite heuristic, then rate about 50 tracks yourself. Effnet ONNX optional. | Unvalidated | 2–5 s per track |
| Stems | Keep htdemucs on windows, computed on demand and cached. Time SCNet and audio-separator's Mel-Band on 5 tracks. | Vocals 8.24 dB, candidates up to 10.98 | ~46 s window: 1.5–3 min |
| Word timing | **Change:** drop the full WhisperX install. Use its alignment module or ctc-forced-aligner. Trial Tune Studio ONNX on English and German. | Median ~40–100 ms, mean ~200–500 ms (estimate); worse on rap and non-English | 10–40 s per 30 s window |
| Rhyme | **Change:** keep `pronouncing` as the fast path, add g2p-en, vowel-run matching, and per-language G2P. | Unmeasured | Negligible |
| Semantic | **Add** model2vec or EmbeddingGemma ONNX, offline. | No lyric benchmark | Minutes to tens of minutes in total |
| Lemmas | **Add** simplemma, excluding CJK and Thai. | .84–.97 by language | Negligible |
| Lyrics | Keep the LRCLIB API, log hit rate by language, and don't download the dump. | Measure on your library | At least 15.5 min |

**Timing tolerances to design for:**
- **Transient on transient (kick, snare):** target ≤10 ms, hard limit 20 ms. At 40 ms or more it reads as two events.
- **Beat-grid jitter:** ≤6–12 ms at typical tempos.
- **Long blends:** re-phase at least every bar, because 0.1 BPM drifts about 53 ms over 32 bars.
- **Vocal against beat:** aim for ≤40 ms. Wider is plausible given natural singing asynchrony, but this is an inference.
- **Vocal on vocal:** aim for ≤20–30 ms.
- **On-screen lyrics:** lead under 45 ms, lag under 125 ms, as a lip-sync proxy.
- **Word cuts:** don't trust aligner boundaries directly. Search ±80 ms around them for a vocal energy minimum. This has no direct perceptual study behind it.

**Tool choices, against your list:**
- **Change:**
  - librosa key profiles move to S-KEY.
  - The full WhisperX dependency install goes. Keep only the alignment path, or use ctc-forced-aligner.
  - Don't build on torchaudio's MMS_FA.
- **Extend:**
  - beat-this gains `small` for bulk, a grid fit and onset refinement.
  - The SSM gains CBM and lyric repetition.
  - `pronouncing` becomes one route among several.
- **Keep:** htdemucs windows (with 4–8 s padding per side) and the LRCLIB API.
- **Reject on this machine:**
  - SongFormer: Linux and GPU-tested, a ~1.2 GB MuQ checkpoint by my estimate, and non-commercial weights. A one-off rented GPU pass, at 2–4 s per song, is the only sensible way to use it.
  - allin1: NATTEN and madmom builds, plus demixing on top.
  - Essentia and madmom as runtime dependencies.
  - The LRCLIB dump.

**Run before committing (all cheap):**
- Time each tool on 10 files.
- Check beat-this and S-KEY by ear on 20 rap and Latin tracks.
- Compare alignment on mix against separated vocal on 10 songs across languages. This is the largest unresolved question in the design.
