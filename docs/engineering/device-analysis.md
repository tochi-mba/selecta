# Whole-song measurement on the device

The device studio (ADR-0479, phase 5) measures songs that stay on a member's device in the
member's browser, and later sends the numbers (never audio) to the account. The planner's gates
were calibrated on the Desktop's Python numbers, so the browser must match them, not resemble
them. This page is the contract both implementations follow, and the record of how closely
they agree.

- Python: `src/selecta/analysis/` (`pipeline.analyse_audio`, `beats.py`, `features.py`,
  `key.py`), recipe `ANALYSIS_VERSION = 3`.
- Browser: `web/src/dsp/analysis/` (`song.ts::analyseSong` and the files it calls), run in the
  analysis worker, behind the flag `cloud.device_analysis` (off by default).
- Fixtures: `tools/device_analysis_golden.py` writes `web/src/dsp/golden/device-analysis/`.
- Library versions the recipe was read from: librosa 1.0.0, numpy 2.5.4, scipy 1.18.1,
  python-soxr 1.1.0, pyloudnorm 0.2.0.

## The recipe

| Step | Python | Port | Notes |
|---|---|---|---|
| Decode | ffmpeg to float32 stereo at 44,100 Hz | `OfflineAudioContext` at 44,100 Hz | A mono file is the one channel twice (ffmpeg `-ac 2`); more than two channels keep the first two (ffmpeg downmixes; not matched) |
| Mono | `stereo.mean(axis=1)`, float32 | `toMono` | Sum in float32, halve |
| Resample | `soxr.resample(mono, 44100, 22050, quality="HQ")` | `resample.ts` | See "Resampling" |
| Onset envelope | `librosa.onset.onset_strength(sr=22050, hop_length=128, n_fft=1024, aggregate=np.median)` | `onsetEnvelope.ts` | Below |
| Beats | Beat This `small0`, 50 frames a second | `BeatSource` | Not ported in this step; see "Beats" |
| Grid | `beats.build_grid` | `grid.ts` | Below |
| Features | `features.extract` | `features.ts` | Below |
| Sections | `features.find_sections` | `sections.ts` | Float64 throughout |
| Key | S-KEY, chroma `chroma_key` as second opinion | `songKey.ts` | Below |
| Loudness | `features.loudness`: pyloudnorm on the 44.1 kHz stereo | `songLoudness.ts` | Below |
| Waveform | `features.waveform_peaks(mono)`, 1600 bins, uint8 | `song.ts::waveformPeaks` | Kept on the device only |

**STFT (both uses).** librosa 1.0 `stft`: centred, zero padding of `n_fft/2` at both ends
(`pad_mode="constant"`), `1 + len // hop` frames, the periodic Hann window
`scipy.signal.get_window("hann", n, fftbins=True)` (built as `0.5 + 0.5 cos(x)` on
`linspace(-pi, pi, n + 1)`, last point dropped). Float32 input gives a complex64 result: the
port computes in float64 and rounds the real and imaginary parts to float32, the magnitude to
float32, and squares in float32 (`np.abs(stft)**2`). Checked against librosa: 65 percent of
power cells bit-equal, the rest within 4e-7 relative (pocketfft against a radix-2 FFT).

**Onset envelope.** 1024-point frames every 128 samples; a 128-band mel power spectrogram
(`filters.mel`: Slaney mel scale, Slaney area norm, `fmax = 11025`, weights stored float32 and
then scaled by the float64 norm); `power_to_db` (ref 1, amin 1e-10, floor 80 dB below the
loudest cell of the whole song, float32); the positive rise from each frame to the next; the
median across bands (float32, the mean of the middle two); five zeros in front (one for the
lag, `n_fft // (2 * hop)` = 4 for centring); cut to the spectrogram's length.

