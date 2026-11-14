/**
 * Browser model portability registry. Entries are AUDIT claims, not executable models.
 * A device class (including phones/tablets) is never excluded merely by its name.
 * ADR-0485: native checkpoint licenses and browser execution are separate gates.
 */
export type ModelId = "beat_this.small0" | "beat_this.final0" | "skey" |
  "demucs.htdemucs" | "torchaudio.wav2vec2_asr_base_960h";
export type Backend = "wasm" | "webgpu";
export type Portability = "browser-implemented-tested" | "browser-port-feasible-incomplete" |
  "unsupported-on-specific-devices" | "blocked" | "not-yet-investigated";

export interface ModelAudit {
  readonly id: ModelId;
  readonly purpose: string;
  readonly nativeSource: string;
  readonly checkpoint: string;
  readonly preprocessing: string;
  readonly output: string;
  readonly nativeLicenseStatus: "allowed" | "review" | "blocked";
  readonly browserDistributionStatus: "review" | "blocked";
  readonly status: Portability;
  readonly browserBackends: readonly Backend[];
  readonly benchmarkedBackends: readonly Backend[];
  readonly checkpointSha256: string | null;
  readonly cacheBytes: number | null;
  readonly peakMemoryBytes: number | null;
  readonly latencyMs: number | null;
  readonly qualityEvidence: string | null;
  readonly blocker: string;
}

export const MODEL_AUDIT: Readonly<Record<ModelId, ModelAudit>> = Object.freeze({
  "beat_this.small0": {
    id: "beat_this.small0", purpose: "beats and downbeats",
    nativeSource: "src/selecta/analysis/beats.py", checkpoint: "Beat This small0",
    preprocessing: "Native Audio2Beats accepts mono float64 samples and sample rate; feature/graph conversion not validated.",
    output: "Raw beat/downbeat timestamps; native onset refiner and grid confidence remain separate.",
    nativeLicenseStatus: "allowed", browserDistributionStatus: "review",
    status: "browser-port-feasible-incomplete", browserBackends: ["wasm", "webgpu"],
    benchmarkedBackends: [], checkpointSha256: null, cacheBytes: null,
    peakMemoryBytes: null, latencyMs: null, qualityEvidence: null,
    blocker: "No validated ONNX graph, browser weights, feature parity or device benchmarks."
  },
  "beat_this.final0": {
    id: "beat_this.final0", purpose: "beats and downbeats",
    nativeSource: "src/selecta/analysis/beats.py", checkpoint: "Beat This final0",
    preprocessing: "Same Audio2Beats API; different native checkpoint, not a performance proxy for small0.",
    output: "Raw beat/downbeat timestamps, pending native-grid refinement parity.",
    nativeLicenseStatus: "allowed", browserDistributionStatus: "review",
    status: "browser-port-feasible-incomplete", browserBackends: ["wasm", "webgpu"],
    benchmarkedBackends: [], checkpointSha256: null, cacheBytes: null,
    peakMemoryBytes: null, latencyMs: null, qualityEvidence: null,
    blocker: "Checkpoint conversion, operator coverage, licensing review and benchmarks outstanding."
  },
  "skey": {
    id: "skey", purpose: "neural key detection",
    nativeSource: "src/selecta/analysis/skey_model.py", checkpoint: "Deezer s-key commit 80d9590, research weights",
    preprocessing: "nnAudio VQT, torchaudio dB transform and ConvNeXt-style network.",
    output: "24 major/minor key probabilities (with native chroma comparison).",
    nativeLicenseStatus: "blocked", browserDistributionStatus: "blocked",
    status: "blocked", browserBackends: [], benchmarkedBackends: [],
    checkpointSha256: null, cacheBytes: null, peakMemoryBytes: null,
    latencyMs: null, qualityEvidence: null,
    blocker: "Published weights are non-commercial research only; do not distribute in paid Cloud."
  },
  "demucs.htdemucs": {
    id: "demucs.htdemucs", purpose: "four-stem source separation",
    nativeSource: "src/selecta/stems.py", checkpoint: "Demucs htdemucs",
    preprocessing: "Native Demucs CLI resamples/normalises stereo windows; overlap/context and waveform reconstruction require exact parity.",
    output: "vocals, drums, bass, other; native separate_window uses transition windows.",
    nativeLicenseStatus: "review", browserDistributionStatus: "review",
    status: "browser-port-feasible-incomplete", browserBackends: ["wasm", "webgpu"],
    benchmarkedBackends: [], checkpointSha256: null, cacheBytes: null,
    peakMemoryBytes: null, latencyMs: null, qualityEvidence: null,
    blocker: "Weights/licensing, unsupported operators, peak RAM, 15–30s window seam quality, speed and thermal untested."
  },
  "torchaudio.wav2vec2_asr_base_960h": {
    id: "torchaudio.wav2vec2_asr_base_960h", purpose: "forced lyric/word alignment",
    nativeSource: "src/selecta/lyrics/align.py", checkpoint: "torchaudio WAV2VEC2_ASR_BASE_960H",
    preprocessing: "Native resamples mono to bundle sample rate, z-score normalises, emits log-softmax frames.",
    output: "Acoustic character emissions; forced path alone does NOT verify lyric boundaries.",
    nativeLicenseStatus: "allowed", browserDistributionStatus: "review",
    status: "browser-port-feasible-incomplete", browserBackends: ["wasm", "webgpu"],
    benchmarkedBackends: [], checkpointSha256: null, cacheBytes: null,
    peakMemoryBytes: null, latencyMs: null, qualityEvidence: null,
    blocker: "No compatible verified export, per-frame timestamp parity, unguided independent agreement or mobile benchmark."
  }
});

export const modelAudit = (id: ModelId): ModelAudit => MODEL_AUDIT[id];
export function browserShippingReady(id: ModelId): boolean {
  const item = MODEL_AUDIT[id];
  return item.status === "browser-implemented-tested" &&
    item.browserDistributionStatus !== "blocked" &&
    item.checkpointSha256 !== null && item.cacheBytes !== null &&
    item.peakMemoryBytes !== null && item.qualityEvidence !== null &&
    item.benchmarkedBackends.length > 0;
}
