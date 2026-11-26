# Beats measured on this device: Beat This in the browser

The browser measures a song's beats with the Desktop's own tracker, Beat This `small0`
(`src/selecta/analysis/beats.py::BeatTracker`), so a song measured on a member's device gets the
same beats and downbeats the Desktop gets. The network runs in ONNX; everything around it is
ported to TypeScript under `web/src/dsp/analysis/beatThis/`. Everything after the beats (the grid,
the bars, the features) is the port in [device-analysis.md](device-analysis.md).

## The model

- Source: `beat-this` 1.1.0 (CPJKU, https://github.com/CPJKU/beat_this), checkpoint `small0`,
  from the URL the package itself names
  (`https://cloud.cp.jku.at/public.php/dav/files/7ik4RrBKTS273gp/small0.ckpt`), 8,451,101 bytes,
  SHA-256 `6074be2c4d490c5f6101fcc374a1ec72ae93456e23bb6019783b849f5dc7d47b`. Code and weights
  MIT (the README releases both under MIT). Nothing was downloaded for this: the Desktop's cached
  copy was used.
- Export: `tools/beat_this_onnx_export.py`, torch 2.15 TorchScript exporter (the dynamo exporter
  fails on this model), opset 17, float32, a dynamic time axis. Input `spect` float32
  [1, T, 128], outputs `beat` and `downbeat` float32 [1, T], T from 1 to 1500.
- Artefact: `beat-this-small0.onnx`, 10,527,297 bytes, SHA-256
  `221565e9ab7c825bac98266b618ff3b78df0a6bf3f67272b90f0a86da14f1ac4`. The export is
  reproducible byte for byte; the tool checks a rebuild against the committed record
  `web/src/dsp/analysis/beatThis/artefact.json`. No float16 or quantised variant: the size is
  fine and the float32 beats are already exact.
- Where it lives: never in this repo (it is public and holds no weights; `*.onnx` and `build/`
  are ignored). It is built into `build/beat-this/` and served from SelectaDJ's own site at
  `/models/beat-this/web-beatthis-small0-1/<sha256>.onnx`. Publishing it there is an owner step
  (to-do T-20261126-7164). Until then the fetch fails, the device notes it and waits a day, and
  the interim beat source measures, exactly as before.

## The recipe, step by step

| Step | Python (beat_this 1.1.0) | Browser |
|---|---|---|
| Signal | the 22,050 Hz mono `pipeline.py` makes (soxr HQ) | the same mono `resample.ts` makes |
| Spectrogram | `LogMelSpect`: torchaudio `MelSpectrogram(22050, n_fft=1024, hop_length=441, f_min=30, f_max=11000, n_mels=128, mel_scale="slaney", normalized="frame_length", power=1)`, then `log1p(1000 * mel)` | `spectrogram.ts` |
| Chunks | `split_predict_aggregate(chunk_size=1500, border_size=6, overlap_mode="keep_first")` | `chunks.ts`, `track.ts` |
| Network | `BeatThis` (`small0` hyper-parameters) | ONNX on onnxruntime-web (`runtime.ts`) |
| Peaks | `Postprocessor(type="minimal")`: the Desktop uses it (`dbn=False`), not madmom's DBN | `postprocess.ts` |
| Beats per bar | `beats.fit_bars`: 3 when gaps of 3 beats between downbeats outnumber gaps of 4, else 4 | `grid.ts::fitBars` (already ported) |

The spectrogram's details: a centred STFT with reflect padding of 512 samples at each end,
1 + floor(length / 441) frames, a periodic Hann window, the complex result scaled by 1/32
(1/sqrt(1024)), its magnitude; 128 triangular filters with torchaudio's `norm=None` (no area
normalisation), whose 130 edge frequencies are torch's own float32 values (recomputing them with
`Math.exp` lands one float32 step off on some edges). Chunks: starts at -6 then every 1488 frames,
the last moved to end 6 frames past the song; zeros where a chunk passes either end; each chunk's
first and last 6 outputs dropped; where chunks overlap the earlier chunk's frames are kept; a song
under 1488 frames is one shorter chunk. Peaks: a frame is a peak when it equals the maximum within
3 frames either side and its logit is above 0; runs of adjacent peaks become their mean frame;
times are frames / 50; each downbeat moves to its nearest beat, duplicates dropped.

## Measured agreement

