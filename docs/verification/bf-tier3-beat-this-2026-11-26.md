# Tier 3 evaluation record: Beat This small0 for neural beat tracking

- **Protocol:** [bf-tier3-evaluation-protocol.md](bf-tier3-evaluation-protocol.md) at the commit
  that adds this record (BF-0459-07)
- **Candidate:** Beat This `small0` (CPJKU, https://github.com/CPJKU/beat_this, package
  `beat-this` 1.1.0), the checkpoint the Desktop runs (`src/selecta/analysis/beats.py`).
  Checkpoint SHA-256 `6074be2c4d490c5f6101fcc374a1ec72ae93456e23bb6019783b849f5dc7d47b`.
- **Feature(s) it would enable:** `neural_beats` (the browser's beat source
  `web-beatthis-small0-1`, docs/engineering/device-beats.md), and through it the beat grid,
  bars and 3/4 detection of every song measured on a device.

Status of this record: **sections 1, 3 and 4 are open, so `neural_beats` is `unsupported_here`
on every device** (`BEATS_LICENCE_RECORD` in `web/src/dsp/analysis/beatThis/model.ts` is null).

## 1. Licence - PENDING (counts as FAIL)

- Weights licence: MIT. The package's README releases "the code and the published model weights"
  under MIT; the package's LICENSE file (MIT, 2024 Institute of Computational Perception, JKU
  Linz) ships in `beat_this-1.1.0.dist-info/licenses/LICENSE`.
- Training data: the README notes the training datasets carry their own terms and leaves it to
  the user to judge whether that matters for their use.
- Runtime licence: onnxruntime-web 1.31.1, MIT. Conversion tools (torch, onnx) do not ship.
- Commercial SaaS use: permitted by MIT.
- Browser redistribution: permitted by MIT, with the notice.
- Obligations and where met: the MIT notice must travel with the weights. Where SelectaDJ shows
  it (the site's open-source notices) is the owner's decision.
- Register: `docs/saas/licence-register.md` lists `beat_this.small0` as allowed after confirming
  the LICENSE file and model card; the cloud model allowlist says `allowed`. Browser
  redistribution is a new question the register does not cover.
- Decision by: none yet. The owner's written decision, including the training-data note, closes
  this section.

## 2. Conversion - PASS

- Route and runtime: PyTorch to ONNX (TorchScript exporter, opset 17, float32, dynamic time
  axis), onnxruntime-web 1.31.1 WASM with SIMD, one thread. WebGPU is not shipped (the build is
  over the static host's file limit), so there is no WebGPU result.
- Commands: [tools/beat_this_onnx_export.py](../../tools/beat_this_onnx_export.py), run on
  2026-11-26, reproducible byte for byte.
- Quantisation: none.
- Artefact: 10,527,297 bytes, SHA-256
  `221565e9ab7c825bac98266b618ff3b78df0a6bf3f67272b90f0a86da14f1ac4`
  (`web/src/dsp/analysis/beatThis/artefact.json`). Compressed size not measured.
- Tolerances set before the run: logits 1e-3; spectrogram 1e-4; beat and downbeat times within
  one model frame (20 ms); grid within 0.05 BPM and 2 ms.
- Equivalence results (seven golden songs and a four-minute song): ONNX against PyTorch 5.0e-6;
  browser logits against the Desktop's 2.3e-4; beats and downbeats identical; grid BPM within
  2e-13 and beats within 1e-10 ms. The spectrogram measured 2.7e-4 against the asked 1e-4, only in
  near-silent bins where torch's own float32 rounding dominates; it changes no beat
  (docs/engineering/device-beats.md).

## 3. Device measurements - NOT RUN (FAIL for every class)

| Device class | Evidence record | Peak memory | Load (cold/warm) | Inference per minute (p50/p95) | Dropouts | 30-min thermal | Battery | Verdict |
|---|---|---|---|---|---|---|---|---|
| Desktop Chromium | none | unknown | unknown | unknown | unknown | unknown | n/a | FAIL (not run) |
| Desktop Safari | none | unknown | unknown | unknown | unknown | unknown | n/a | FAIL (not run) |
| iPadOS Safari | none | unknown | unknown | unknown | unknown | unknown | unknown | FAIL (not run) |
| Android Chrome tablet | none | unknown | unknown | unknown | unknown | unknown | unknown | FAIL (not run) |

Only node 24 on the owner's PC was measured (onnxruntime-web WASM, one thread): model load 1.6 s,
11 to 25 s of tracking per minute of audio. That is not a browser and not a device class. The
runtime gate exists in code (`beatThis/gate.ts`): more than 500 ms of tracking per second of audio
on the first song keeps the interim source on that device for 30 days.

## 4. Quality - PENDING

- Thresholds set before the run: identical beats to the Python reference on the same signal.
- Scores against the reference: identical on all eight synthetic songs (section 2). Real music
  and the golden set of `tools/bf_golden.py` not scored.
- Confident-and-wrong cases: none possible against the reference, since the beats are the
  reference's; the tracker's own errors are the Desktop's.
- Owner's listening verdict: none.

## 5. Decision

| Device class | ENABLED / unsupported_here (reason) |
|---|---|
| Every class | unsupported_here (the neural beat tracker's licence and device review is open, so SelectaDJ uses its lighter beat finder) |

Capability record values: tier 3, feature `neural_beats`, implementation `web-beatthis-small0-1`.

Signed: not signed.
