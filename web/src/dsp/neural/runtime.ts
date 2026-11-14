import type { Backend } from "./registry";
/**
 * Dependency-injected ONNX Runtime Web adapter, not a substitute for a converted checkpoint.
 * The caller installs a tested ORT build and passes a factory; we do not add global deps or
 * infer operator availability from the browser's WebGPU feature bit.
 */
export type TensorData = Float32Array | Int32Array | BigInt64Array;
export interface Tensor {
  readonly dims: readonly number[];
  readonly data: TensorData;
}
export interface NeuralSession {
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  run(feeds: Record<string, Tensor>): Promise<Record<string, Tensor>>;
  release(): Promise<void> | void;
}
export interface SessionFactory {
  open(bytes: Uint8Array, backend: Backend, signal: AbortSignal): Promise<NeuralSession>;
}
export interface ResourceLease { release(): Promise<void> | void }
export interface NeuralResourceBudget {
  /** Never grant a model lease that could starve audio preparation/real-time playback. */
  acquire(request: { kind: "neural"; peakBytes: number; deadlineMs: number; backend: Backend },
          signal: AbortSignal): Promise<ResourceLease | null>;
}
export class NeuralInferenceError extends Error {
  constructor(public readonly code: "unsupported" | "cancelled" | "playback_priority" |
    "invalid_input" | "invalid_output" | "gpu_lost" | "inference_failed", message: string) {
    super(message); this.name = "NeuralInferenceError";
  }
}
export interface InferenceRequest {
  readonly checkpoint: Uint8Array;
  readonly checkpointSha256: string;
  readonly backend: Backend;
  readonly peakBytes: number;
  readonly deadlineMs: number;
  readonly inputName: string;
  readonly outputName: string;
  readonly input: Tensor;
  readonly signal: AbortSignal;
}
function checkTensor(t: Tensor): boolean {
  if (!t || !Array.isArray(t.dims) || !t.dims.length ||
    !t.dims.every(v => Number.isSafeInteger(v) && v >= 1)) return false;
  const count = t.dims.reduce((a, b) => a * b, 1);
  if (!Number.isSafeInteger(count) || count > 100_000_000 || count !== t.data?.length) return false;
  if (t.data instanceof Float32Array && !t.data.every(Number.isFinite)) return false;
  return t.data instanceof Float32Array || t.data instanceof Int32Array || t.data instanceof BigInt64Array;
}
const checkAbort = (signal: AbortSignal) => {
  if (signal.aborted) throw new NeuralInferenceError("cancelled", "Inference cancelled");
};
/** Runs a genuinely provided model session; NEVER fabricates result/confidence. */
export async function runLocalInference(
  req: InferenceRequest, factory: SessionFactory, budget: NeuralResourceBudget
): Promise<Tensor> {
  checkAbort(req.signal);
  if (!/^[a-f0-9]{64}$/i.test(req.checkpointSha256) ||
    !req.checkpoint?.byteLength || !Number.isSafeInteger(req.peakBytes) || req.peakBytes < 1 ||
    !Number.isFinite(req.deadlineMs) || req.deadlineMs <= 0 ||
    !/^[A-Za-z_][A-Za-z_0-9.]*$/.test(req.inputName) ||
    !/^[A-Za-z_][A-Za-z_0-9.]*$/.test(req.outputName) || !checkTensor(req.input)) {
    throw new NeuralInferenceError("invalid_input", "Model request requires a pinned checkpoint, typed input and bounded resources");
  }
  const lease = await budget.acquire({kind: "neural", peakBytes: req.peakBytes, deadlineMs: req.deadlineMs, backend: req.backend}, req.signal);
  if (!lease) throw new NeuralInferenceError("playback_priority", "No spare resources while audio takes priority");
  let session: NeuralSession | undefined;
  try {
    checkAbort(req.signal);
    session = await factory.open(req.checkpoint, req.backend, req.signal);
    checkAbort(req.signal);
    if (!session.inputNames.includes(req.inputName) || !session.outputNames.includes(req.outputName)) {
      throw new NeuralInferenceError("unsupported", "Checkpoint tensor names do not match the manifest");
    }
    let result: Record<string, Tensor>;
    try { result = await session.run({[req.inputName]: req.input}); }
    catch (err) {
      if (req.signal.aborted) throw new NeuralInferenceError("cancelled", "Inference cancelled");
      const msg = err instanceof Error ? err.message : "";
      throw new NeuralInferenceError(req.backend === "webgpu" && /device lost|devicelost|GPUDevice/i.test(msg) ?
        "gpu_lost" : "inference_failed", "Local inference failed");
    }
    checkAbort(req.signal);
    const tensor = result?.[req.outputName];
    if (!checkTensor(tensor)) throw new NeuralInferenceError("invalid_output", "Missing, nonfinite or mismatched model tensor");
    return tensor;
  } finally {
    try { await session?.release(); } finally { await lease.release(); }
  }
}
