# Rendering and auditing a transition on the device

ADR-0479, phase 5. The browser renders a `TransitionScript` (docs/engineering/transition-script-json.md)
offline into a short clip, measures it with the Desktop's audit and follows the Desktop's repair
rule, instead of improvising the transition live with Web Audio. This page is the recipe both
sides follow and the record of how closely they agree. Playback does not use it yet.

- Python: `render/engine.py` (`render`, `in_context`), `render/dsp.py`, `render/script.py`,
  `audit/checks.py` (`audit`, `audit_facts`), `planner_core/repair.py`.
- Browser: `web/src/dsp/render/`, run by `web/src/dsp/workers/renderWorker.ts`, behind the
  Cloud flag `cloud.device_render` (off).
- Fixtures: `tools/device_render_golden.py` writes `web/src/dsp/golden/device-render/`.
- Libraries the recipe was read from: numpy 2.5.4, scipy 1.18.1, python-soxr 1.1.0, librosa
  1.0.0, pedalboard 0.9.26 (Rubber Band).

## Signal

44,100 Hz (`config.SAMPLE_RATE`), stereo. Python holds `(samples, 2)` float32; the port holds one
`Float32Array` per channel. A float32 operation in numpy rounds every step to float32 and the
port does the same with `Math.fround`, including numpy's weak scalars (a Python float meeting a
float32 array is first rounded to float32, also in comparisons). numpy's float32 sums are
pairwise (blocks of 128 with eight accumulators, halved recursively above that); a sum along
axis 0 is sequential. The port's `npy.ts` reproduces both.

## render(), stage by stage

| Stage | Python | Notes |
|---|---|---|
| Length | `count = int(round(duration * 44100))` | Python's round, half to even |
| Curve | `np.interp(arange(count) / 44100, times, values)` to float32 | Points sorted by time; numpy's interp rules (left value before the first point, right after the last, a point hit exactly returns its own value) |
| Heard warp | `warp.trimmed(render_from or first output, render_until or last output)` | Only when either is set |
| Identity read | `is_identity`: every slope within 2e-4 of 1 | Copy `round((source[0] - window_origin) * 44100)` onwards to `round(output[0] * 44100)`, for `min(count - start, available, round(span * 44100))` samples |
| Stretched read | `dsp.stretch_to_warp` | Below |
| Pocket nudge | `_pocket_lag` on placed A and B (before any moves) | Below |
| Moves | `_apply_moves` per part | Below |
| Sum | `dry_a + dry_b + tails_a + tails_b`, then each extra's `dry + tails` in order | float32, left to right |
| Sides for the audit | A's and B's dry signals; with `meta.stem_lanes`, each extra's dry joins B if `follows_b`, else A | |
| Limit | `dsp.limit(mixed)` | Below |

**Stretch (`stretch_to_warp`).** The segment is the source from `round((source[0] - 0.5 -
window_origin) * 44100)` (at least 0) to `round((source[-1] + 0.5 - window_origin) * 44100)`.
Each input sample's ratio is the slope of the warp piece its song time falls in
(`searchsorted(side="right") - 1`, clipped). pedalboard `time_stretch(high_quality=True,
transient_mode="crisp")` plays it with that ratio per sample (a ratio above 1 is faster). Then
`output_position = [0, cumsum(1 / ratio / 44100)]`; `head` is that at the warp's first source
time; the expected onset envelope is the segment's `transient_envelope` moved to where each frame
should land (`np.maximum.at`); `correct_drift` slides 2 s windows of the stretched envelope
against it every 0.5 s within 90 ms, a median of 3 or 5 smooths the lags, and `fine_warp` (16-tap
Kaiser 8.6 sinc, 256 phases, float32) removes the drift. The clip is `[head, head + count)`.

**Moves (`_apply_moves`).** `signal = placed * float32(10 ** (gain_db / 20))`. If any band curve
is not constantly 1: `split_bands` (low = zero-phase lowpass at 200 Hz; high = input minus the
zero-phase lowpass at 2,500 Hz; mid = input - low - high, float32) and `low*l + mid*m + high*h`.
Then `highpass` and `lowpass` sweeps, then the sends, and last the fader: `dry = signal * gain`.

**Zero-phase filters.** `butter(2, fc, fs=44100, output="sos")` run by `sosfiltfilt`: odd
extension of 9 samples (computed in float32 from the float32 input), steady-state initial
conditions `sosfilt_zi` scaled by the first sample, direct form II transposed in float64 forwards
and backwards, then float32. The port designs the section by the bilinear transform in closed
form (`tan(pi fc / fs)`), within 3e-16 relative of scipy's coefficients; on noise its filtered
float32 output matched scipy in every sample. The highpass is `input - lowpass`, so a band split
with neutral gains returns the input exactly.

**Sweeps (`sweep_filter`).** A bank of fixed filters at `geomspace(max(low, 10), min(high,
19845), n)`, `n = max(2, ceil(log2(high / max(low, 1)) * 3) + 1)` (log2 of at least 1.01); each
sample crossfades the two members around `interp(log(max(cutoff, 1)), log(centres),
arange(n))`, the log taken in float32. Python stacks every member in memory; the port runs one
member at a time and adds each where it is used, which gives the same float32 sums.

**Echo (`echo_tail`).** Repeats every `round(delay * 44100)` samples while the gain (starting at
`wet`, times `feedback` each time) is above 0.01; each repeat is the previous one through the
damping lowpass; the sum is high-passed at `return_highpass_hz`. No randomness.

