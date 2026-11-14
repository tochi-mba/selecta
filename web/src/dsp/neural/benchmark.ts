import type { Backend } from "./registry";
import { runLocalInference, type InferenceRequest, type NeuralResourceBudget, type SessionFactory } from "./runtime";
export interface InferenceMeasurement {
  backend: Backend;
  checkpointSha256: string;
  samples: number;
  warmupMs: number;
  medianMs: number;
  maxMs: number;
  qualityPassed: false; // A timing benchmark cannot approve audio quality.
}
/** Independent on-device benchmark per actual checkpoint, backend and fixture.
 * Never run on an active playing device without a resource grant. */
export async function benchmarkLocalModel(
  request: InferenceRequest, factory: SessionFactory, budget: NeuralResourceBudget,
  clock: () => number = () => performance.now()
): Promise<InferenceMeasurement> {
  const measure = async (): Promise<number> => {
    const start = clock();
    await runLocalInference(request, factory, budget);
    return clock() - start;
  };
  const warmupMs = await measure();
  const samples: number[] = [];
  for (let i = 0; i < 3; i++) {
    if (request.signal.aborted) throw new Error("benchmark cancelled");
    samples.push(await measure());
  }
  if (![warmupMs, ...samples].every(v => Number.isFinite(v) && v >= 0)) throw new Error("invalid clock");
  samples.sort((a,b) => a-b);
  return {
    backend: request.backend, checkpointSha256: request.checkpointSha256,
    samples: 3, warmupMs, medianMs: samples[1], maxMs: samples[2],
    qualityPassed: false
  };
}
