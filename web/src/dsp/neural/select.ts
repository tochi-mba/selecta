import { MODEL_AUDIT, type Backend, type ModelId, browserShippingReady } from "./registry";

export type SelectionReason = "ready" | "license_blocked" | "conversion_incomplete" |
  "unbenchmarked" | "resource_limited" | "backend_unavailable" | "playback_priority";
export type Selection = { supported: true; backend: Backend; model: ModelId } |
  { supported: false; reason: SelectionReason; alternative: "non_neural" };

export interface DeviceEvidence {
  readonly backends: readonly Backend[];
  readonly freeBudgetBytes: number;
  readonly playbackImminent: boolean;
  /** Populated only from a measured run on THIS device/graph/backend. */
  readonly measurements: Readonly<Partial<Record<ModelId, Partial<Record<Backend, {
    checkpointSha256: string;
    peakMemoryBytes: number;
    latencyMs: number;
    passedQualityGate: boolean;
  }>>>>>;
}
/** Fail closed: a WebGPU API existing is insufficient; the exact model must have passed a run. */
export function selectModel(id: ModelId, device: DeviceEvidence): Selection {
  const model = MODEL_AUDIT[id];
  if (model.browserDistributionStatus === "blocked") return {supported: false, reason: "license_blocked", alternative: "non_neural"};
  if (!browserShippingReady(id)) return {supported: false, reason: "conversion_incomplete", alternative: "non_neural"};
  if (device.playbackImminent) return {supported: false, reason: "playback_priority", alternative: "non_neural"};
  for (const backend of model.benchmarkedBackends) {
    if (!device.backends.includes(backend)) continue;
    const result = device.measurements[id]?.[backend];
    if (result && result.passedQualityGate && result.checkpointSha256 === model.checkpointSha256 &&
        Number.isFinite(result.peakMemoryBytes) && result.peakMemoryBytes > 0 &&
        result.peakMemoryBytes <= device.freeBudgetBytes &&
        Number.isFinite(result.latencyMs) && result.latencyMs >= 0) {
      return { supported: true, backend, model: id };
    }
  }
  if (!model.benchmarkedBackends.some(backend => device.backends.includes(backend))) {
    return {supported: false, reason: "backend_unavailable", alternative: "non_neural"};
  }
  const hasMeasurements = model.benchmarkedBackends.some(backend => !!device.measurements[id]?.[backend]);
  return {supported: false, reason: hasMeasurements ? "resource_limited" : "unbenchmarked", alternative: "non_neural"};
}