**Wash (`reverb_tail`).** `room_response(decay, damping, seed=11)`: `int(decay * 1.5 * 44100)`
samples of `default_rng(11).standard_normal((n, 2))` as float32, split at 700 Hz, the low part
decaying to -60 dB at `decay`, the high part at `decay * max(1 - damping, 0.1)`, a 12 ms fade-in,
each channel normalised to unit energy, 15 ms of silence in front. `fftconvolve(send, response)`
(float32 FFTs), cut to the clip, times `wet`, high-passed. The port reproduces numpy's generator
exactly (SeedSequence, PCG64, the 256-layer ziggurat with numpy's own tables; checked equal for
the first two million draws) and convolves with a float64 FFT.

**Pocket nudge (`_pocket_lag`, `_slide`).** Only when `expects_beats_aligned`, the overlap lasts
4 s or more and 1 s or more follows it. Over the overlap of placed A and B (channel means),
`onset_offset`: the transient envelope (128-sample frames of the summed absolute first
difference, `log1p(200 x)`, positive rise) of the full band plus that of the 250 Hz zero-phase
lowpass, each over its maximum; correlation at lags within 20 ms (6 frames); no answer at an edge,
a non-positive peak, or a peak under 1.25 times the median score; parabolic refinement. Lags under
1 ms are dropped. B (and every extra with `follows_b`) is then read at `n + lag * 44100 * taper`
by `fine_warp`, the taper falling from 1 at the overlap's end to 0 at the clip's last sample.

**Limit (`dsp.limit`).** True peak per sample from `soxr.resample(x, 44100, 176400, "HQ")`, the
largest of each four, at least the sample peak; `needed = min(1, 10^(-1.1/20) / peak)`; nothing
changes if every value is 1. Else a minimum over 3,529 samples (80 ms, odd), a moving average of
the same width (scipy's running double sum, `mode="nearest"`), the smaller of that and `needed`.

**in_context.** Native A from `a_source_start - before` to 30 ms past the clip's start, times A's
gain; the clip; native B from 30 ms before `b_source_end` for `after` seconds, times B's gain.
Each join is a 1,323-sample linear crossfade (`linspace(0, 1, 1323)` float32), then `limit`.

## audit(), check by check

Every value is rounded as Python rounds it (`round(x, n)`, half to even on the exact double).

| Check | Measures | Pass | Fix |
|---|---|---|---|
| beat alignment | Only with `expects_beats_aligned`. Beats every `meta.period` across the overlap (numpy arange) where both fader gains are at least 0.2: the strongest envelope frame within 45 ms in A's and B's dry signals, each above its 92nd percentile (float32); the 75th percentile of the absolute differences, ms, 1 place | at most `meta.beat_limit_ms` or 20; fewer than 4 beats passes as 0 with no fix | change_recipe |
| vocal overlap | Skipped for an overlap under 0.5 s or `meta.wordplay`. Every 50 ms of the overlap, both sides singing (given spans, or lyric lines) and at least 0.25 on `meta.vocal_gains` or the fader; seconds, 2 places. With no spans and no lyrics: value 0, passes only if the overlap is 8 s or less | at most 2 s | shorten |
| phrase integrity | A cut mid-line (0.2 s margins) where A's voice is up, or B entering mid-line; 0 or 1 | 0 | move_cue |
| quiet time | 50 ms frames of the mix's mono RMS under 0.22 of the mean, from 2 s before to 2 s after the overlap; seconds, 2 places | at most 1.2 s plus `quiet_allowed` | close_gap |
| entry level | RMS of 3 s after the overlap over 3 s before it, dB, 2 places; under 1 s of either passes as 0 with no fix | at most 2.5 dB | move_cue |
| level fall | 3 s before the overlap against 1 to 8 s after it, dB; skipped if too short | at most 3.5 dB | move_cue |
| low end clash | Overlaps of 1 s or more: 100 ms frames of each dry side's 200 Hz lowpass, share where both exceed 0.3 of the loudest, 3 places | at most 0.15 | change_recipe |
| harmony | Overlaps of 4 s and `meta.bars` 4 or more: chroma of each dry side (mono, resampled to 22,050 Hz, 4096-point frames every 2048, tuning estimated, no normalisation), roughness together over the mean of each alone, 3 places | at most 0.16, or 0.24 under 8 bars | shorten |
| true peak | `soxr` 4 times over, dBTP, 2 places | at most -0.9 (limit -1.0 plus 0.1) | change_recipe |
| stretch | Largest warp slope away from 1 of A and B, percent, 2 places | at most 8 | change_recipe |

`audit_facts` keeps whether all passed and each failure's name, value, limit and fix.
Vocal spans: a script from JSON has no lyrics, so the browser passes the spans its studio
sensed, or none; with none it takes the careful path (the Desktop's audit does too when it has no
file to listen to). The audit's harmony check reuses the analysis port's chroma pieces
(`analysis/chroma.ts`) with this frame size.

## soxr

soxr has no browser port. The browser uses its analysis resampler (`analysis/resample.ts`, a
Kaiser-windowed sinc, 28 zero crossings) for the limiter's and the audit's true peak and the
harmony check's 22,050 Hz signal. The fixtures therefore run every Python function twice: once
with `soxr.resample` replaced by that resampler written in numpy (the port must match this one
closely), and once as the Desktop runs (the difference is recorded below).