**Grid (`build_grid`).** `regularize` drops beats closer than 0.55 of the median gap and fills
gaps by `round(gap / period)` (half to even). `_constant_grid` searches 1201 periods across
plus or minus 3 percent of the median gap, then 201 across plus or minus 0.05 percent, for the
largest phase coherence `|mean(exp(2 pi i t / p))|`; it keeps the fit when at least 70 percent
of beats (and 16) fall within 30 ms and the least-squares line misses by at most 16 ms RMS.
Otherwise `_smooth_grid`: a 9-wide median of the gaps, gaps off by more than 12 percent
replaced, Savitzky-Golay (17 beats, order 2, scipy's `interp` edges), a median-filtered
drift with an order-1 fit, then a running maximum. The grid is shifted by the median offset of
the strongest onset within 40 ms (when 8 beats are strong: envelope at least
`max(2 median, 70th percentile)`, the percentile interpolated in float32 as numpy does), and
the onset agreement is the share of beats with a strong onset within 30 ms. Bars: downbeats
snapped to the nearest beat within 90 ms, meter 3 when gaps of 3 outnumber gaps of 4, a
dynamic programme over bar phase with a switch cost of 6. Tempo stability is 1 for a constant
grid, else `1 - (std / mean of 8-beat spans) / 0.05`, clipped. `bpm = 60 / median gap`;
`confidence = clip((agreement + regularity) / 2 * (0.35 + 0.65 stability), 0, 1)`.

**Features (`extract`).** One STFT, 2048-point frames every 512 samples at 22,050 Hz:

- mel: 64 bands, `power_to_db(top_db=80)`; MFCC: 20 coefficients of the orthonormal DCT-II.
- chroma: `chroma_stft(S=power)`, so the tuning is estimated first: `piptrack` peaks between
  150 and 4000 Hz above a tenth of each frame's maximum (parabolic shift computed as numba
  types it: float64 for anything with the integer 2, stored float32), the median peak
  magnitude as threshold, and the left edge of the fullest 0.01-semitone histogram bin of the
  strong peaks' deviation from the 12-tone grid. Then `filters.chroma` at that tuning
  (`ctroct=5`, `octwidth=2`, `norm=2`, `base_c=True`) and each frame over its largest value.
- `rms_db = 10 log10(max(sum(power) / 2048, 1e-10))`, the share of power below 200 Hz,
  `flux` (the mean positive rise of the dB mel bands), and the spectral centroid (float64).
- Bars: `time_to_frames` of the bar times and the song's end (truncation, then floor
  division), each array averaged between edges through a running sum taken in the array's own
  precision (float32 for librosa's arrays; the cancellation in that float32 running sum is part
  of Python's answer, so the port keeps it). Chroma bars over their largest value.
- `energy_bars = 0.45 level + 0.30 flux + 0.15 brightness + 0.10 low share`, each scaled and
  clipped (level between the 5th percentile minus 3 dB and the 99th plus 1 dB, both float32);
  `energy` is the mean of the louder half of the bars; `timbre` is 29 numbers (MFCC 1 to 13
  means and spreads, mean centroid, low share and flux).

**Key.** The Desktop runs S-KEY and keeps the chroma key as a second opinion; without S-KEY,
`analyse_audio` stores the chroma key with confidence 0.2 and `key_agrees_chroma` 1. S-KEY is
not available to Cloud (ADR-0479, "Not decided here"), so the port stores exactly that
fallback: the Krumhansl-Schmuckler template with the largest plain dot product against the
centred float32 chroma profile. `key.ts::matchKey` (the older lightweight estimate) scores by a
normalised correlation and can pick a different key; it is not used here.

**Loudness.** pyloudnorm 0.2 `Meter(rate)`: RBJ high shelf (+4 dB, 1500 Hz, Q 1/sqrt 2) and
high-pass (38 Hz, Q 0.5) applied by `lfilter`; `round((T - 0.4) / 0.1) + 1` blocks of 400 ms,
each bound truncated to a sample, each mean square over a full 400 ms even when the last block
runs past the end; the absolute gate keeps -70 LUFS itself, the relative gate is 10 LU below.
Peak is `20 log10(max |sample|)` over both channels. The browser's playback meter
(`web/src/dsp/loudness.ts`) uses libebur128's filter constants, whole blocks only and a strict
absolute gate; on the fixtures it reads within 0.0083 LU of pyloudnorm, but the port follows
pyloudnorm exactly rather than carry that difference.

**What is stored.** The analysis row as `analyse_song` writes it (bpm to 2 places,
confidence to 3, lufs and peak to 2, energy to 3, timbre to 3, Python's rounding half to even
reproduced from the exact decimal value), and the arrays: `beats` float64, `bar_starts` int32,
the five bar arrays float32 (the account's wire types, `engine_store/facts.py`; the Desktop's
own file keeps them as float16, which differs from these by up to 1e-3 relative), and on the
device only `raw_beats`, `raw_downbeats` and `peaks`. A song with no steady beat is stored with
`row: null` and Python's error text, so it is not measured again.

## Resampling

soxr has no browser port, and a browser's own resampler differs by browser and is not exposed
for a chosen quality. So the port brings every decode to 22,050 Hz with its own resampler, a
polyphase Kaiser-windowed sinc (`resample.ts`): 28 zero crossings, passband to 0.97 of the
lower Nyquist, beta 9, each phase normalised to unit gain, zeros beyond the ends, summed in
float64 from the first tap to the last and rounded to float32 once. The fixtures use the same
resampler written in numpy, so every later stage is compared on one signal, and they measure
separately what the choice costs against soxr. The settings were the closest to soxr HQ of those
tried on the fixtures' bar features (the first choice, 24 crossings at 0.92, missed the
MFCC bars by up to 1.5).

