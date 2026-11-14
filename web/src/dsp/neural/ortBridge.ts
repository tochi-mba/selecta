import type { Backend } from "./registry";
import type { NeuralSession, SessionFactory, Tensor, TensorData } from "./runtime";

/** Minimal ONNX Runtime Web interface, injected by the integration owner (no global dependency).
 * This adapter calls real ORT InferenceSession.create/run, not a simulated predictor. */
export interface OrtRuntime {
  Tensor: new (type: "float32" | "int32" | "int64", data: TensorData, dims: number[]) => unknown;
  InferenceSession: {
    create(model: Uint8Array, config: {executionProviders: string[]; graphOptimizationLevel: "all"}): Promise<{
      inputNames: string[]; outputNames: string[];
      run(feeds: Record<string, unknown>): Promise<Record<string, { dims: readonly number[]; data: TensorData }>>;
      release(): Promise<void>;
    }>;
  };
}

export function createOrtFactory(ort: OrtRuntime): SessionFactory {
  return {
    async open(bytes: Uint8Array, backend: Backend, signal: AbortSignal): Promise<NeuralSession> {
      if (signal.aborted) throw new Error("cancelled");
      // WebGPU support must be independently proven for each graph. No automatic silent provider switch.
      const session = await ort.InferenceSession.create(bytes, {
        executionProviders: [backend === "wasm" ? "wasm" : "webgpu"],
        graphOptimizationLevel: "all"
      });
      if (signal.aborted) { await session.release(); throw new Error("cancelled"); }
      return {
        inputNames: session.inputNames,
        outputNames: session.outputNames,
        async run(feeds: Record<string, Tensor>): Promise<Record<string, Tensor>> {
          if (signal.aborted) throw new Error("cancelled");
          const tensors: Record<string, unknown> = {};
          for (const [name, tensor] of Object.entries(feeds)) {
            const type = tensor.data instanceof Float32Array ? "float32" :
              tensor.data instanceof Int32Array ? "int32" : "int64";
            tensors[name] = new ort.Tensor(type, tensor.data, [...tensor.dims]);
          }
          const output = await session.run(tensors);
          const result: Record<string, Tensor> = {};
          for (const [name, tensor] of Object.entries(output)) {
            result[name] = {dims: [...tensor.dims], data: tensor.data};
          }
          return result;
        },
        release: () => session.release()
      };
    }
  };
}