Standalone scripts (Python `onnxruntime` 1.32, and onnxruntime-web 1.31.1 WASM under node 24), on
the seven synthetic songs of `tools/device_analysis_golden.py` and a four-minute groove:

| Stage | Tolerance | Measured |
|---|---|---|
| ONNX logits against PyTorch (Python, six lengths 1 to 1500) | 1e-3 | 5.0e-6 |
| Spectrogram frames, every frame of every song | 1e-4 asked | 2.7e-4 at worst; 5e-5 where the value is above 1 |
| Logits from the browser's spectrogram through onnxruntime-web against the Desktop's | 1e-3 | 2.3e-4 |
| Beats and downbeats against the Desktop tracker on the same signal | one frame (20 ms) | identical, every beat of every song |
| `measureSong` grid against Python with those beats | 0.05 BPM, 2 ms | BPM within 2e-13, grid beats within 1e-10 ms, bar starts, beats per bar (the waltz reads 3/4), constant tempo and every row scalar equal |

The spectrogram misses the asked 1e-4 only in near-silent bins (log-mel below 0.1, mostly the
top filter above the resampler's cut-off), where torch's own float32 FFT rounding is as large as
the signal; it moves no logit by more than 2.3e-4 and no beat at all. The tests hold it to 5e-4.

Against the Desktop's real signal (soxr instead of the port's resampler) the Python tracker itself
moves: on two of seven songs one beat differs (a 20 ms step on `break-174-f-minor`, an extra last
beat at the very end of `house-120-a-minor`). That is the resampler choice of device-analysis.md,
recorded per song in `golden/device-analysis/beat-this/manifest.json`, not the port.

## Speed

Measured on the owner's 8-core Windows PC under node 24, onnxruntime-web WASM single-threaded:
190 to 410 ms of tracking per second of audio (a four-minute song in 46 s; short songs pay a fixed
cost per chunk), the spectrogram about 4 ms per second of audio, peak picking about 1 ms per song.
With four threads: 105 ms per second. Not measured: any real browser, WebGPU, any phone or tablet.

## Which source a device uses

`beatThis/gate.ts::chooseBeatSource`, once per measuring pass, in this order:

1. The Tier 3 record (docs/verification/bf-tier3-beat-this-2026-11-26.md) has passed:
   `BEATS_LICENCE_RECORD` in `beatThis/model.ts` names it. Today it is null, so every device
   uses the interim source.
2. The file is on this device and matches its SHA-256 (the stem model's manager fetches, resumes,
   verifies and keeps it in OPFS; the worker hashes it again before loading). Data saver skips
   the fetch; a failed fetch or run waits a day.
3. The device is fast enough: the first song measured with the tracker is timed (`beatMs` from
   the worker), and more than 500 ms of tracking per second of audio keeps the interim source on
   this device for 30 days, as the stem splitter's benchmark does. The capability roster says so:
   `neural_beats` is `unsupported_here` with "this device measures beats too slowly for the
   neural tracker, so SelectaDJ uses its lighter beat finder here".

Backend: the portable WASM build with SIMD, one thread (threads need cross-origin isolation, which
the site does not have; the WebGPU build is over the static host's 25 MiB file limit, so it is not
shipped, as for stems). Memory: one chunk's spectrogram (768 kB) at a time; the song is never
held as a spectrogram.

## Ids, versions and re-measuring

- `web-beatthis-small0-1` (neural) and `web-onset-comb-beats-1` (interim) name the beat source.
- Facts are stored under `web-dsp-1+<beat source>`, the source that really measured (a fallback
  is stored as interim). With the tracker chosen, every song whose record is interim waits to be
  measured again, one at a time in spare time, after transition work, as any song does.
- The account is told the same id. `engine_store/facts.py`: `web-dsp-1` 1001 (older clients),
  `web-dsp-1+web-onset-comb-beats-1` 1002, `web-dsp-1+web-beatthis-small0-1` 1003; `RANK` puts
  them in that order, below `python-beatthis-3`. The uploader sends a song again when its best
  record here is newer than what it sent, and skips it when the account holds a higher rank.

## What the owner does

To-do T-20261126-7164: publish the file at its path on staging and production, run the Tier 3
record's device section and licence decision and sign it, then set `BEATS_LICENCE_RECORD`.
`cloud.device_analysis` stays off by default until then.
