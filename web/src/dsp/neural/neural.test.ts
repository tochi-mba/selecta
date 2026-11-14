import { describe, expect, it, vi } from "vitest";
import { MODEL_AUDIT, browserShippingReady } from "./registry";
import { selectModel } from "./select";
import { planStemWindows } from "./stemWindows";
import { verifyWordBoundary } from "./wordSafety";
import { createOrtFactory } from "./ortBridge";
import { runLocalInference, NeuralInferenceError, type NeuralResourceBudget } from "./runtime";

const sha = "a".repeat(64);
const input = {dims:[1, 2], data:new Float32Array([1, 2])};
const controller = () => new AbortController();
const budget = (): NeuralResourceBudget => ({
  acquire: async () => ({release: vi.fn()})
});

describe("Model registry and device selection", () => {
  it("has no fabricated shipped or benchmarked neural model", () => {
    for (const value of Object.values(MODEL_AUDIT)) {
      expect(browserShippingReady(value.id)).toBe(false);
      expect(value.qualityEvidence).toBeNull();
      expect(value.benchmarkedBackends).toEqual([]);
    }
  });
  it("blocks noncommercial research weights and degrades, irrespective of phone type", () => {
    const device = {backends:["wasm", "webgpu"] as const, freeBudgetBytes: 1024 ** 3,
      playbackImminent:false, measurements:{}};
    expect(selectModel("skey", device)).toEqual({
      supported:false, reason:"license_blocked", alternative:"non_neural"
    });
    expect(selectModel("beat_this.small0", device).supported).toBe(false);
  });
  it("uses only bounded 15-30 second stem preparation windows", () => {
    const windows = planStemWindows(4, 61, 20, 2);
    expect(windows.length).toBeGreaterThan(1);
    expect(windows[0].startSeconds).toBe(4);
    expect(windows.at(-1)?.useUntilSeconds).toBe(61);
    for (let i = 1; i < windows.length; i++) {
      expect(windows[i].useFromSeconds).toBe(windows[i-1].useUntilSeconds);
    }
    expect(() => planStemWindows(0, 2000)).toThrow();
  });
  it("never promotes guessed or unverified lyric boundaries", () => {
    const guess = {startSeconds:1, endSeconds:1.2, text:"word", origin:"guess" as const};
    expect(verifyWordBoundary(guess, null).reliable).toBe(false);
    const forced = {...guess, origin:"forced_alignment" as const, independentlyChecked:true,
      acousticCheckpointSha256:sha, independentScore:0.9};
    expect(verifyWordBoundary(forced, null).reliable).toBe(false);
    expect(verifyWordBoundary(forced, {checkpointSha256:sha, threshold:0.92, calibratedOn:"fixture-1"}).reliable).toBe(false);
    expect(verifyWordBoundary(forced, {checkpointSha256:sha, threshold:0.8, calibratedOn:"fixture-1"}).reliable).toBe(true);
  });
});

describe("Actual-session adapter safety (mock model session, not a model parity claim)", () => {
  const request = (signal=controller().signal) => ({
    checkpoint: new Uint8Array([1, 2, 3]), checkpointSha256:sha, backend:"wasm" as const,
    peakBytes: 4096, deadlineMs:500, inputName:"audio", outputName:"logits",
    input, signal
  });
  it("calls the provided ONNX Runtime Web session and releases resources", async () => {
    const release = vi.fn();
    const run = vi.fn().mockResolvedValue({logits:{dims:[1,1], data:new Float32Array([0.25])}});
    const factory = createOrtFactory({
      Tensor: class {constructor(_type: unknown, _data: unknown, _dims: unknown) {}},
      InferenceSession: {create: vi.fn().mockResolvedValue({
        inputNames:["audio"],outputNames:["logits"],run,release
      })}
    });
    const result = await runLocalInference(request(), factory, budget());
    expect(Array.from(result.data as Float32Array)).toEqual([0.25]);
    expect(run).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
  });
  it("rejects cancelled inference before opening a model", async () => {
    const ctrl = controller(); ctrl.abort();
    const open = vi.fn();
    await expect(runLocalInference(request(ctrl.signal), {open}, budget())).rejects.toMatchObject({
      code:"cancelled"
    });
    expect(open).not.toHaveBeenCalled();
  });
  it("rejects busy playback budgets", async () => {
    await expect(runLocalInference(request(), {open:vi.fn()},
      {acquire:async () => null})).rejects.toMatchObject({code:"playback_priority"});
  });
  it("rejects invalid model output and releases its session", async () => {
    const release = vi.fn();
    const factory = {open:async () => ({inputNames:["audio"],outputNames:["logits"],
      run:async () => ({logits:{dims:[1,2], data:new Float32Array([1])}}),release})};
    await expect(runLocalInference(request(), factory, budget())).rejects.toMatchObject({
      code:"invalid_output"
    });
    expect(release).toHaveBeenCalledTimes(1);
  });
  it("reports WebGPU device loss rather than silently marking a model ready", async () => {
    const factory = {open:async () => ({inputNames:["audio"],outputNames:["logits"],
      run:async ():Promise<Record<string,never>> => {throw new Error("GPUDevice lost");},
      release:vi.fn()})};
    await expect(runLocalInference({...request(), backend:"webgpu"}, factory, budget()))
      .rejects.toMatchObject({code:"gpu_lost"});
  });
  it("rejects nonfinite input without running inference", async () => {
    await expect(runLocalInference({...request(), input:{dims:[1,1],data:new Float32Array([NaN])}},
      {open:vi.fn()}, budget())).rejects.toBeInstanceOf(NeuralInferenceError);
  });
});
