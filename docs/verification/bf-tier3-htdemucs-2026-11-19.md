# Tier 3 evaluation record: Demucs htdemucs for stem separation

- **Protocol:** [bf-tier3-evaluation-protocol.md](bf-tier3-evaluation-protocol.md) at the commit
  that adds this record (BF-0459-07)
- **Candidate:** Demucs `htdemucs` (Hybrid Transformer Demucs), the same model local mode runs in
  `src/selecta/stems.py`; `demucs` package 4.1.0; source repository facebookresearch/demucs
  (archived January 2025; a maintained fork exists). Checkpoint hash: unknown (not recorded
  here; the conversion has not run).
- **Feature(s) it would enable:** browser stem separation (`stem_separation`, Tier 3) and the stem
  moves built on it: intertwined stems, vocal ride, strip and land.

Status of this record: **incomplete. Every section is PENDING or FAIL, so `stem_separation` is
`unsupported_here` on every device.** Nothing in this record has been verified.

## 1. Licence - PENDING (counts as FAIL)

- Weights licence: not stated by the model's publishers. The Demucs code is MIT; the pretrained
  weights carry no explicit licence.
- Training data: trained partly on MUSDB18-HQ, a dataset whose own terms restrict use to
  research. Whether that restriction reaches the trained weights is the open question.
- Runtime licence: onnxruntime-web 1.31.1, MIT (added to `web/package.json`).
- Commercial SaaS use: unknown.
- Browser redistribution: unknown. The browser downloads the weights to the member's device, so
  shipping them is redistribution, a wider question than local mode's.
- Obligations and where met: unknown until the decision exists.
- Decision by: none yet. This joins the existing review the model is already in for local mode:
  [licence register](../saas/licence-register.md) status **Review**, ADR-0405 SC-0405-04 (a
  lawyer's clearance before paid launch), and the launch checklist's "GPU stems remain blocked"
  line. The browser adds the redistribution question to that same review.

Per the protocol, a licence that is not PASS stops the evaluation: the converted model is not
published to members' browsers and the remaining sections are not run for shipping purposes.

## 2. Conversion - NOT RUN

- Route and runtime: PyTorch `htdemucs` exported to ONNX (opset 18, dynamo exporter), run with
  onnxruntime-web 1.31.1, WebGPU execution provider where `navigator.gpu` exists, otherwise WASM
  single-threaded (no cross-origin isolation needed).
- Commands: [tools/stems_onnx_export.py](../../tools/stems_onnx_export.py), committed, **not yet
  run here**. Tensor contract: input `mix` float32 [1, 2, 343980], output `stems` float32
  [1, 4, 2, 343980] (drums, bass, other, vocals), matching `web/src/dsp/stems/adapter.ts`.
- Known risk: htdemucs's in-graph STFT and inverse STFT use complex tensors and may not export;
  the fallback route (STFT outside the graph) would change the adapter. Not attempted.
- Quantisation: fp32 by default; fp16 weights available with `--fp16`. No choice made.
- Artefact: none. Bytes unknown, hash unknown. `STEM_MODEL_ARTEFACT` in
  `web/src/dsp/stems/model.ts` is `null`, so the browser's download honestly reports
  `not_published`.
- Tolerances set before the run: not yet set.
- Equivalence results: none.

## 3. Device measurements - NOT RUN (FAIL for every class)

| Device class | Evidence record | Peak memory | Load (cold/warm) | Inference per minute (p50/p95) | Dropouts | 30-min thermal | Battery | Verdict |
|---|---|---|---|---|---|---|---|---|
| Desktop Chromium | none | unknown | unknown | unknown | unknown | unknown | n/a | FAIL (not run) |
| Desktop Safari | none | unknown | unknown | unknown | unknown | unknown | n/a | FAIL (not run) |
| iPadOS Safari | none | unknown | unknown | unknown | unknown | unknown | unknown | FAIL (not run) |
| Android Chrome tablet | none | unknown | unknown | unknown | unknown | unknown | unknown | FAIL (not run) |

The browser-side per-device checks exist in code but have never run on a physical device: the
`stem-worker-roundtrip-v1` benchmark (supported only at or below 0.5 s of compute per second of
audio), the crash guard, the battery pause below 20 %, and the thermal pause after three jobs in a
row run 1.5 times slower than the benchmark (`web/src/dsp/stems/gate.ts`). These are runtime
gates, not a substitute for the protocol's physical-device runs.

## 4. Quality - NOT RUN (FAIL)

- Thresholds set before the run: not yet set (SDR per stem against local mode's Demucs
  separation of the same windows).
- Scores against the reference: none.
- Confident-and-wrong cases: not applicable until a run exists.
- Owner's listening verdict: none. The owner listens to browser stem moves beside local mode's
  before anything ships; this stays an owner gate (owner-delegated checks are recorded as such,
  never as "Verified: Yes").

Known reduced behaviour to score when this runs: the browser normalises each 60 s or 45 s window
by its own mean and deviation, where demucs normalises the whole track; input is resampled
linearly to 44.1 kHz when the decoded file has another rate; cached stems are 16-bit.

## 5. Decision

| Device class | ENABLED / unsupported_here (reason) |
|---|---|
| Desktop Chromium | unsupported_here (the stem model's licence is still under review) |
| Desktop Safari | unsupported_here (the stem model's licence is still under review) |
| iPadOS Safari | unsupported_here (the stem model's licence is still under review) |
| Android Chrome tablet | unsupported_here (the stem model's licence is still under review) |
| Every other class | unsupported_here (the stem model's licence is still under review) |

Capability record values the browser reports today: tier 3, feature `stem_separation`,
implementation `htdemucs-onnx-v1`, status `unsupported_here`, reason "the stem model's licence is
still under review". `STEMS_LICENCE_RECORD` in `web/src/dsp/capability.ts` is `null`; it may
name this record only once every section above says PASS.

Signed: not signed.