Measured effect of the resampler alone (the Desktop functions on the soxr signal against the
same functions on the port's signal; six songs with a grid, seven for loudness):

| Measurement | Largest difference | Planner tolerance |
|---|---|---|
| Tempo, beat grid, grid confidence, bar starts | 0 (identical) | 0.05 BPM, 2 ms, 0.02 |
| Bar energy | 1.2e-4 relative | 1 percent |
| Chroma bars | cosine at least 0.99968 | at least 0.995 |
| MFCC bars | 0.036 absolute | none set |
| Bar level (`rms_db_bars`) | 0.0003 dB | none set |
| Key, sections | identical | equal, within a bar |
| Onset envelope | 0.62 dB in one frame (peaks near 19) | none: the grid is unchanged |
| Loudness, peak | 0 at 44.1 kHz; 0.0029 LU and 0.0002 dB at 48 kHz | 0.2 LU, 0.2 dB |
| Timbre | 0.41 (the centroid mean, in Hz, at 48 kHz) | none set |

The 48 kHz song's Desktop path is soxr from 48 to 44.1 kHz standing in for ffmpeg's decode,
then the usual path. In the browser the profiler decodes at 44.1 kHz as the Desktop does, so
the decoder's resampler (the browser's, not measurable here) does that first step; the port's
direct 48 to 22.05 kHz path is what `analyseSong` does with a 48 kHz input.

## Agreement of the port with the fixtures

The vitest files beside the ports assert, per song:

| Stage | Compared with | Tolerance asserted |
|---|---|---|
| Resampled mono (length, sum, energy, probes) | numpy resampler | equal length; 1e-6 relative |
| Onset envelope | `onset_envelope` on that signal | 1e-3 absolute (values reach 19) |
| Grid from the fixture's envelope | `build_grid` | beats 1e-6 s, bpm 1e-6, confidence 1e-9, bar starts equal |
| Frame features | the same librosa calls | tuning equal, levels 1e-3 dB, chroma 1e-4 |
| Bar features | `extract` | energy 1e-4 relative, chroma cosine 0.99999, MFCC 0.01 |
| Sections, key, row | Python's | equal |
| Loudness, peak | pyloudnorm | 1e-6 LU, 1e-9 dB |
| End to end | the soxr (Desktop) reference | the planner tolerances above |

These tests were written but not run in this change (the owner's rule: CI runs them). Their
results are in CI for `web/src/dsp/analysis/*.test.ts`. The tolerances above are the
expectation from the checks that were run: the STFT, mel and chroma filterbanks, the
`piptrack` peaks, the tuning and the float32 percentiles were each reproduced in Python from
the port's formulas and matched librosa exactly (filterbanks and peaks bit-equal); the risks
are a tuning estimate that flips by 0.01 when a peak sits on a histogram edge, and an argmax
in the grid that flips between near-equal onsets. Either would show as a stage failure.

## Beats

Beat This is not ported here: its model must be exported and licensed first (ADR-0459). Until
then `beatSource.ts::browserBeatSource` stands in: the browser's autocorrelation tempo
(`tempo.ts`) over the whole song's onset envelope, the phase that puts the most onset strength
on the beats, and downbeats every fourth beat from the strongest bar phase. It assumes 4/4, so
a waltz measured this way reads as 4/4, and it does not follow tempo changes. The facts carry
its id, so the account can tell them from neural ones, and the stored version names it, so
Beat This in the browser measures every song again.

## Implementation ids

- `web-dsp-1`: this port (`deviceAnalysisIds.ts`); in the account's allowlist,
  `engine_store/facts.py::DEVICE_IMPLEMENTATIONS`.
- `web-onset-comb-beats-1`: the interim beat source. Stored as derived kind `analysis`,
  version `web-dsp-1+web-onset-comb-beats-1`.

## Cost

Linear in the song's length except the sections (bars squared): resampling 117 multiply-adds
per output sample; one 1024-point real FFT per 128 samples for the onsets; two 2048-point real
FFTs per 512 samples for the features (chroma needs a second pass once the tuning is known);
1402 coherence periods times the beats. One FFT plan per size, no allocation per frame, the
full spectrogram never held. No timing was measured in this change.

## Found on the way

- `_constant_grid` misses a steady song whose beats fall midway between Beat This's 20 ms
  frames: they alternate 10 ms early and late, the median gap is 0.52 s at 120 BPM, and the
  3 percent search never reaches 0.50 s. Fixture `house-120-a-minor` is one: Python stores
  `constant_tempo` 0 and 119.87 BPM. Not changed here.
- On sparse music the envelope's 70th percentile is 0, so every beat counts as strong.

## Next

1. Beat This in ONNX (export, licence review, per-device benchmark), as a `BeatSource`.
2. Sending the facts to the account through the device route, as `web-dsp-1`; then a listening
   check of plans from device facts against Desktop facts for the same songs.
